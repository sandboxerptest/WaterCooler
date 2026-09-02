"use client";

import { gameEvents } from "./events";
import { sendRoom } from "./room-socket";
import type { SayScope } from "./presence-types";

/**
 * Say something out loud to the room.
 *
 * The speaker's own bubble is shown immediately rather than waiting for the
 * server to echo it back — you should see your own words the moment you send
 * them, and the server only relays to other people.
 */
export function say(text: string, scope: SayScope = "room", id?: string): boolean {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return false;

  const sent = sendRoom({ type: "say", text: trimmed, scope, id });
  gameEvents.emit("self-said", trimmed);
  return sent;
}
