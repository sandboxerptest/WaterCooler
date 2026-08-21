"use client";

import { useEffect, useRef } from "react";
import { gameEvents } from "../events";
import { acquireRoomSocket, onRoomMessage, onRoomOpen, sendRoom } from "../room-socket";
import { currentRoom } from "../room-client";
import { createLogger } from "../logger";
import { loadPlayerName } from "../persistence";
import { MOVE_SEND_MS, type Facing, type PresencePlayer } from "../presence-types";

const log = createLogger("Presence");

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
  const selfIdRef = useRef<string | null>(null);
  // Only the welcome carries the cap; presence frames do not repeat it
  const capacityRef = useRef(0);
  const latestRef = useRef<{ x: number; y: number; facing: Facing; moving: boolean } | null>(null);
  const sentAtRef = useRef(0);
  const joinedRef = useRef(false);

  useEffect(() => {
    const release = acquireRoomSocket();

    /** Hand the scene everyone except ourselves. */
    const publish = (players: PresencePlayer[]) => {
      const others = players.filter((player) => player.id !== selfIdRef.current);
      gameEvents.emit("presence-updated", others);
      gameEvents.emit("presence-count", players.length, capacityRef.current);
    };

    const unsubOpen = onRoomOpen(() => {
      const spawn = latestRef.current;
      sendRoom({
        type: "join",
        room: currentRoom(),
        name: loadPlayerName(),
        spriteKey: "player",
        x: spawn?.x ?? 0,
        y: spawn?.y ?? 0,
        facing: spawn?.facing ?? "down",
      });
    });

    const unsubMessage = onRoomMessage((message) => {
      switch (message.type) {
        case "welcome":
          selfIdRef.current = message.you;
          capacityRef.current = message.capacity;
          joinedRef.current = true;
          log.info(`joined as ${message.you} (${message.players.length}/${message.capacity})`);
          publish(message.players);
          break;
        case "rejected":
          joinedRef.current = false;
          capacityRef.current = message.capacity;
          log.warn(`room is full (${message.capacity} humans)`);
          gameEvents.emit("presence-count", message.capacity, message.capacity);
          break;
        case "presence":
          publish(message.players);
          break;
        case "left":
          // Remove immediately rather than waiting for the next tick
          gameEvents.emit("presence-left", message.id);
          break;
        default:
          break;
      }
    });

    const unsubscribeMove = gameEvents.on("player-moved", (position) => {
      const next = {
        x: position.x,
        y: position.y,
        facing: position.facing as Facing,
        moving: position.moving,
      };
      latestRef.current = next;
      if (!joinedRef.current) return;

      // The scene reports every frame; the room only needs the tick rate
      const now = Date.now();
      if (now - sentAtRef.current < MOVE_SEND_MS) return;
      sentAtRef.current = now;

      sendRoom({ type: "move", ...next });
    });

    return () => {
      unsubOpen();
      unsubMessage();
      unsubscribeMove();
      joinedRef.current = false;
      release();
    };
  }, []);
}
