"use client";

import { useEffect, useRef } from "react";
import { gameEvents } from "../events";
import { createLogger } from "../logger";
import { loadPlayerName } from "../persistence";
import {
  MOVE_SEND_MS,
  type Facing,
  type PresencePlayer,
  type ServerMessage,
} from "../presence-types";

const log = createLogger("Presence");

/** Wait this long before trying the room socket again after it drops. */
const RECONNECT_MS = 2000;

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/room/socket`;
}

/**
 * Keeps this browser's character on the room socket.
 *
 * Outbound: the scene reports where our character is every frame; we forward a
 * sample of that at the tick rate. Inbound: the roster goes to the scene, which
 * owns how other people are drawn.
 *
 * Presence is best-effort. If the socket is down the office still works — you
 * are simply alone in it.
 */
export function usePresence() {
  const socketRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  // Only the welcome carries the cap; presence frames do not repeat it
  const capacityRef = useRef(0);
  const latestRef = useRef<{ x: number; y: number; facing: Facing; moving: boolean } | null>(null);
  const sentAtRef = useRef(0);
  const joinedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl());
      } catch (err) {
        log.warn("could not open room socket:", (err as Error).message);
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        const spawn = latestRef.current;
        socket.send(
          JSON.stringify({
            type: "join",
            name: loadPlayerName(),
            spriteKey: "player",
            x: spawn?.x ?? 0,
            y: spawn?.y ?? 0,
            facing: spawn?.facing ?? "down",
          }),
        );
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case "welcome": {
            selfIdRef.current = message.you;
            capacityRef.current = message.capacity;
            joinedRef.current = true;
            log.info(`joined as ${message.you} (${message.players.length}/${message.capacity})`);
            publish(message.players);
            break;
          }
          case "rejected": {
            joinedRef.current = false;
            capacityRef.current = message.capacity;
            log.warn(`room is full (${message.capacity} humans)`);
            gameEvents.emit("presence-count", message.capacity, message.capacity);
            break;
          }
          case "presence": {
            publish(message.players);
            break;
          }
          case "joined": {
            log.info(`${message.player.name} joined`);
            break;
          }
          case "left": {
            // Remove immediately rather than waiting for the next tick
            gameEvents.emit("presence-left", message.id);
            break;
          }
        }
      };

      socket.onclose = () => {
        joinedRef.current = false;
        socketRef.current = null;
        gameEvents.emit("presence-updated", []);
        if (disposed) return;
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      socket.onerror = () => {
        // onclose always follows, which is where reconnection is handled
        socket.close();
      };
    };

    /** Hand the scene everyone except ourselves. */
    const publish = (players: PresencePlayer[]) => {
      const others = players.filter((player) => player.id !== selfIdRef.current);
      gameEvents.emit("presence-updated", others);
      gameEvents.emit("presence-count", players.length, capacityRef.current);
    };

    const unsubscribeMove = gameEvents.on("player-moved", (position) => {
      const next = {
        x: position.x,
        y: position.y,
        facing: position.facing as Facing,
        moving: position.moving,
      };
      latestRef.current = next;

      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !joinedRef.current) return;

      // The scene reports every frame; the room only needs the tick rate
      const now = Date.now();
      if (now - sentAtRef.current < MOVE_SEND_MS) return;
      sentAtRef.current = now;

      socket.send(JSON.stringify({ type: "move", ...next }));
    });

    connect();

    return () => {
      disposed = true;
      unsubscribeMove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);
}
