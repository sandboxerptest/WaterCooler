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
import { DEFAULT_ROOM, ROOM_SPEND_LIMIT_USD, getRoomStore } from "./server/room-store";
import {
  ensureSeatWorkspace,
  getCliProvider,
  parseJsonObject,
  resolveBin,
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
function getWorkerRoster(): WorkerInfo[] {
  try {
    const seats = getRoomStore().getSnapshot(DEFAULT_ROOM).seats as Array<{
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

function atCapacity(): boolean {
  return runningCount >= MAX_CONCURRENT_RUNS;
}

/** Reason this provider cannot run right now, or null when it is ready. */
function providerBlocked(): string | null {
  const reason = provider.preflight?.() ?? null;
  if (reason) return reason;

  if (atCapacity()) {
    return `Too many agents are working at once (${MAX_CONCURRENT_RUNS}). Try again in a moment.`;
  }

  try {
    if (getRoomStore().isOverBudget(DEFAULT_ROOM)) {
      return `This room has reached its $${ROOM_SPEND_LIMIT_USD} spend limit. Agents are paused.`;
    }
  } catch (err) {
    log.warn("could not check the budget:", (err as Error).message);
  }

  return null;
}

/** Tell every watcher where the room stands against its limit. */
function broadcastBudget() {
  try {
    const store = getRoomStore();
    const spentUsd = store.getSpend(DEFAULT_ROOM);
    for (const client of clients) {
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
function recordSpend(parsed: { costUsd?: number } | null) {
  if (!parsed?.costUsd) return;
  try {
    getRoomStore().addSpend(DEFAULT_ROOM, parsed.costUsd);
    broadcastBudget();
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

function buildWorkerRosterContext(currentSeatLabel?: string): string {
  const workerRoster = getWorkerRoster();
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
function buildPersonality(params: Record<string, unknown>): string {
  const label = params.seatLabel as string | undefined;
  const role = params.seatRole as string | undefined;
  if (!label && !role) {
    return `You are powered by ${provider.displayName}. Stay in character when responding.`;
  }
  const parts: string[] = [];
  if (label) parts.push(`Your name is "${label}".`);
  if (role) parts.push(`Your role is ${role}.`);
  parts.push("Stay in character when responding.");
  return `${parts.join(" ")}${buildWorkerRosterContext(label)}`;
}

function handleChatSend(state: ClientState, id: string, params: Record<string, unknown>) {
  const sessionKey = (params.sessionKey as string) ?? "default";
  const message = (params.message as string) ?? "";
  const runId = `${provider.id}_${Date.now()}_${++runCounter}`;

  // Immediate response with runId
  sendResponse(state, id, true, { runId, status: "accepted" });

  // A missing key, a full queue or an exhausted budget should read as a plain
  // sentence in the worker's bubble, not as a mysterious non-zero exit code.
  const blocked = providerBlocked();
  if (blocked) {
    log.warn(`refusing run ${runId}: ${blocked}`);
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

  const spec = provider.buildRun({
    message,
    personality: buildPersonality(params),
    sessionId: state.sessionMap.get(sessionKey),
    // Attach the MCP server for worker dispatch if we have a roster
    mcpConfigPath: writeMcpConfig(),
    model: (params.model as string | undefined) ?? process.env.AGENT_TOWN_MODEL,
    workspaceDir: provider.usesWorkspaces
      ? ensureSeatWorkspace((params.seatLabel as string | undefined) ?? sessionKey, DEFAULT_ROOM)
      : undefined,
  });

  log.info(`Spawning ${provider.displayName} for run ${runId} in ${spec.cwd ?? process.cwd()}`);

  const port = process.env.PORT ?? "3000";
  let child: ChildProcess;
  try {
    child = spawn(spec.bin, spec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: spec.cwd,
      env: {
        ...process.env,
        AGENT_TOWN_PORT: port,
        AGENT_TOWN_WORKERS: JSON.stringify(getWorkerRoster()),
        AGENT_TOWN_DISPATCH_SECRET: dispatchSecret,
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

  let stdout = "";
  let stderr = "";

  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("error", (err) => {
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
    state.runningProcesses.delete(runId);
    runningCount = Math.max(0, runningCount - 1);

    if (code === null || code !== 0) {
      const errMsg = stderr.trim() || `${provider.binName} exited with code ${code}`;
      log.error(`${provider.binName} failed for run ${runId}:`, errMsg);
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: errMsg },
      });
      sendEvent(state, "chat", { runId, sessionKey, state: "error" });
      return;
    }

    const parsed = provider.parseResult(stdout);
    if (!parsed) {
      log.error(
        `${provider.binName} produced unparseable output for run ${runId}:`,
        stdout.slice(0, 500),
      );
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: `Failed to parse ${provider.displayName} output` },
      });
      sendEvent(state, "chat", { runId, sessionKey, state: "error" });
      return;
    }

    recordSpend(parsed);

    // Store the CLI session id so the next message to this seat resumes it
    if (parsed.sessionId) {
      state.sessionMap.set(sessionKey, parsed.sessionId);
      log.debug(`Mapped sessionKey ${sessionKey} → ${provider.id} session ${parsed.sessionId}`);
    }

    // A zero exit code with is_error set means the CLI ran but refused the turn
    // (not logged in, quota, invalid model). Surface it instead of speaking it.
    if (parsed.isError) {
      log.error(`${provider.displayName} returned an error for run ${runId}: ${parsed.text}`);
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: parsed.text },
      });
      sendEvent(state, "chat", { runId, sessionKey, state: "error" });
      return;
    }

    const responseText = parsed.text;

    // Lifecycle end
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "end" },
    });

    // Final chat message
    sendEvent(state, "chat", {
      runId,
      sessionKey,
      state: "final",
      message: { content: [{ type: "text", text: responseText }] },
    });

    log.info(`Run ${runId} completed successfully`);
  });
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

function getMcpServerPath(): string {
  // Resolve the MCP server script relative to the project root.
  // In dev (tsx) process.cwd() is the project root; in prod the server
  // is started from the package root.  Either way, lib/mcp/ lives there.
  return join(process.cwd(), "lib", "mcp", "agent-town-mcp.mjs");
}

/** Write (or reuse) a temporary MCP config file pointing at our stdio server. */
function writeMcpConfig(): string | null {
  // Delegation only makes sense with someone to delegate to
  if (getWorkerRoster().length <= 1) return null;
  if (mcpConfigPath) return mcpConfigPath;
  try {
    const config = {
      mcpServers: {
        "agent-town": {
          command: "node",
          args: [getMcpServerPath()],
        },
      },
    };
    const dir = join(tmpdir(), "agent-town-mcp");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `mcp-config-${process.pid}.json`);
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
): Promise<{ result: string; error?: string }> {
  return new Promise((resolve) => {
    const seat = getWorkerRoster().find((w) => w.seatId === seatId);
    if (!seat) {
      resolve({ result: "", error: `Unknown seatId: ${seatId}` });
      return;
    }

    // Delegation respects the same key, capacity and budget rules; otherwise a
    // single agent could fan out past every limit by dispatching.
    const blocked = providerBlocked();
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
    const spec = provider.buildRun({
      message: task,
      personality: buildPersonality({ seatLabel: seat.label, seatRole: seat.roleTitle }),
      sessionId: dispatchSessions.get(seatSessionKey),
      // A dispatched worker does not delegate onward, so no MCP config.
      mcpConfigPath: null,
      model: process.env.AGENT_TOWN_MODEL,
      workspaceDir: provider.usesWorkspaces
        ? ensureSeatWorkspace(seat.label, DEFAULT_ROOM)
        : undefined,
    });

    log.info(`Dispatching to ${seat.label} (${seatId}), run ${runId}`);

    runningCount += 1;
    let child: ChildProcess;
    try {
      child = spawn(spec.bin, spec.args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: spec.cwd,
        env: { ...process.env },
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

    let stdout = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
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
      runningCount = Math.max(0, runningCount - 1);
      if (code !== 0) {
        const errMsg = stderr.trim() || `${provider.binName} exited with code ${code}`;
        log.error(`dispatch failed for run ${runId}:`, errMsg);
        broadcastEvent("agent", {
          runId,
          sessionKey,
          stream: "lifecycle",
          data: { phase: "error", error: errMsg },
        });
        resolve({ result: "", error: errMsg });
        return;
      }

      const parsed = provider.parseResult(stdout);
      recordSpend(parsed);
      const responseText = parsed ? parsed.text : stdout.trim();

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
    });
  });
}

/** Validate the dispatch secret from an HTTP request. */
export function validateDispatchSecret(secret: string): boolean {
  return secret === dispatchSecret;
}

/** How many workers the room currently has, for logging and tests. */
export function workerCount(): number {
  return getWorkerRoster().length;
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
    if (req.url !== path) return;
    if (!checkOrigin(req, socket)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: ClientState = {
        ws,
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

  log.info(`${provider.displayName} bridge attached on ${path} (bin: ${resolveBin(provider)})`);
}
