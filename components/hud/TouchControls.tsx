"use client";

import { useSyncExternalStore } from "react";
import { gameEvents } from "@/lib/events";

/**
 * The controls a phone needs and a keyboard does not.
 *
 * Walking is a tap on the floor, which the scene handles. This is the other
 * half: standing next to something and using it. On a desktop the E key does
 * the job and this stays out of the way.
 */

/** Whether this is a touch screen is a client-only fact, so SSR must not read it. */
const subscribeToNothing = () => () => {};
const readCoarse = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const notOnTheServer = () => false;

export default function TouchControls() {
  const touch = useSyncExternalStore(subscribeToNothing, readCoarse, notOnTheServer);
  if (!touch) return null;

  return (
    <button
      type="button"
      className="touch-action-btn"
      // Pointer rather than click: a click waits to see whether it is a
      // double tap, which is a long time to wait for a door to open
      onPointerDown={(event) => {
        event.preventDefault();
        gameEvents.emit("interact-pressed");
      }}
      aria-label="Use whatever you are standing next to"
      title="Use (E)"
    >
      E
    </button>
  );
}
