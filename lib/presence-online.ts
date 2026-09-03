"use client";

import { useEffect, useSyncExternalStore } from "react";
import { onRoomMessage } from "./room-socket";
import type { OnlinePerson } from "./presence-types";

/**
 * Everyone on the server, wherever they are.
 *
 * The room socket carries the room's own roster twenty times a second; this
 * is the other list, the whole server's, sent whenever someone arrives,
 * leaves or walks somewhere else. It is what the People panel shows.
 */

let people: OnlinePerson[] = [];
const listeners = new Set<() => void>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  onRoomMessage((message) => {
    if (message.type !== "online") return;
    people = message.people;
    for (const listener of listeners) listener();
  });
}

export function onlinePeople(): OnlinePerson[] {
  return people;
}

export function subscribeOnline(listener: () => void): () => void {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NOBODY: OnlinePerson[] = [];

/** Everyone online, as the server last said. */
export function useOnline(): OnlinePerson[] {
  useEffect(listen, []);
  return useSyncExternalStore(subscribeOnline, onlinePeople, () => NOBODY);
}
