/**
 * Room socket — carries who is where.
 *
 * Runs alongside the agent bridge on its own path. Traffic here is lossy by
 * design: a dropped position frame is corrected 50ms later, so nothing is
 * queued or retried.
 */

import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { PresenceHub } from "./presence-hub";
import { DEFAULT_ROOM, getRoomStore } from "./room-store";
import { createLogger } from "../logger";
import { randomUUID as messageId } from "crypto";
import {
  EARSHOT_PX,
  HEARTBEAT_MS,
  TICK_MS,
  isClientMessage,
  isWorldChange,
  type SayScope,
  type WorldChange,
  type Facing,
  type ServerMessage,
} from "../presence-types";

const log = createLogger("Presence");

const FACINGS: Facing[] = ["up", "down", "left", "right"];

function coerceFacing(value: unknown): Facing {
  return FACINGS.includes(value as Facing) ? (value as Facing) : "down";
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Same-origin check, matching the agent bridge. */
function checkOrigin(req: IncomingMessage, socket: Duplex): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    if (new URL(origin).host !== host) {
      log.warn(`rejected upgrade: origin ${origin} does not match host ${host}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return false;
    }
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return false;
  }
  return true;
}

export function attachPresenceSocket(server: import("http").Server, path = "/api/room/socket") {
  const wss = new WebSocketServer({ noServer: true });
  const hub = new PresenceHub();
  const sockets = new Map<string, WebSocket>();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("send failed:", (err as Error).message);
    }
  };

  const broadcast = (message: ServerMessage, exceptId?: string) => {
    for (const [id, socket] of sockets) {
      if (id === exceptId) continue;
      send(socket, message);
    }
  };

  const drop = (id: string) => {
    const player = hub.leave(id);
    sockets.delete(id);
    if (player) {
      log.info(`${player.name} left (${hub.count}/${hub.capacity})`);
      broadcast({ type: "left", id, name: player.name });
    }
  };

  // Standing still is not the same as being gone: a player who never moves
  // still holds a live socket. Ping them and count the reply as presence, so
  // only a genuinely dead connection is swept.
  const heartbeat = setInterval(() => {
    for (const [id, socket] of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.ping();
      } catch {
        drop(id);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  // One timer for the whole room rather than one per player
  const ticker = setInterval(() => {
    for (const gone of hub.sweep()) {
      log.info(`${gone.name} timed out`);
      sockets.get(gone.id)?.close();
      sockets.delete(gone.id);
      broadcast({ type: "left", id: gone.id, name: gone.name });
    }

    if (hub.count === 0) return;
    broadcast({ type: "presence", players: hub.snapshot() });
  }, TICK_MS);
  // Never hold the process open for a room nobody is in
  ticker.unref?.();

  /**
   * Persist one change and pass it on. The sender already applied it locally,
   * so the echo goes to everyone else — the room converges without the author
   * seeing their own action arrive twice.
   */
  const applyWorldChange = (authorId: string, change: WorldChange) => {
    const store = getRoomStore();
    const author = hub.snapshot().find((player) => player.id === authorId);

    switch (change.entity) {
      case "task": {
        // Stamp who asked, unless the client already said
        const task = { ...change.task };
        if (!task.requestedBy && author) {
          task.requestedBy = author.id;
          task.requestedByName = author.name;
        }
        store.upsertTask(DEFAULT_ROOM, task);
        broadcast(
          {
            type: "world",
            change: { entity: "task", task },
            by: author && { id: author.id, name: author.name },
          },
          authorId,
        );
        return;
      }
      case "message":
        store.appendMessage(DEFAULT_ROOM, change.message);
        break;
      case "seat":
        store.upsertSeat(DEFAULT_ROOM, change.seat);
        break;
      case "session":
        store.upsertSession(DEFAULT_ROOM, change.session);
        break;
    }

    broadcast(
      { type: "world", change, by: author && { id: author.id, name: author.name } },
      authorId,
    );
  };

  /**
   * Pass on something a human said, and keep it with the room's history so it
   * is still there after a refresh.
   *
   * "nearby" is filtered by the positions presence already tracks: it reaches
   * whoever is within earshot, which is the point of having an office rather
   * than a chat window.
   */
  const relaySpeech = (authorId: string, text: string, scope: SayScope) => {
    const roster = hub.snapshot();
    const author = roster.find((player) => player.id === authorId);
    if (!author) return;

    const said = {
      type: "said" as const,
      id: messageId(),
      from: { id: author.id, name: author.name },
      text,
      at: new Date().toISOString(),
      scope,
    };

    try {
      getRoomStore().appendMessage(DEFAULT_ROOM, {
        id: said.id,
        runId: "",
        role: "player",
        content: text,
        actorName: author.name,
        timestamp: said.at,
        sessionKey: getRoomStore().getSnapshot(DEFAULT_ROOM).activeSessionKey ?? "main",
      });
    } catch (err) {
      log.warn("could not keep what was said:", (err as Error).message);
    }

    for (const [id, socket] of sockets) {
      if (id === authorId) continue;
      if (scope === "nearby") {
        const listener = roster.find((player) => player.id === id);
        if (!listener) continue;
        const distance = Math.hypot(listener.x - author.x, listener.y - author.y);
        if (distance > EARSHOT_PX) continue;
      }
      send(socket, said);
    }
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== path) return;
    if (!checkOrigin(req, socket)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = randomUUID();

      ws.on("message", (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!isClientMessage(parsed)) return;

        if (parsed.type === "join") {
          const result = hub.join(id, {
            name: typeof parsed.name === "string" ? parsed.name : "Guest",
            spriteKey: typeof parsed.spriteKey === "string" ? parsed.spriteKey : "player",
            x: coerceNumber(parsed.x),
            y: coerceNumber(parsed.y),
            facing: coerceFacing(parsed.facing),
          });

          if (!result.ok) {
            log.info(`refused a join: room full (${hub.capacity} humans)`);
            send(ws, { type: "rejected", reason: "full", capacity: result.capacity });
            ws.close();
            return;
          }

          sockets.set(id, ws);
          log.info(`${result.player.name} joined (${hub.count}/${hub.capacity})`);
          send(ws, {
            type: "welcome",
            you: id,
            players: hub.snapshot(),
            capacity: hub.capacity,
          });
          broadcast({ type: "joined", player: result.player }, id);
          return;
        }

        if (parsed.type === "say") {
          if (!hub.has(id)) return;
          const text = typeof parsed.text === "string" ? parsed.text.trim().slice(0, 500) : "";
          if (!text) return;
          relaySpeech(id, text, parsed.scope === "nearby" ? "nearby" : "room");
          return;
        }

        if (parsed.type === "world") {
          // Only someone in the room may change it
          if (!hub.has(id)) return;
          if (!isWorldChange(parsed.change)) return;
          applyWorldChange(id, parsed.change);
          return;
        }

        if (parsed.type === "move") {
          hub.move(id, {
            x: coerceNumber(parsed.x),
            y: coerceNumber(parsed.y),
            facing: coerceFacing(parsed.facing),
            moving: parsed.moving === true,
          });
        }
      });

      // A pong proves the browser is still there even when nobody is walking
      ws.on("pong", () => hub.touch(id));

      ws.on("close", () => drop(id));
      ws.on("error", (err) => {
        log.warn("socket error:", err.message);
        drop(id);
      });
    });
  });

  wss.on("error", (err) => log.error("WebSocketServer error:", err.message));

  server.on("close", () => {
    clearInterval(ticker);
    clearInterval(heartbeat);
  });

  log.info(`room socket attached on ${path} (capacity ${hub.capacity} humans)`);

  return hub;
}
