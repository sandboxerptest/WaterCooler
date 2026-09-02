/**
 * Agent provider descriptors.
 *
 * A provider backs the emulated OpenClaw gateway (see cli-bridge.ts) by
 * answering one run at a time. Two kinds exist:
 *
 *   "cli"     — spawns a local agent CLI. The descriptor owns exactly two
 *               things: how to build the argv, and how to read the result back
 *               out of stdout.
 *   "service" — calls a hosted API in process. The descriptor owns a single
 *               `run` that resolves to the same parsed result.
 *
 * Either way the bridge stays provider-agnostic: it hands over a CliRunOptions
 * and gets a CliParsedResult back.
 */

import { accessSync, constants, mkdirSync } from "fs";
import { delimiter, isAbsolute, join } from "path";
import { homedir } from "os";
import { DEFAULT_AI_NAME, mettaraPreflight } from "./mettara/config";
import { runMettaraTurn } from "./mettara/client";

export type CliProviderId = "auggie" | "claude" | "claude-api" | "mettara";

export interface ModelChoice {
  id: string;
  provider: string;
  contextWindow?: number;
}

export interface CliRunOptions {
  /** The user-visible task or chat message. */
  message: string;
  /** Seat personality / roster context, already rendered to text. */
  personality: string;
  /** Provider session id to resume, if this seat has spoken before. */
  sessionId?: string;
  /** Path to a temporary MCP config, when worker dispatch is available. */
  mcpConfigPath?: string | null;
  /** Model id chosen in the HUD, if any. */
  model?: string;
  /** Sandbox directory this seat runs in (providers that support it). */
  workspaceDir?: string;
  /** Seat name, for providers that carry an identity per worker. */
  seatLabel?: string;
  /** Bridge session key — one conversation per seat. */
  sessionKey?: string;
}

export interface CliRunSpec {
  bin: string;
  args: string[];
  cwd?: string;
}

export interface CliParsedResult {
  text: string;
  sessionId?: string;
  isError?: boolean;
  /** What this turn cost, when the CLI reports it. */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CliProvider {
  id: CliProviderId;
  /** How the bridge reaches this provider. Absent means "cli". */
  kind?: "cli" | "service";
  /** Name shown in the HUD and logs. */
  displayName: string;
  /** Executable to look for on PATH. Service providers have none. */
  binName?: string;
  /** Env var that overrides the resolved executable path. */
  binEnvVar?: string;
  /** Whether each seat gets its own sandbox directory. */
  usesWorkspaces: boolean;
  /** Hint shown in the connection panel when the CLI is missing. */
  setupHint: string;
  /**
   * Checked before every run. Returns a human-readable reason the provider
   * cannot run right now, or null when it is ready — a missing API key should
   * say so in the worker's bubble, not fail as an opaque exit code.
   */
  preflight?(): string | null;
  /** Builds the argv for a run. Required for "cli" providers. */
  buildRun?(opts: CliRunOptions): CliRunSpec;
  /** Reads the result out of stdout. Required for "cli" providers. */
  parseResult?(raw: string): CliParsedResult | null;
  /** Takes one turn in process. Required for "service" providers. */
  run?(opts: CliRunOptions): Promise<CliParsedResult>;
  /** Argv for enumerating models, when the CLI can report them. */
  modelsCommand?: string[];
  /** Fallback list when the CLI cannot report models. */
  staticModels: ModelChoice[];
}

// ── Executable resolution ──────────────────────────────

/**
 * Resolve a CLI to an absolute path.
 *
 * The dev server does not necessarily inherit a login shell's PATH, so a bare
 * binary name can fail to spawn even when the CLI is installed. We check the
 * env override first, then PATH, then the usual install locations, and fall
 * back to the bare name so spawn errors stay readable.
 */
export function resolveBin(provider: CliProvider): string {
  // Service providers have no binary; nothing should be asking, but returning
  // an empty string keeps a mistake a readable spawn error rather than a throw.
  if (!provider.binName) return "";

  const override = provider.binEnvVar ? process.env[provider.binEnvVar] : undefined;
  if (override) return override;

  const searchPaths = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  for (const dir of searchPaths) {
    const candidate = join(dir, provider.binName);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return provider.binName;
}

// ── Seat workspaces ────────────────────────────────────

/**
 * Where seat sandboxes live. In the cloud this must point at mounted storage —
 * a container's own filesystem is wiped on every deploy, which would throw away
 * everything the agents have written.
 */
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT ?? ".agent-workspaces";

/** Filesystem-safe directory name for a seat. */
function slugify(seatKey: string): string {
  const slug = seatKey.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return slug || "seat";
}

/**
 * Return (creating if needed) the sandbox directory for a seat. Agents run with
 * their cwd set here, so edits stay inside their own space — and rooms are kept
 * apart, so one room's agents cannot read another's work.
 */
export function ensureSeatWorkspace(seatKey: string, room = "local"): string | undefined {
  const base = isAbsolute(WORKSPACE_ROOT) ? WORKSPACE_ROOT : join(process.cwd(), WORKSPACE_ROOT);
  const dir = join(base, slugify(room), slugify(seatKey));
  try {
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}

// ── Shared output parsing ──────────────────────────────

/**
 * Both CLIs print a single JSON object to stdout under `--output-format json`,
 * possibly preceded by diagnostic lines. Find the first `{` and parse from
 * there, falling back to the last JSON-looking line.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const idx = raw.indexOf("{");
  if (idx === -1) return null;
  try {
    return JSON.parse(raw.slice(idx)) as Record<string, unknown>;
  } catch {
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{")) {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }
    return null;
  }
}

function readResultText(parsed: Record<string, unknown>): string {
  if (typeof parsed.result === "string") return parsed.result;
  if (typeof parsed.response === "string") return parsed.response;
  return JSON.stringify(parsed);
}

// ── Auggie ─────────────────────────────────────────────

const auggieProvider: CliProvider = {
  id: "auggie",
  displayName: "Auggie",
  binName: "auggie",
  binEnvVar: "AUGGIE_BIN",
  usesWorkspaces: false,
  setupHint: "Make sure `auggie` is installed and authenticated.",

  buildRun({ message, personality, sessionId, mcpConfigPath }) {
    const args = ["--print", "--output-format", "json"];
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
    if (sessionId) args.push("--resume", sessionId);
    // Auggie has no system-prompt flag, so personality rides on the message.
    args.push("--", personality ? `[${personality}]\n\n${message}` : message);
    return { bin: resolveBin(auggieProvider), args };
  },

  parseResult(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;
    return {
      text: readResultText(parsed),
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    };
  },

  modelsCommand: ["model", "list", "--json"],
  staticModels: [{ id: "default", provider: "auggie", contextWindow: 128000 }],
};

// ── Claude Code ────────────────────────────────────────

/** Shared by both Claude providers: same CLI, different credentials. */
function parseClaudeResult(raw: string): CliParsedResult | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;

  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  const asCount = (value: unknown) => (typeof value === "number" ? value : undefined);

  return {
    text: readResultText(parsed),
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    isError: parsed.is_error === true,
    costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
    inputTokens: asCount(usage.input_tokens),
    outputTokens: asCount(usage.output_tokens),
  };
}

/**
 * MCP tools are not auto-approved in headless mode, so the dispatch tool has
 * to be named explicitly or delegation silently fails.
 */
const CLAUDE_DISPATCH_TOOL = "mcp__watercooler__dispatch_to_worker";

/**
 * The ERP tools. Headless runs deny anything not on the allowlist, so a tool
 * that is registered but not named here fails at the moment it is needed —
 * which reads to the model as "the data is not available".
 */
const ERP_TOOLS = [
  "mcp__brightwater-erp__erp_schema",
  "mcp__brightwater-erp__erp_query",
  "mcp__brightwater-erp__erp_create_lead",
  "mcp__brightwater-erp__erp_create_customer",
  "mcp__brightwater-erp__erp_create_quote",
  "mcp__brightwater-erp__erp_log_activity",
];

const claudeProvider: CliProvider = {
  id: "claude",
  displayName: "Claude Code",
  binName: "claude",
  binEnvVar: "CLAUDE_BIN",
  usesWorkspaces: true,
  setupHint: "Make sure `claude` is installed and logged in (run `claude` once and use /login).",

  buildRun({ message, personality, sessionId, mcpConfigPath, model, workspaceDir }) {
    const args = ["--print", "--output-format", "json"];

    // Edits are auto-approved, but only inside the seat's own workspace.
    args.push("--permission-mode", process.env.CLAUDE_PERMISSION_MODE ?? "acceptEdits");

    if (model) args.push("--model", model);
    if (personality) args.push("--append-system-prompt", personality);

    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
      const allowed = [CLAUDE_DISPATCH_TOOL, ...ERP_TOOLS];
      if (process.env.CLAUDE_ALLOWED_TOOLS) allowed.push(process.env.CLAUDE_ALLOWED_TOOLS);
      args.push("--allowedTools", allowed.join(","));
    } else if (process.env.CLAUDE_ALLOWED_TOOLS) {
      args.push("--allowedTools", process.env.CLAUDE_ALLOWED_TOOLS);
    }

    if (sessionId) args.push("--resume", sessionId);
    args.push("--", message);

    return { bin: resolveBin(claudeProvider), args, cwd: workspaceDir };
  },

  parseResult(raw) {
    return parseClaudeResult(raw);
  },

  // `claude` has no machine-readable model list; keep a curated one.
  staticModels: [
    { id: "opus", provider: "claude", contextWindow: 200000 },
    { id: "sonnet", provider: "claude", contextWindow: 200000 },
    { id: "haiku", provider: "claude", contextWindow: 200000 },
  ],
};

// ── Claude via API key ─────────────────────────────────

/**
 * The same CLI, credentialed with an Anthropic API key instead of a signed-in
 * account. This is what runs in the cloud, where there is no logged-in user and
 * a subscription cannot be shared: the key is read from the environment and
 * never passed on the command line, where it would show up in process listings.
 */
const claudeApiProvider: CliProvider = {
  id: "claude-api",
  displayName: "Claude (API key)",
  binName: "claude",
  binEnvVar: "CLAUDE_BIN",
  usesWorkspaces: true,
  setupHint: "Set ANTHROPIC_API_KEY in the server environment.",

  preflight() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return "No ANTHROPIC_API_KEY set on the server — agents cannot run.";
    if (!key.startsWith("sk-")) return "ANTHROPIC_API_KEY does not look like an API key.";
    return null;
  },

  buildRun(options) {
    const spec = claudeProvider.buildRun!(options);

    // --bare makes the API key the only credential: OAuth and the keychain are
    // never read. Without it the CLI happily falls back to whatever account is
    // signed in on the host, so a wrong key would still "work" and the server
    // would be billing someone's subscription instead of the key you set.
    // It also skips hooks, auto-memory and CLAUDE.md discovery, so a server
    // agent stops inheriting the host user's configuration.
    return { ...spec, args: ["--bare", ...spec.args] };
  },

  parseResult(raw) {
    return parseClaudeResult(raw);
  },

  staticModels: [
    { id: "opus", provider: "claude-api", contextWindow: 200000 },
    { id: "sonnet", provider: "claude-api", contextWindow: 200000 },
    { id: "haiku", provider: "claude-api", contextWindow: 200000 },
  ],
};

// ── Mettara ────────────────────────────────────────────

/**
 * Mettara Connect: agents run on our partner's hosted AI rather than on a
 * local CLI. There is no binary to install and no sandbox directory — a turn
 * is an API call — so this is the first "service" provider and the bridge
 * takes its `run` path instead of spawning.
 *
 * Mettara names its assistants by technical name, not by model id, so the
 * HUD's model field selects which AI a seat talks to.
 */
const mettaraProvider: CliProvider = {
  id: "mettara",
  kind: "service",
  displayName: "Mettara AI",
  usesWorkspaces: false,
  setupHint:
    "Set METTARA_API_SECRET and METTARA_PLATFORM_ID, and put the Mettara SDK in vendor/mettara-lib.",

  preflight() {
    return mettaraPreflight();
  },

  async run(options) {
    const reply = await runMettaraTurn({
      seatLabel: options.seatLabel,
      sessionKey: options.sessionKey ?? "default",
      message: options.message,
      personality: options.personality,
      conversationId: options.sessionId,
      aiName: options.model,
    });
    // The conversation id rides home as the session id, so the bridge's
    // existing sessionKey map resumes this seat's thread on its next turn
    // exactly as it resumes a Claude CLI session.
    return { text: reply.text, sessionId: reply.conversationId };
  },

  staticModels: [{ id: DEFAULT_AI_NAME, provider: "mettara" }],
};

// ── Registry ───────────────────────────────────────────

const PROVIDERS: Record<CliProviderId, CliProvider> = {
  auggie: auggieProvider,
  claude: claudeProvider,
  "claude-api": claudeApiProvider,
  mettara: mettaraProvider,
};

/** True when the configured provider is CLI-backed rather than a real gateway. */
export function isCliProviderId(value: string | undefined): value is CliProviderId {
  return value === "auggie" || value === "claude" || value === "claude-api" || value === "mettara";
}

export function getCliProvider(id: CliProviderId): CliProvider {
  return PROVIDERS[id];
}
