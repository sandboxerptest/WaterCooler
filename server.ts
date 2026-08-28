/**
 * Custom Next.js dev server with WebSocket proxy.
 *
 * Proxies ws://localhost:3000/api/gateway → ws://GATEWAY_URL
 * so the browser never needs to connect to the gateway directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
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
const AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? "claude";
const CLI_PROVIDER = isCliProviderId(AGENT_PROVIDER) ? getCliProvider(AGENT_PROVIDER) : null;
// Expose provider to Next.js client code (compiled on-demand in dev)
process.env.NEXT_PUBLIC_AGENT_PROVIDER = AGENT_PROVIDER;

const app = next({ dev });
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
      attachCliBridge(server, CLI_PROVIDER);
      log.info(`Ready on http://localhost:${port}`);
      log.info(
        CLI_PROVIDER.kind === "service"
          ? `Provider: ${CLI_PROVIDER.displayName} (hosted service)`
          : `Provider: ${CLI_PROVIDER.displayName} (bridging via ${CLI_PROVIDER.binName} CLI)`,
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
