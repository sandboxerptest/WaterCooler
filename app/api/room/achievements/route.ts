/**
 * The room's badges, for a panel that has just been opened.
 *
 * Earning one is announced on the socket as it happens; this is the catch-up,
 * so the wall of them survives a refresh and is there for whoever joins next.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ROOM, getRoomStore } from "@/lib/server/room-store";
import { normaliseRoomSlug } from "@/lib/rooms";
import { createLogger } from "@/lib/logger";

const log = createLogger("AchievementsAPI");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = normaliseRoomSlug(url.searchParams.get("room") ?? DEFAULT_ROOM);

  try {
    return NextResponse.json({ earned: getRoomStore().listAchievements(room) });
  } catch (err) {
    log.error("could not read the badges:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read the achievements" }, { status: 500 });
  }
}
