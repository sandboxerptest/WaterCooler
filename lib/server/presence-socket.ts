/**
 * Room socket — carries who is where, what they say, and what they change.
 *
 * Traffic here is deliberately mixed: presence is constant and lossy, speech
 * and world changes are rare and must not be dropped. They share a connection
 * because they concern the same room.
 *
 * Rooms are separate worlds. Presence, speech and world changes are keyed by
 * room and never cross between them.
 */

import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { PresenceHub } from "./presence-hub";
import { getRoomStore } from "./room-store";
import { normaliseRoomSlug } from "../rooms";
import { createLogger } from "../logger";
import {
  EARSHOT_PX,
  HEARTBEAT_MS,
  TICK_MS,
  isClientMessage,
  isWorldChange,
  type Facing,
  type SayScope,
  type ServerMessage,
  type WorldChange,
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

interface Room {
  hub: PresenceHub;
  sockets: Map<string, WebSocket>;
}

export function attachPresenceSocket(server: import("http").Server, path = "/api/room/socket") {
  const wss = new WebSocketServer({ noServer: true });

  const rooms = new Map<string, Room>();
  /** Which room each connection is in, so later messages can be routed. */
  const roomOf = new Map<string, string>();

  const roomFor = (slug: string): Room => {
    let room = rooms.get(slug);
    if (!room) {
      room = { hub: new PresenceHub(), sockets: new Map() };
      rooms.set(slug, room);
      log.info(`opened room "${slug}"`);
    }
    return room;
  };

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("send failed:", (err as Error).message);
    }
  };

  const broadcast = (slug: string, message: ServerMessage, exceptId?: string) => {
    const room = rooms.get(slug);
    if (!room) return;
    for (const [id, socket] of room.sockets) {
      if (id === exceptId) continue;
      send(socket, message);
    }
  };

  const drop = (id: string) => {
    const slug = roomOf.get(id);
    roomOf.delete(id);
    if (!slug) return;

    const room = rooms.get(slug);
    if (!room) return;

    const player = room.hub.leave(id);
    room.sockets.delete(id);
    if (player) {
      log.info(`${player.name} left "${slug}" (${room.hub.count}/${room.hub.capacity})`);
      broadcast(slug, { type: "left", id, name: player.name });
    }

    // An empty room costs nothing to forget; its contents live in the store
    if (room.sockets.size === 0 && room.hub.count === 0) rooms.delete(slug);
  };

  /**
   * Persist one change and pass it on. The author already applied it locally,
   * so the echo goes to everyone else — the room converges without the author
   * seeing their own action arrive twice.
   */
  const applyWorldChange = (slug: string, authorId: string, change: WorldChange) => {
    const room = rooms.get(slug);
    if (!room) return;

    const store = getRoomStore();
    const author = room.hub.snapshot().find((player) => player.id === authorId);
    const by = author && { id: author.id, name: author.name };

    switch (change.entity) {
      case "task": {
        // Stamp who asked, unless the client already said
        const task = { ...change.task };
        if (!task.requestedBy && author) {
          task.requestedBy = author.id;
          task.requestedByName = author.name;
        }
        store.upsertTask(slug, task);
        broadcast(slug, { type: "world", change: { entity: "task", task }, by }, authorId);
        return;
      }
      case "message":
        store.appendMessage(slug, change.message);
        break;
      case "seat":
        store.upsertSeat(slug, change.seat);
        break;
      case "session":
        store.upsertSession(slug, change.session);
        break;
    }

    broadcast(slug, { type: "world", change, by }, authorId);
  };

  /**
   * Pass on something a human said, and keep it with the room's history so it
   * is still there after a refresh.
   *
   * "nearby" is filtered by the positions presence already tracks: it reaches
   * whoever is within earshot, which is the point of having an office rather
   * than a chat window.
   */
  const relaySpeech = (slug: string, authorId: string, text: string, scope: SayScope) => {
    const room = rooms.get(slug);
    if (!room) return;

    const roster = room.hub.snapshot();
    const author = roster.find((player) => player.id === authorId);
    if (!author) return;

    const said = {
      type: "said" as const,
      id: randomUUID(),
      from: { id: author.id, name: author.name },
      text,
      at: new Date().toISOString(),
      scope,
    };

    try {
      const store = getRoomStore();
      store.appendMessage(slug, {
        id: said.id,
        runId: "",
        role: "player",
        content: text,
        actorName: author.name,
        timestamp: said.at,
        sessionKey: store.getSnapshot(slug).activeSessionKey ?? "main",
      });
    } catch (err) {
      log.warn("could not keep what was said:", (err as Error).message);
    }

    for (const [id, socket] of room.sockets) {
      if (id === authorId) continue;
      if (scope === "nearby") {
        const listener = roster.find((player) => player.id === id);
        if (!listener) continue;
        if (Math.hypot(listener.x - author.x, listener.y - author.y) > EARSHOT_PX) continue;
      }
      send(socket, said);
    }
  };

  // Standing still is not the same as being gone: a player who never moves
  // still holds a live socket. Ping them and count the reply as presence, so
  // only a genuinely dead connection is swept.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const [id, socket] of room.sockets) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        try {
          socket.ping();
        } catch {
          drop(id);
        }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  // One timer for every room rather than one per player
  const ticker = setInterval(() => {
    for (const [slug, room] of rooms) {
      for (const gone of room.hub.sweep()) {
        log.info(`${gone.name} timed out of "${slug}"`);
        room.sockets.get(gone.id)?.close();
        room.sockets.delete(gone.id);
        roomOf.delete(gone.id);
        broadcast(slug, { type: "left", id: gone.id, name: gone.name });
      }

      if (room.hub.count === 0) continue;
      broadcast(slug, { type: "presence", players: room.hub.snapshot() });
    }
  }, TICK_MS);
  ticker.unref?.();

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
          const slug = normaliseRoomSlug(parsed.room);
          const room = roomFor(slug);

          const result = room.hub.join(id, {
            name: typeof parsed.name === "string" ? parsed.name : "Guest",
            spriteKey: typeof parsed.spriteKey === "string" ? parsed.spriteKey : "player",
            x: coerceNumber(parsed.x),
            y: coerceNumber(parsed.y),
            facing: coerceFacing(parsed.facing),
          });

          if (!result.ok) {
            log.info(`refused a join to "${slug}": full (${room.hub.capacity} humans)`);
            send(ws, { type: "rejected", reason: "full", capacity: result.capacity });
            ws.close();
            return;
          }

          room.sockets.set(id, ws);
          roomOf.set(id, slug);
          log.info(
            `${result.player.name} joined "${slug}" (${room.hub.count}/${room.hub.capacity})`,
          );

          send(ws, {
            type: "welcome",
            you: id,
            players: room.hub.snapshot(),
            capacity: room.hub.capacity,
          });
          broadcast(slug, { type: "joined", player: result.player }, id);
          return;
        }

        // Everything else requires having walked in first
        const slug = roomOf.get(id);
        if (!slug) return;
        const room = rooms.get(slug);
        if (!room?.hub.has(id)) return;

        if (parsed.type === "say") {
          const text = typeof parsed.text === "string" ? parsed.text.trim().slice(0, 500) : "";
          if (!text) return;
          relaySpeech(slug, id, text, parsed.scope === "nearby" ? "nearby" : "room");
          return;
        }

        if (parsed.type === "world") {
          if (!isWorldChange(parsed.change)) return;
          applyWorldChange(slug, id, parsed.change);
          return;
        }

        if (parsed.type === "move") {
          room.hub.move(id, {
            x: coerceNumber(parsed.x),
            y: coerceNumber(parsed.y),
            facing: coerceFacing(parsed.facing),
            moving: parsed.moving === true,
          });
        }
      });

      // A pong proves the browser is still there even when nobody is walking
      ws.on("pong", () => {
        const slug = roomOf.get(id);
        if (slug) rooms.get(slug)?.hub.touch(id);
      });

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

  log.info(`room socket attached on ${path}`);

  return { rooms };
}
