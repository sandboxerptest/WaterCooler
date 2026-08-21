"use client";

/**
 * Client side of the room state API.
 *
 * The server owns the world; this module fetches it and writes changes back.
 * Writes are coalesced and debounced, because the store persists whole
 * collections on every reducer change and we do not want a request per
 * keystroke of an agent's streaming reply.
 */

import type { TaskItem, ChatMessage, SessionRecord } from "@/types/game";
import type { PersistedSeatConfig } from "./persistence";
import { createLogger } from "./logger";

const log = createLogger("Room");

const ENDPOINT = "/api/room/state";

/** Long enough to batch a burst of reducer updates, short enough to survive a refresh. */
export const WRITE_DEBOUNCE_MS = 400;

export interface RoomBudget {
  spentUsd: number;
  limitUsd: number;
  halted: boolean;
}

export interface RoomSnapshot {
  tasks: TaskItem[];
  messages: ChatMessage[];
  sessions: SessionRecord[];
  seats: PersistedSeatConfig[];
  activeSessionKey: string | null;
  budget?: RoomBudget;
}

export interface RoomPatch {
  tasks?: TaskItem[];
  messages?: ChatMessage[];
  sessions?: SessionRecord[];
  seats?: PersistedSeatConfig[];
  activeSessionKey?: string | null;
}

const EMPTY: RoomSnapshot = {
  tasks: [],
  messages: [],
  sessions: [],
  seats: [],
  activeSessionKey: null,
};

/**
 * Read the world. A failure yields an empty room rather than throwing: the app
 * should still open if the server is unreachable, just with nothing in it.
 */
export async function fetchRoomSnapshot(mainSessionKey: string): Promise<RoomSnapshot> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store" });
    if (!response.ok) {
      log.warn(`snapshot request failed: ${response.status}`);
      return EMPTY;
    }
    const raw = (await response.json()) as Partial<RoomSnapshot>;

    // Rows written before sessions existed carry no key. Anchor them to the
    // room's active session so they stay visible, falling back to main only
    // when the room has no active session at all.
    const fallbackSessionKey = raw.activeSessionKey ?? mainSessionKey;

    return {
      tasks: (raw.tasks ?? []).map((task) => ({
        ...task,
        sessionKey: task.sessionKey ?? fallbackSessionKey,
      })),
      messages: (raw.messages ?? []).map((message) => ({
        ...message,
        sessionKey: message.sessionKey ?? fallbackSessionKey,
      })),
      sessions: raw.sessions ?? [],
      seats: raw.seats ?? [],
      activeSessionKey: raw.activeSessionKey ?? null,
      budget: raw.budget,
    };
  } catch (err) {
    log.warn("snapshot failed:", (err as Error).message);
    return EMPTY;
  }
}

let pending: RoomPatch = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const body = pending;
  pending = {};
  if (Object.keys(body).length === 0) return;

  try {
    const response = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) log.warn(`write failed: ${response.status}`);
  } catch (err) {
    log.warn("write failed:", (err as Error).message);
  }
}

/**
 * Queue a slice of world state to be written. Later values for the same slice
 * replace earlier ones, so a burst collapses into one request.
 */
export function saveRoomPatch(patch: RoomPatch) {
  pending = { ...pending, ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    inFlight = flush();
  }, WRITE_DEBOUNCE_MS);
}

/** Write anything queued right now — used when the page is going away. */
export function flushRoomWrites(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  inFlight = flush();
  return inFlight;
}

/** Test seam: drop anything queued without writing it. */
export function resetRoomWrites() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = {};
  inFlight = null;
}
