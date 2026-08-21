/**
 * The room's whiteboard, for a client that has just opened it.
 *
 * Live changes arrive on the room socket; this is the catch-up: the strokes
 * already on the board, in the order they were drawn.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ROOM, getRoomStore } from "@/lib/server/room-store";
import { normaliseRoomSlug } from "@/lib/rooms";
import { createLogger } from "@/lib/logger";

const log = createLogger("BoardAPI");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = normaliseRoomSlug(url.searchParams.get("room") ?? DEFAULT_ROOM);

  try {
    return NextResponse.json({ strokes: getRoomStore().listStrokes(room) });
  } catch (err) {
    log.error("could not read the board:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read the board" }, { status: 500 });
  }
}
