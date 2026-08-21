"use client";

/**
 * Keeps this client's world in step with everyone else's.
 *
 * Outbound: the store persists on every reducer change, so rather than
 * intercepting each action this diffs collections by object identity — the
 * reducer only builds a new object for something that actually changed, which
 * makes reference equality a reliable "is this new?" test.
 *
 * Inbound: changes from other players are applied with the exact object we
 * received, which lands in state by reference and is therefore recognised as
 * already-known on the next diff. That is what stops a change echoing around
 * the room forever.
 */

import type { TaskItem, ChatMessage, SessionRecord } from "@/types/game";
import type { PersistedSeatConfig } from "./persistence";
import type { WorldChange } from "./presence-types";
import { sendRoom } from "./room-socket";

/** Objects this client has already sent or received, by entity id. */
const known = new Map<string, unknown>();

function seen(id: string, value: unknown): boolean {
  if (known.get(id) === value) return true;
  known.set(id, value);
  return false;
}

/** Record an object that arrived from the room, so we do not send it back. */
export function markKnown(id: string, value: unknown) {
  known.set(id, value);
}

function send(change: WorldChange) {
  sendRoom({ type: "world", change });
}

export function syncTasks(tasks: TaskItem[]) {
  for (const task of tasks) {
    if (seen(`task:${task.taskId}`, task)) continue;
    send({ entity: "task", task: task as unknown as Record<string, unknown> });
  }
}

export function syncMessages(messages: ChatMessage[]) {
  for (const message of messages) {
    if (seen(`message:${message.id}`, message)) continue;
    send({ entity: "message", message: message as unknown as Record<string, unknown> });
  }
}

export function syncSeats(seats: PersistedSeatConfig[]) {
  for (const seat of seats) {
    if (seen(`seat:${seat.seatId}`, seat)) continue;
    send({ entity: "seat", seat: seat as unknown as Record<string, unknown> });
  }
}

export function syncSessions(sessions: SessionRecord[]) {
  for (const session of sessions) {
    const key =
      (session as unknown as { sessionKey?: string; key?: string }).sessionKey ??
      (session as unknown as { key?: string }).key;
    if (!key) continue;
    if (seen(`session:${key}`, session)) continue;
    send({ entity: "session", session: session as unknown as Record<string, unknown> });
  }
}

/**
 * Seed the ledger from the opening snapshot. Without this, the first diff
 * after load would treat the entire restored world as new and broadcast it.
 */
export function primeFromSnapshot(snapshot: {
  tasks: TaskItem[];
  messages: ChatMessage[];
  seats: PersistedSeatConfig[];
  sessions: SessionRecord[];
}) {
  for (const task of snapshot.tasks) known.set(`task:${task.taskId}`, task);
  for (const message of snapshot.messages) known.set(`message:${message.id}`, message);
  for (const seat of snapshot.seats) known.set(`seat:${seat.seatId}`, seat);
  for (const session of snapshot.sessions) {
    const key =
      (session as unknown as { sessionKey?: string; key?: string }).sessionKey ??
      (session as unknown as { key?: string }).key;
    if (key) known.set(`session:${key}`, session);
  }
}

/** Test seam. */
export function resetRoomSync() {
  known.clear();
}
