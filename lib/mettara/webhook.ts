/**
 * Inbound tool endpoint for Mettara Connect.
 *
 * A Mettara AI can reach back into the office: read the roster and hand a task
 * to a named worker. Requests arrive signed with the platform secret, so this
 * is the one door into the room that is open to the outside world — every
 * request is verified before a handler sees it.
 *
 * Mounted on the raw HTTP server rather than as a Next route handler because
 * dispatching needs the live bridge, and route handlers load in their own
 * module graph where the bridge has no connected clients.
 *
 * Docs: https://connect-a12e4c.gitlab.io/inbound-webhooks/
 */

import type { IncomingMessage, ServerResponse } from "http";
import { createLogger } from "../logger";
import { NonceStore, verifySignedRequest } from "./signature";

const log = createLogger("Mettara Tools");

export const TOOLS_PATH = "/api/mettara/tools";

/** Refuse oversized bodies rather than buffering whatever arrives. */
const MAX_BODY_BYTES = 256 * 1024;

export interface ToolRequest {
  name: string;
  arguments: Record<string, unknown>;
  /** Present when identity passthrough is enabled on the Mettara side. */
  externalUserId?: string;
  externalGroupId?: string;
}

export type ToolHandler = (req: ToolRequest) => Promise<unknown> | unknown;

/**
 * Named handlers, registered at startup. Mirrors the SDK's own
 * `registry.register(name, handler)` shape so the two stay recognisable.
 */
export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  get names(): string[] {
    return [...this.handlers.keys()];
  }
}

export interface ToolOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Verifies and runs one tool call. Pure over its inputs — the HTTP plumbing
 * lives in the handler below — so the signature and dispatch rules can be
 * tested without a socket.
 */
export async function handleToolCall(
  input: {
    method: string;
    path: string;
    body: string;
    headers: Record<string, string | undefined>;
  },
  deps: { secret: string; registry: ToolRegistry; nonces: NonceStore; now: number },
): Promise<ToolOutcome> {
  const verdict = verifySignedRequest(input, {
    secret: deps.secret,
    nonces: deps.nonces,
    now: deps.now,
  });
  if (!verdict.ok) {
    log.warn(`rejected tool call: ${verdict.detail}`);
    return { status: verdict.status ?? 401, body: { status: "error", error: verdict.detail } };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(input.body) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { status: "error", error: "Invalid JSON body" } };
  }

  const name = typeof parsed.name === "string" ? parsed.name : "";
  if (!name) return { status: 400, body: { status: "error", error: "Missing tool name" } };

  const handler = deps.registry.get(name);
  if (!handler) {
    return { status: 400, body: { status: "error", error: `Unknown tool: ${name}` } };
  }

  const args =
    parsed.arguments && typeof parsed.arguments === "object"
      ? (parsed.arguments as Record<string, unknown>)
      : {};

  try {
    const data = await handler({
      name,
      arguments: args,
      externalUserId:
        typeof parsed.external_user_id === "string" ? parsed.external_user_id : undefined,
      externalGroupId:
        typeof parsed.external_group_id === "string" ? parsed.external_group_id : undefined,
    });
    return { status: 200, body: { status: "success", data: data ?? null } };
  } catch (err) {
    log.error(`tool ${name} failed:`, (err as Error).message);
    return { status: 500, body: { status: "error", error: (err as Error).message } };
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let body = "";
    let bytes = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        resolve(null);
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!aborted) resolve(body);
    });
    req.on("error", () => resolve(null));
  });
}

/** Node HTTP adapter around {@link handleToolCall}. */
export function createToolsHandler(deps: { secret: string; registry: ToolRegistry }) {
  const nonces = new NonceStore();
  return async function handleToolsRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: "Method not allowed" }));
      return;
    }

    const body = await readBody(req);
    if (body === null) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: "Body too large" }));
      return;
    }

    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    const outcome = await handleToolCall(
      { method: req.method ?? "POST", path: req.url ?? TOOLS_PATH, body, headers },
      { secret: deps.secret, registry: deps.registry, nonces, now: Date.now() },
    );
    res.writeHead(outcome.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(outcome.body));
  };
}
