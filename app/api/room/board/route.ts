/**
 * The whiteboard — the one board, shared by every room — for a client that
 * has just opened it.
 *
 * Live changes arrive on the room socket; this is the catch-up: the strokes
 * already on the board, in the order they were drawn.
 */

import { NextResponse } from "next/server";
import { getRoomStore } from "@/lib/server/room-store";
import { SHARED_BOARD } from "@/lib/whiteboard";
import { createLogger } from "@/lib/logger";

const log = createLogger("BoardAPI");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ strokes: getRoomStore().listStrokes(SHARED_BOARD) });
  } catch (err) {
    log.error("could not read the board:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read the board" }, { status: 500 });
  }
}
