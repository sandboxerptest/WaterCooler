/**
 * The cauldron's high score table.
 *
 * Scores belong to the room rather than the browser: the point of a high score
 * is that somebody else has to look at it.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ROOM, getRoomStore } from "@/lib/server/room-store";
import { normaliseRoomSlug } from "@/lib/rooms";
import { recordActivity } from "@/lib/server/presence-socket";
import { createLogger } from "@/lib/logger";

const log = createLogger("PinballAPI");

export const dynamic = "force-dynamic";

function roomOf(request: Request): string {
  return normaliseRoomSlug(new URL(request.url).searchParams.get("room") ?? DEFAULT_ROOM);
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ scores: getRoomStore().topPinballScores(roomOf(request)) });
  } catch (err) {
    log.error("could not read the high scores:", (err as Error).message);
    return NextResponse.json({ error: "Failed to read the high scores" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { player?: unknown; score?: unknown };
    const score = Number(body.score);
    const player = typeof body.player === "string" ? body.player.trim() : "";

    // A score is a number of points, not a message: anything else is a bug or
    // somebody poking at the endpoint, and neither belongs on the board.
    if (!Number.isFinite(score) || score < 0) {
      return NextResponse.json({ error: "A score has to be a number" }, { status: 400 });
    }

    const room = roomOf(request);
    const scores = getRoomStore().recordPinballScore(room, player || "Guest", score);

    const place = scores.findIndex(
      (s) => s.player === (player || "Guest") && s.score === Math.round(score),
    );
    recordActivity(room, {
      kind: "game",
      actor: player || "Guest",
      text: `scored ${Math.round(score).toLocaleString()} at the cauldron`,
      detail:
        place === 0
          ? "a new high score"
          : place > 0
            ? `number ${place + 1} on the board`
            : undefined,
    });

    return NextResponse.json({ scores });
  } catch (err) {
    log.error("could not record a score:", (err as Error).message);
    return NextResponse.json({ error: "Failed to record the score" }, { status: 500 });
  }
}
