/**
 * Room state — the world as the server sees it.
 *
 * GET returns a snapshot for the client to render; PUT writes back the slices
 * that changed. Slices are whole collections for now because the client still
 * owns their ordering and trimming; per-entity events arrive with the
 * shared-world phase.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ROOM, getRoomStore } from "@/lib/server/room-store";
import { createLogger } from "@/lib/logger";

const log = createLogger("RoomAPI");

export const dynamic = "force-dynamic";

function roomFrom(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("room") || DEFAULT_ROOM;
}

export async function GET(request: Request) {
  try {
    const snapshot = getRoomStore().getSnapshot(roomFrom(request));
    return NextResponse.json(snapshot);
  } catch (err) {
    log.error("snapshot failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read room state" }, { status: 500 });
  }
}

interface StatePatch {
  tasks?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
  sessions?: Record<string, unknown>[];
  seats?: Record<string, unknown>[];
  activeSessionKey?: string | null;
}

export async function PUT(request: Request) {
  const room = roomFrom(request);

  let patch: StatePatch;
  try {
    patch = (await request.json()) as StatePatch;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  try {
    const store = getRoomStore();
    if (Array.isArray(patch.tasks)) store.replaceTasks(room, patch.tasks);
    if (Array.isArray(patch.messages)) store.replaceMessages(room, patch.messages);
    if (Array.isArray(patch.sessions)) store.replaceSessions(room, patch.sessions);
    if (Array.isArray(patch.seats)) store.replaceSeats(room, patch.seats);
    if (patch.activeSessionKey !== undefined) {
      store.setActiveSessionKey(room, patch.activeSessionKey);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("write failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to write room state" }, { status: 500 });
  }
}
