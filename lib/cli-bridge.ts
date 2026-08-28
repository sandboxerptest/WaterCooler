/**
 * CLI Bridge — emulates the OpenClaw gateway protocol but delegates to a local
 * agent CLI (Claude Code or Auggie) for actual agent execution.
 *
 * Handles WebSocket upgrades, the connect/challenge handshake, chat send/abort,
 * session listing, and model listing by spawning CLI child processes. Which CLI
 * runs, and with what arguments, is decided by the provider descriptor passed to
 * `attachCliBridge` — see cli-providers.ts.
 */

import { type IncomingMessage } from "http";
import type { Duplex } from "stream";
import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WebSocket, WebSocketServer } from "ws";
import { createLogger } from "./logger";
import { ROOM_SPEND_LIMIT_USD, getRoomStore } from "./server/room-store";
import { onRunCompleted, type CompletedRun } from "./server/achievement-rules";
import { humansInRoom, recordActivity } from "./server/presence-socket";
import { achievementFor } from "./achievements";
import { CURRENCY_NOTE } from "./erp/currency";
import { DEFAULT_ROOM_SLUG, normaliseRoomSlug } from "./rooms";
import {
  ensureSeatWorkspace,
  getCliProvider,
  parseJsonObject,
  resolveBin,
  type CliParsedResult,
  type CliProvider,
  type ModelChoice,
} from "./cli-providers";

let log = createLogger("CLI Bridge");

/** The active CLI provider. Replaced by attachCliBridge at startup. */
let provider: CliProvider = getCliProvider("claude");

let runCounter = 0;

/** Lightweight seat info passed to MCP server and prompt context. */
interface WorkerInfo {
  seatId: string;
  label: string;
  roleTitle?: string;
}

/**
 * Every connected UI. A room can have several people watching at once, so
 * subagent activity is broadcast rather than sent to one privileged client.
 */
const clients = new Set<ClientState>();

/**
 * The roster is read from the room store rather than pushed by a client.
 * When each browser posted its own view, whichever loaded last won — and a tab
 * whose scene had not populated seats yet would publish an empty roster,
 * silently stripping the main agent's ability to delegate.
 */
export function getWorkerRoster(room: string): WorkerInfo[] {
  try {
    const seats = getRoomStore().getSnapshot(room).seats as Array<{
      seatId?: string;
      label?: string;
      roleTitle?: string;
      assigned?: boolean;
    }>;
    return seats
      .filter((seat) => seat.assigned && seat.seatId && seat.label)
      .map((seat) => ({
        seatId: seat.seatId as string,
        label: seat.label as string,
        roleTitle: seat.roleTitle,
      }));
  } catch (err) {
    log.warn("could not read the roster:", (err as Error).message);
    return [];
  }
}

interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
  event?: string;
  seq?: number;
}

interface ClientState {
  ws: WebSocket;
  /** Which room this UI is looking at; set at connect, used for every run. */
  room: string;
  seq: number;
  runningProcesses: Map<string, ChildProcess>;
  /** Maps OpenClaw sessionKey → CLI session id for resume support */
  sessionMap: Map<string, string>;
}

// ── Helpers ─────────────────────────────────────────────

function sendFrame(state: ClientState, frame: GatewayFrame) {
  if (state.ws.readyState !== WebSocket.OPEN) return;
  try {
    state.ws.send(JSON.stringify(frame));
  } catch (err) {
    log.error("sendFrame failed:", (err as Error).message);
  }
}

function sendEvent(state: ClientState, event: string, payload: Record<string, unknown>) {
  sendFrame(state, { type: "event", event, payload, seq: state.seq++ });
}

/**
 * Send an event to every connected UI. Subagent activity belongs to the room,
 * not to whoever happened to trigger it, so all watchers see the worker move.
 */
function broadcastEvent(event: string, payload: Record<string, unknown>) {
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) sendEvent(client, event, payload);
  }
}

/**
 * Resume ids for dispatched seats. Server-owned: the seat's conversation
 * belongs to the room and must survive any one browser disconnecting.
 */
const dispatchSessions = new Map<string, string>();

/**
 * How many agents may run at once. Four humans with four seats each is sixteen
 * possible concurrent runs; without a ceiling a busy room can exhaust the host.
 */
const MAX_CONCURRENT_RUNS = Number(process.env.AGENT_MAX_CONCURRENT ?? 4);

let runningCount = 0;

/**
 * A run that never finishes holds a concurrency slot forever. That is not
 * hypothetical: given a rejected API key the CLI retries quietly, producing no
 * output and never exiting, so without this the room would fill with invisible
 * stuck runs and stop accepting work.
 */
const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 180_000);

/** Kill a run that has outstayed the limit. Returns a canceller. */
function guardRunTime(child: ChildProcess, onTimeout: (seconds: number) => void): () => void {
  const timer = setTimeout(() => {
    onTimeout(Math.round(RUN_TIMEOUT_MS / 1000));
    child.kill("SIGTERM");
    // Escalate if it ignores the polite request
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5000).unref?.();
  }, RUN_TIMEOUT_MS);
  timer.unref?.();
  return () => clearTimeout(timer);
}

function atCapacity(): boolean {
  return runningCount >= MAX_CONCURRENT_RUNS;
}

/** Reason this provider cannot run right now, or null when it is ready. */
function providerBlocked(room: string): string | null {
  const reason = provider.preflight?.() ?? null;
  if (reason) return reason;

  if (atCapacity()) {
    return `Too many agents are working at once (${MAX_CONCURRENT_RUNS}). Try again in a moment.`;
  }

  try {
    if (getRoomStore().isOverBudget(room)) {
      return `This room has reached its $${ROOM_SPEND_LIMIT_USD} spend limit. Agents are paused.`;
    }
  } catch (err) {
    log.warn("could not check the budget:", (err as Error).message);
  }

  return null;
}

/**
 * Announce badges an agent just earned. Sent on the bridge's own channel, the
 * same way budget updates are, so every watching UI can celebrate.
 */
function announceAchievements(room: string, run: CompletedRun) {
  for (const item of onRunCompleted(run)) {
    const definition = achievementFor(item.code);
    if (!definition) continue;
    for (const client of clients) {
      if (client.room !== room) continue;
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      sendFrame(client, {
        type: "event",
        event: "achievement",
        payload: {
          code: item.code,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          subjectName: item.subjectName,
          title: definition.title,
          description: definition.description,
          icon: definition.icon,
          at: item.earnedAt,
        },
        seq: client.seq++,
      });
    }
  }
}

/** Tell every watcher where the room stands against its limit. */
function broadcastBudget(room: string) {
  try {
    const store = getRoomStore();
    const spentUsd = store.getSpend(room);
    for (const client of clients) {
      // Only the people looking at this room care what it has spent
      if (client.room !== room) continue;
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      sendFrame(client, {
        type: "event",
        event: "budget",
        payload: {
          spentUsd,
          limitUsd: ROOM_SPEND_LIMIT_USD,
          halted: spentUsd >= ROOM_SPEND_LIMIT_USD,
        },
        seq: client.seq++,
      });
    }
  } catch {
    // Reporting spend must never take a run down with it
  }
}

/** Bank what a run cost so a spend ceiling has something to enforce against. */
function recordSpend(room: string, parsed: { costUsd?: number } | null) {
  if (!parsed?.costUsd) return;
  try {
    getRoomStore().addSpend(room, parsed.costUsd);
    broadcastBudget(room);
  } catch (err) {
    log.warn("could not record spend:", (err as Error).message);
  }
}

function sendResponse(
  state: ClientState,
  id: string,
  ok: boolean,
  payloadOrError: Record<string, unknown>,
) {
  const frame: GatewayFrame = { type: "res", id, ok };
  if (ok) {
    frame.payload = payloadOrError;
  } else {
    frame.error = payloadOrError as GatewayFrame["error"];
  }
  sendFrame(state, frame);
}

// ── Origin check (same pattern as ws-proxy.ts) ─────────

function checkOrigin(req: IncomingMessage, socket: Duplex): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        log.warn(`Rejected WS upgrade: origin ${origin} does not match host ${host}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return false;
      }
    } catch {
      log.warn(`Rejected WS upgrade: invalid origin ${origin}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return false;
    }
  }
  return true;
}

// ── Chat send handler ──────────────────────────────────

function buildWorkerRosterContext(room: string, currentSeatLabel?: string): string {
  const workerRoster = getWorkerRoster(room);
  if (workerRoster.length <= 1) return "";
  const others = workerRoster.filter((w) => w.label !== currentSeatLabel);
  if (others.length === 0) return "";
  const lines = others.map(
    (w) => `  • seatId="${w.seatId}" — ${w.label} (${w.roleTitle ?? "Worker"})`,
  );
  return (
    "\n\nYou have team members available. Use the dispatch_to_worker tool to delegate tasks:\n" +
    lines.join("\n") +
    "\n"
  );
}

/**
 * Build the seat's persona as plain text. Providers decide where it goes —
 * a system-prompt flag where one exists, otherwise prefixed to the message.
 */
/**
 * What every seat is told about the company.
 *
 * Registering the tools is what makes them callable; this is what makes the
 * agent think to reach for them. Without it a model asked "who owes us money"
 * tends to apologise for having no access, while holding a tool that answers it.
 */
const COMPANY_BRIEFING = [
  "You work at Brightwater Supply Co., which sells watercoolers, coffee machines and office refreshments.",
  "The company's ERP is available to you through tools: erp_query for read-only SQL, erp_schema to see the tables.",
  "It holds customers, contacts, suppliers, products, stock, leads, opportunities, activities, quotes, orders, invoices, payments and the general ledger.",
  CURRENCY_NOTE,
  "Always look the answer up rather than estimating it, and say which figures you used.",
  "You can also create leads, customers and quotes, and log activities, with the erp_create_* tools.",
].join(" ");

function buildPersonality(room: string, params: Record<string, unknown>): string {
  const label = params.seatLabel as string | undefined;
  const role = params.seatRole as string | undefined;
  if (!label && !role) {
    return `You are powered by ${provider.displayName}. Stay in character when responding. ${COMPANY_BRIEFING}`;
  }
  const parts: string[] = [];
  if (label) parts.push(`Your name is "${label}".`);
  if (role) parts.push(`Your role is ${role}.`);
  parts.push("Stay in character when responding.");
  return `${parts.join(" ")} ${COMPANY_BRIEFING}${buildWorkerRosterContext(room, label)}`;
}

function handleChatSend(state: ClientState, id: string, params: Record<string, unknown>) {
  const sessionKey = (params.sessionKey as string) ?? "default";
  const message = (params.message as string) ?? "";
  const runId = `${provider.id}_${Date.now()}_${++runCounter}`;

  // Immediate response with runId
  sendResponse(state, id, true, { runId, status: "accepted" });

  // A missing key, a full queue or an exhausted budget should read as a plain
  // sentence in the worker's bubble, not as a mysterious non-zero exit code.
  const blocked = providerBlocked(state.room);
  if (blocked) {
    log.warn(`refusing run ${runId}: ${blocked}`);
    recordActivity(state.room, {
      kind: "task",
      actor: (params.seatLabel as string | undefined) ?? "The room",
      text: "could not start a task",
      detail: blocked,
    });
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: blocked },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
    return;
  }

  // Lifecycle start
  sendEvent(state, "agent", { runId, sessionKey, stream: "lifecycle", data: { phase: "start" } });
  recordActivity(state.room, {
    kind: "task",
    actor: (params.seatLabel as string | undefined) ?? "Someone",
    text: `was set to work: ${message.slice(0, 120)}`,
  });

  const startedAt = Date.now();
  const seatLabel = params.seatLabel as string | undefined;
  const runOptions = {
    message,
    personality: buildPersonality(state.room, params),
    sessionId: state.sessionMap.get(sessionKey),
    // Attach the MCP server for worker dispatch if we have a roster
    mcpConfigPath: writeMcpConfig(state.room),
    model: (params.model as string | undefined) ?? process.env.WATERCOOLER_MODEL,
    workspaceDir: provider.usesWorkspaces
      ? ensureSeatWorkspace(seatLabel ?? sessionKey, state.room)
      : undefined,
    seatLabel,
    sessionKey,
  };

  // Both kinds of run end the same way, so the reporting — spend, activity,
  // achievements, session mapping, the final bubble — lives in one place.
  const finish = (parsed: CliParsedResult | null, failure: string | null) =>
    finishRun({ state, params, runId, sessionKey, message, startedAt, parsed, failure });

  // A service provider has no process to spawn: it answers in place.
  if (provider.kind === "service") {
    if (!provider.run) {
      finish(null, `${provider.displayName} has no run implementation.`);
      return;
    }
    log.info(`Calling ${provider.displayName} for run ${runId}`);
    runningCount += 1;
    provider
      .run(runOptions)
      .then((parsed) => {
        runningCount = Math.max(0, runningCount - 1);
        finish(parsed, null);
      })
      .catch((err: unknown) => {
        runningCount = Math.max(0, runningCount - 1);
        finish(null, (err as Error)?.message ?? String(err));
      });
    return;
  }

  if (!provider.buildRun || !provider.parseResult) {
    finish(null, `${provider.displayName} has no CLI implementation.`);
    return;
  }

  const spec = provider.buildRun(runOptions);

  log.info(`Spawning ${provider.displayName} for run ${runId} in ${spec.cwd ?? process.cwd()}`);

  const port = process.env.PORT ?? "3000";
  let child: ChildProcess;
  try {
    child = spawn(spec.bin, spec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: spec.cwd,
      env: {
        ...process.env,
        WATERCOOLER_PORT: port,
        WATERCOOLER_WORKERS: JSON.stringify(getWorkerRoster(state.room)),
        WATERCOOLER_DISPATCH_SECRET: dispatchSecret,
        // Delegated work must land in the room that asked for it: the roster,
        // the sandbox and the spend ceiling are all per room.
        WATERCOOLER_ROOM: state.room,
        // Stamped onto anything the agent writes, so a person can see who did it
        WATERCOOLER_SEAT: (params.seatLabel as string | undefined) ?? "an agent",
        ERP_DB_PATH: erpDatabasePath(),
      },
    });
  } catch (err) {
    const errMsg = `Failed to spawn ${provider.binName}: ${(err as Error).message}`;
    log.error(errMsg);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: errMsg },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
    return;
  }

  state.runningProcesses.set(runId, child);
  runningCount += 1;

  let timedOut = false;
  const cancelTimeout = guardRunTime(child, (seconds) => {
    timedOut = true;
    log.error(`run ${runId} exceeded ${seconds}s and was stopped`);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: `The agent was stopped after ${seconds}s with no reply.` },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
  });

  let stdout = "";
  let stderr = "";

  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("error", (err) => {
    cancelTimeout();
    log.error(`${provider.binName} process error for run ${runId}:`, err.message);
    state.runningProcesses.delete(runId);
    runningCount = Math.max(0, runningCount - 1);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: err.message },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
  });

  child.on("close", (code) => {
    cancelTimeout();
    state.runningProcesses.delete(runId);
    runningCount = Math.max(0, runningCount - 1);

    // The timeout already told everyone; a kill signal is not a second failure
    if (timedOut) return;

    if (code === null || code !== 0) {
      finish(null, stderr.trim() || `${provider.binName} exited with code ${code}`);
      return;
    }

    const parsed = provider.parseResult!(stdout);
    if (!parsed) {
      log.error(
        `${provider.binName} produced unparseable output for run ${runId}:`,
        stdout.slice(0, 500),
      );
      finish(null, `Failed to parse ${provider.displayName} output`);
      return;
    }

    finish(parsed, null);
  });
}

/**
 * Reports the end of a run, however it ran.
 *
 * `failure` set means the run never produced an answer — a non-zero exit, an
 * unreadable reply, a service that refused. `parsed.isError` means the
 * provider ran and declined the turn. Both end as an error bubble rather than
 * as speech, so a person can see what went wrong instead of an agent
 * narrating it.
 */
function finishRun(args: {
  state: ClientState;
  params: Record<string, unknown>;
  runId: string;
  sessionKey: string;
  message: string;
  startedAt: number;
  parsed: CliParsedResult | null;
  failure: string | null;
}) {
  const { state, params, runId, sessionKey, message, startedAt, parsed } = args;

  const fail = (error: string) => {
    log.error(`Run ${runId} failed: ${error}`);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
  };

  if (args.failure || !parsed) {
    fail(args.failure ?? `${provider.displayName} returned nothing`);
    return;
  }

  recordSpend(state.room, parsed);

  const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
  recordActivity(state.room, {
    kind: "agent",
    actor: (params.seatLabel as string | undefined) ?? "An agent",
    text: `answered: ${message.slice(0, 120)}`,
    detail: parsed.costUsd ? `${seconds}s · $${parsed.costUsd.toFixed(4)}` : `${seconds}s`,
  });

  announceAchievements(state.room, {
    room: state.room,
    seatId: params.seatId as string | undefined,
    seatLabel: (params.seatLabel as string | undefined) ?? "Someone",
    durationMs: Date.now() - startedAt,
    costUsd: parsed.costUsd,
    dispatched: false,
    humansPresent: humansInRoom(state.room),
  });

  // Store the provider session id so the next message to this seat resumes it
  if (parsed.sessionId) {
    state.sessionMap.set(sessionKey, parsed.sessionId);
    log.debug(`Mapped sessionKey ${sessionKey} → ${provider.id} session ${parsed.sessionId}`);
  }

  // A clean run with is_error set means the provider ran but refused the turn
  // (not logged in, quota, invalid model). Surface it instead of speaking it.
  if (parsed.isError) {
    fail(parsed.text);
    return;
  }

  sendEvent(state, "agent", { runId, sessionKey, stream: "lifecycle", data: { phase: "end" } });

  sendEvent(state, "chat", {
    runId,
    sessionKey,
    state: "final",
    message: { content: [{ type: "text", text: parsed.text }] },
  });

  log.info(`Run ${runId} completed successfully`);
}

// ── Chat abort handler ─────────────────────────────────

function handleChatAbort(state: ClientState, id: string, params: Record<string, unknown>) {
  const runId = params.runId as string | undefined;
  const sessionKey = (params.sessionKey as string) ?? "default";

  if (runId && state.runningProcesses.has(runId)) {
    const child = state.runningProcesses.get(runId)!;
    child.kill("SIGTERM");
    state.runningProcesses.delete(runId);
    log.info(`Aborted run ${runId}`);
  }

  sendResponse(state, id, true, {});
  if (runId) {
    sendEvent(state, "chat", { runId, sessionKey, state: "aborted" });
  }
}

// ── Models list handler ────────────────────────────────

async function handleModelsList(state: ClientState, id: string) {
  const modelsCommand = provider.modelsCommand;
  if (!modelsCommand) {
    sendResponse(state, id, true, { models: provider.staticModels });
    return;
  }

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(resolveBin(provider), modelsCommand, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`${provider.binName} model list exited with code ${code}`));
      });
      // Timeout after 10s
      setTimeout(() => {
        child.kill();
        reject(new Error("timeout"));
      }, 10_000);
    });

    const parsed = parseJsonObject(result);
    if (parsed && Array.isArray(parsed.models)) {
      sendResponse(state, id, true, { models: parsed.models as ModelChoice[] });
      return;
    }
    // Try treating the whole output as an array
    const idx = result.indexOf("[");
    if (idx !== -1) {
      try {
        const arr = JSON.parse(result.slice(idx));
        if (Array.isArray(arr)) {
          sendResponse(state, id, true, { models: arr });
          return;
        }
      } catch {
        /* fall through */
      }
    }
  } catch (err) {
    log.warn(`Failed to list ${provider.binName} models:`, (err as Error).message);
  }

  // Static fallback
  sendResponse(state, id, true, { models: provider.staticModels });
}

// ── Client message router ──────────────────────────────

function handleMessage(state: ClientState, raw: string) {
  let frame: GatewayFrame;
  try {
    frame = JSON.parse(raw) as GatewayFrame;
  } catch {
    log.warn("Received non-JSON message, ignoring");
    return;
  }

  if (frame.type !== "req") {
    log.debug("Ignoring non-request frame:", frame.type);
    return;
  }

  const { id, method, params } = frame;
  if (!id || !method) {
    log.warn("Request frame missing id or method");
    return;
  }

  log.debug(`Request: ${method} (id=${id})`);

  switch (method) {
    case "connect":
      // Respond with hello-ok, ignoring the auth token
      sendResponse(state, id, true, {
        type: "hello-ok",
        scopes: ["operator.read", "operator.write"],
      });
      break;

    case "chat.send":
      handleChatSend(state, id, params ?? {});
      break;

    case "chat.abort":
      handleChatAbort(state, id, params ?? {});
      break;

    case "sessions.list":
      sendResponse(state, id, true, { sessions: [] });
      break;

    case "sessions.preview":
      sendResponse(state, id, true, { previews: [] });
      break;

    case "models.list":
      void handleModelsList(state, id);
      break;

    default:
      log.warn(`Unknown method: ${method}`);
      sendResponse(state, id, false, {
        code: "unknown_method",
        message: `Unknown method: ${method}`,
      });
      break;
  }
}

// ── MCP config helpers ────────────────────────────────

const dispatchSecret = `at_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let mcpConfigPath: string | null = null;
/** Whether the cached config includes delegation, so a staffing change rebuilds it. */
let mcpConfigShape: boolean | null = null;

/**
 * Where the company's data lives, as an absolute path.
 *
 * Agents run inside their own sandbox, and the MCP server inherits that
 * working directory — so a relative path resolves somewhere inside the seat's
 * folder and the database simply is not there.
 */
function erpDatabasePath(): string {
  return process.env.ERP_DB_PATH ?? join(process.cwd(), ".data", "erp.sqlite");
}

/** The ERP tool server, alongside the dispatch one. */
function getErpServerPath(): string {
  return join(process.cwd(), "lib", "mcp", "erp-mcp.mjs");
}

function getMcpServerPath(): string {
  // Resolve the MCP server script relative to the project root.
  // In dev (tsx) process.cwd() is the project root; in prod the server
  // is started from the package root.  Either way, lib/mcp/ lives there.
  return join(process.cwd(), "lib", "mcp", "watercooler-mcp.mjs");
}

/** Write (or reuse) a temporary MCP config file pointing at our stdio server. */
function writeMcpConfig(room: string): string | null {
  const canDelegate = getWorkerRoster(room).length > 1;
  if (mcpConfigPath && mcpConfigShape === canDelegate) return mcpConfigPath;
  mcpConfigShape = canDelegate;
  try {
    const config = {
      mcpServers: {
        // The company's data is always available; a seat with nobody to
        // delegate to still needs to answer questions about customers
        "brightwater-erp": {
          command: "node",
          args: [getErpServerPath()],
        },
        ...(canDelegate
          ? {
              watercooler: {
                command: "node",
                args: [getMcpServerPath()],
              },
            }
          : {}),
      },
    };
    const dir = join(tmpdir(), "watercooler-mcp");
    mkdirSync(dir, { recursive: true });
    // Two shapes, so a room that gains a second worker gets a fresh config
    const filePath = join(dir, `mcp-config-${process.pid}-${canDelegate ? "team" : "solo"}.json`);
    writeFileSync(filePath, JSON.stringify(config), "utf-8");
    mcpConfigPath = filePath;
    log.info(`MCP config written to ${filePath}`);
    return filePath;
  } catch (err) {
    log.warn("Failed to write MCP config:", (err as Error).message);
    return null;
  }
}

function cleanupMcpConfig() {
  if (mcpConfigPath) {
    try {
      unlinkSync(mcpConfigPath);
    } catch {
      /* ignore */
    }
    mcpConfigPath = null;
  }
}

// ── Dispatch handler (called from HTTP endpoint) ──────

/**
 * Dispatch a task to a specific worker seat, spawning a new auggie process.
 * Returns the result text. Emits subagent-like lifecycle events so the
 * frontend shows the task animation on the target worker.
 */
export function dispatchToWorker(
  seatId: string,
  task: string,
  room: string = DEFAULT_ROOM_SLUG,
): Promise<{ result: string; error?: string }> {
  return new Promise((resolve) => {
    const seat = getWorkerRoster(room).find((w) => w.seatId === seatId);
    if (!seat) {
      resolve({ result: "", error: `Unknown seatId: ${seatId}` });
      return;
    }

    // Delegation respects the same key, capacity and budget rules; otherwise a
    // single agent could fan out past every limit by dispatching.
    const blocked = providerBlocked(room);
    if (blocked) {
      log.warn(`refusing dispatch to ${seat.label}: ${blocked}`);
      resolve({ result: "", error: blocked });
      return;
    }

    const runId = `${provider.id}_sub_${Date.now()}_${++runCounter}`;
    const sessionKey = `subagent:dispatch:${seatId}:${runId}`;

    // Emit lifecycle start so frontend assigns to the target worker
    broadcastEvent("agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "start", label: `${seat.label}: ${task.slice(0, 40)}`, seatId },
    });

    // Resume this seat's own session if it has run before
    const seatSessionKey = `dispatch:${seatId}`;
    const runOptions = {
      message: task,
      personality: buildPersonality(room, { seatLabel: seat.label, seatRole: seat.roleTitle }),
      sessionId: dispatchSessions.get(seatSessionKey),
      // A dispatched worker does not delegate onward, so no MCP config.
      mcpConfigPath: null,
      model: process.env.WATERCOOLER_MODEL,
      workspaceDir: provider.usesWorkspaces ? ensureSeatWorkspace(seat.label, room) : undefined,
      seatLabel: seat.label,
      sessionKey: seatSessionKey,
    };

    log.info(`Dispatching to ${seat.label} (${seatId}), run ${runId}`);
    const startedAt = Date.now();

    /**
     * Reports a finished delegation, whichever kind of provider ran it.
     * `rawFallback` is the CLI's stdout, used when the output could not be
     * parsed but still holds something worth showing.
     */
    const complete = (parsed: CliParsedResult | null, failure: string | null, rawFallback = "") => {
      if (failure) {
        log.error(`dispatch failed for run ${runId}:`, failure);
        broadcastEvent("agent", {
          runId,
          sessionKey,
          stream: "lifecycle",
          data: { phase: "error", error: failure },
        });
        resolve({ result: "", error: failure });
        return;
      }

      recordSpend(room, parsed);
      announceAchievements(room, {
        room,
        seatId,
        seatLabel: seat.label,
        durationMs: Date.now() - startedAt,
        costUsd: parsed?.costUsd,
        // Work that arrived here came from another agent, not a person
        dispatched: true,
        humansPresent: humansInRoom(room),
      });
      const responseText = parsed ? parsed.text : rawFallback;

      // Store session for future resume
      if (parsed?.sessionId) {
        dispatchSessions.set(seatSessionKey, parsed.sessionId);
      }

      if (parsed?.isError) {
        log.error(`Dispatch to ${seat.label} returned an error: ${responseText}`);
        broadcastEvent("agent", {
          runId,
          sessionKey,
          stream: "lifecycle",
          data: { phase: "error", error: responseText },
        });
        resolve({ result: "", error: responseText });
        return;
      }

      // Emit lifecycle end + final chat for frontend
      broadcastEvent("agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "end" },
      });
      broadcastEvent("chat", {
        runId,
        sessionKey,
        state: "final",
        message: { content: [{ type: "text", text: responseText }] },
      });

      log.info(`Dispatch to ${seat.label} completed (run ${runId})`);
      resolve({ result: responseText });
    };

    // A service provider answers in place — there is no child to watch.
    if (provider.kind === "service") {
      if (!provider.run) {
        complete(null, `${provider.displayName} has no run implementation.`);
        return;
      }
      runningCount += 1;
      provider
        .run(runOptions)
        .then((parsed) => {
          runningCount = Math.max(0, runningCount - 1);
          complete(parsed, null);
        })
        .catch((err: unknown) => {
          runningCount = Math.max(0, runningCount - 1);
          complete(null, (err as Error)?.message ?? String(err));
        });
      return;
    }

    if (!provider.buildRun || !provider.parseResult) {
      complete(null, `${provider.displayName} has no CLI implementation.`);
      return;
    }

    const spec = provider.buildRun(runOptions);

    runningCount += 1;
    let child: ChildProcess;
    try {
      child = spawn(spec.bin, spec.args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: spec.cwd,
        env: {
          ...process.env,
          WATERCOOLER_SEAT: seat.label,
          ERP_DB_PATH: erpDatabasePath(),
        },
      });
    } catch (err) {
      runningCount = Math.max(0, runningCount - 1);
      const errMsg = `Failed to spawn ${provider.binName} for dispatch: ${(err as Error).message}`;
      log.error(errMsg);
      broadcastEvent("agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: errMsg },
      });
      resolve({ result: "", error: errMsg });
      return;
    }

    let timedOut = false;
    const cancelTimeout = guardRunTime(child, (seconds) => {
      timedOut = true;
      log.error(`dispatch to ${seat.label} exceeded ${seconds}s and was stopped`);
      broadcastEvent("agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "error",
          error: `${seat.label} was stopped after ${seconds}s with no reply.`,
        },
      });
      resolve({ result: "", error: `Stopped after ${seconds}s with no reply` });
    });

    let stdout = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      cancelTimeout();
      runningCount = Math.max(0, runningCount - 1);
      log.error(`dispatch process error for run ${runId}:`, err.message);
      broadcastEvent("agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: err.message },
      });
      resolve({ result: "", error: err.message });
    });

    child.on("close", (code) => {
      cancelTimeout();
      runningCount = Math.max(0, runningCount - 1);
      // The timeout already resolved this run
      if (timedOut) return;
      if (code !== 0) {
        complete(null, stderr.trim() || `${provider.binName} exited with code ${code}`);
        return;
      }

      complete(provider.parseResult!(stdout), null, stdout.trim());
    });
  });
}

/** Validate the dispatch secret from an HTTP request. */
export function validateDispatchSecret(secret: string): boolean {
  return secret === dispatchSecret;
}

/** How many workers the room currently has, for logging and tests. */
export function workerCount(room: string = DEFAULT_ROOM_SLUG): number {
  return getWorkerRoster(room).length;
}

// ── Cleanup ────────────────────────────────────────────

function cleanupClient(state: ClientState) {
  clients.delete(state);
  for (const [runId, child] of state.runningProcesses) {
    log.info(`Killing orphaned process for run ${runId}`);
    child.kill("SIGTERM");
  }
  state.runningProcesses.clear();
}

// ── Public API ─────────────────────────────────────────

/**
 * Attach the CLI bridge WebSocket handler to an HTTP server.
 * Intercepts upgrade requests on `path` and handles them with the
 * emulated OpenClaw gateway protocol, backed by the given CLI provider.
 */
export function attachCliBridge(
  server: import("http").Server,
  cliProvider: CliProvider,
  path = "/api/gateway",
) {
  provider = cliProvider;
  log = createLogger(`${provider.displayName} Bridge`);

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // The room rides as a query parameter, so compare the path only
    const requestPath = (req.url ?? "").split("?")[0];
    if (requestPath !== path) return;
    if (!checkOrigin(req, socket)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: ClientState = {
        ws,
        room: normaliseRoomSlug(
          new URL(req.url ?? "", "http://localhost").searchParams.get("room"),
        ),
        seq: 0,
        runningProcesses: new Map(),
        sessionMap: new Map(),
      };

      clients.add(state);
      log.info(`Client connected (${clients.size} watching)`);

      // Send connect challenge immediately
      sendEvent(state, "connect.challenge", {});

      ws.on("message", (data) => {
        handleMessage(state, data.toString());
      });

      ws.on("close", () => {
        log.info("Client disconnected");
        cleanupClient(state);
      });

      ws.on("error", (err) => {
        log.error("Client WS error:", err.message);
        cleanupClient(state);
      });
    });
  });

  wss.on("error", (err) => {
    log.error("WebSocketServer error:", err.message);
  });

  process.on("exit", cleanupMcpConfig);

  log.info(
    provider.kind === "service"
      ? `${provider.displayName} bridge attached on ${path} (hosted service)`
      : `${provider.displayName} bridge attached on ${path} (bin: ${resolveBin(provider)})`,
  );
}
