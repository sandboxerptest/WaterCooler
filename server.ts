/**
 * Custom Next.js dev server with WebSocket proxy.
 *
 * Proxies ws://localhost:3000/api/gateway → ws://GATEWAY_URL
 * so the browser never needs to connect to the gateway directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { loadEnvConfig } from "@next/env";
import next from "next";
import { createLogger } from "./lib/logger";
import { attachWsProxy } from "./lib/ws-proxy";
import {
  attachCliBridge,
  dispatchToWorker,
  getWorkerRoster,
  validateDispatchSecret,
} from "./lib/cli-bridge";
import { getCliProvider, isCliProviderId } from "./lib/cli-providers";
import { getRoomStore } from "./lib/server/room-store";
import {
  offeredProviders,
  providerBlocked,
  registerProviderSwitch,
  rememberProvider,
  rememberedProvider,
} from "./lib/server/provider-choice";
import { getBridgeProvider, setBridgeProvider } from "./lib/cli-bridge";
import { attachPresenceSocket } from "./lib/server/presence-socket";
import { ERP_DB_PATH, isEmpty, openErpDb, seedErpDatabase } from "./lib/erp/db";
import { DEFAULT_ROOM_SLUG } from "./lib/rooms";
import { readMettaraConfig } from "./lib/mettara/config";
import { buildOfficeTools } from "./lib/mettara/office-tools";
import { createToolsHandler, TOOLS_PATH } from "./lib/mettara/webhook";

const log = createLogger("Server");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789/";
// Next loads .env files during app.prepare(), long after the settings below
// are read. Without this, AGENT_PROVIDER in .env.local was silently ignored
// while every lazily-read key in the same file worked — so the app would boot
// on the wrong provider and say so in the HUD with no hint why.
loadEnvConfig(process.cwd(), dev);

const AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? "claude";
const CLI_PROVIDER = isCliProviderId(AGENT_PROVIDER) ? getCliProvider(AGENT_PROVIDER) : null;
// The agents boot on the Claude implementation — the CLI, or the API-keyed
// CLI where AGENT_PROVIDER says so — and Mettara is a switch away in the
// HUD. AGENT_PROVIDER=mettara only says Mettara is wanted; the HUD's choice,
// remembered in the room database, is what actually picks it.
const DEFAULT_PROVIDER =
  CLI_PROVIDER && CLI_PROVIDER.id !== "mettara" ? CLI_PROVIDER : getCliProvider("claude");
// Expose provider to Next.js client code (compiled on-demand in dev)
process.env.NEXT_PUBLIC_AGENT_PROVIDER = AGENT_PROVIDER;

// Next builds each request's absolute URL from what it is told here, not
// from the socket: without the port, sign-in callbacks would point at 3000
// whatever port the server is actually on.
const app = next({ dev, port, hostname: process.env.HOSTNAME ?? "localhost" });
const handle = app.getRequestHandler();

// ── Internal dispatch endpoint for MCP tool → auggie bridge ──

function handleDispatch(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Only accept requests from localhost
  const remoteIp = req.socket.remoteAddress;
  if (remoteIp !== "127.0.0.1" && remoteIp !== "::1" && remoteIp !== "::ffff:127.0.0.1") {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  const secret = req.headers["x-dispatch-secret"] as string | undefined;
  if (!secret || !validateDispatchSecret(secret)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid dispatch secret" }));
    return;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      const { seatId, task, room } = JSON.parse(body);
      if (!seatId || !task) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "seatId and task are required" }));
        return;
      }

      dispatchToWorker(seatId, task, typeof room === "string" ? room : undefined)
        .then((result) => {
          res.writeHead(result.error ? 500 : 200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err: Error) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
    }
  });
}

// ── Inbound tool endpoint for Mettara AIs ──

/**
 * Mettara AIs reach back into the office through one signed endpoint. It is
 * only mounted when the platform credentials are present: without a secret
 * there is nothing to verify signatures against, and an unauthenticated door
 * into worker dispatch is not one worth opening.
 */
function buildMettaraTools() {
  const config = readMettaraConfig();
  if (!config) return null;
  return createToolsHandler({
    secret: config.apiSecret,
    registry: buildOfficeTools({
      listWorkers: (room) => getWorkerRoster(room),
      dispatch: (seatId, task, room) => dispatchToWorker(seatId, task, room),
      defaultRoom: DEFAULT_ROOM_SLUG,
    }),
  });
}

// ── Seat config sync for auggie worker roster ──

/**
 * Build the company on first boot.
 *
 * A fresh deployment gets an empty volume, and agents told they have an ERP
 * would find nothing in it. Seeding here is idempotent — an existing database
 * is left exactly as it is, including anything agents have since written.
 */
function ensureErpData() {
  try {
    const db = openErpDb(ERP_DB_PATH);
    const empty = isEmpty(db);
    db.close();

    if (!empty) {
      log.info(`ERP ready at ${ERP_DB_PATH}`);
      return;
    }

    log.info("No company data found — creating Brightwater Supply Co.");
    const { db: seeded, counts } = seedErpDatabase(ERP_DB_PATH);
    seeded.close();
    log.info(`ERP seeded: ${counts.customers} customers, ${counts.invoices} invoices`);
  } catch (err) {
    // The office still works without it; agents will say the data is unreachable
    log.error("Could not prepare the ERP:", (err as Error).message);
  }
}

app
  .prepare()
  .then(() => {
    ensureErpData();
    const mettaraTools = CLI_PROVIDER ? buildMettaraTools() : null;
    const server = createServer((req, res) => {
      // Intercept internal API routes before Next.js
      if (CLI_PROVIDER) {
        if (req.url === "/api/internal/dispatch") {
          handleDispatch(req, res);
          return;
        }
        if (mettaraTools && (req.url ?? "").split("?")[0] === TOOLS_PATH) {
          void mettaraTools(req, res);
          return;
        }
      }
      handle(req, res);
    });

    // Players and agents ride separate sockets: presence is lossy and constant,
    // agent traffic is rare and must not be dropped.
    attachPresenceSocket(server);

    if (CLI_PROVIDER) {
      attachCliBridge(server, DEFAULT_PROVIDER);
      // The HUD may have switched the agents to another AI before; come
      // back on it, and let it switch again.
      const defaultId = DEFAULT_PROVIDER.id;
      const remembered = rememberedProvider(getRoomStore(), defaultId);
      if (remembered && remembered !== defaultId) setBridgeProvider(getCliProvider(remembered));
      registerProviderSwitch({
        defaultId,
        active: () => getBridgeProvider().id,
        async switchTo(id) {
          if (!offeredProviders(defaultId).includes(id))
            return "That provider is not offered here.";
          const blocked = await providerBlocked(id);
          if (blocked) return blocked;
          if (getBridgeProvider().id !== id) setBridgeProvider(getCliProvider(id));
          rememberProvider(getRoomStore(), id);
          return null;
        },
      });
      log.info(`Ready on http://localhost:${port}`);
      log.info(
        DEFAULT_PROVIDER.kind === "service"
          ? `Provider: ${DEFAULT_PROVIDER.displayName} (hosted service)`
          : `Provider: ${DEFAULT_PROVIDER.displayName} (bridging via ${DEFAULT_PROVIDER.binName} CLI)`,
      );
      if (mettaraTools) log.info(`Mettara tool endpoint: ${TOOLS_PATH}`);
    } else {
      attachWsProxy(server, GATEWAY_URL);
      log.info(`Ready on http://localhost:${port}`);
      log.info(`Gateway proxy: ws://localhost:${port}/api/gateway → ${GATEWAY_URL}`);
    }

    server.listen(port);
  })
  .catch((err) => {
    log.error("Failed to prepare Next.js:", err);
    process.exit(1);
  });
