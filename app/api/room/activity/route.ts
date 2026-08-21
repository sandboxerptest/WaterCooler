/**
 * The room's log, for a panel that has just been opened.
 *
 * New lines arrive on the room socket; this is the catch-up, so a reader who
 * refreshes still sees what the room did while they were away.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ROOM, getRoomStore } from "@/lib/server/room-store";
import { normaliseRoomSlug } from "@/lib/rooms";
import { createLogger } from "@/lib/logger";

const log = createLogger("ActivityAPI");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = normaliseRoomSlug(url.searchParams.get("room") ?? DEFAULT_ROOM);

  try {
    return NextResponse.json({ entries: getRoomStore().listActivity(room) });
  } catch (err) {
    log.error("could not read the log:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read the activity log" }, { status: 500 });
  }
}
