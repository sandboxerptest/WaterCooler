/**
 * Liveness check for the host's health probe.
 *
 * Deliberately shallow: it reports that the process is up and can reach its
 * database, and nothing about agents. A failing API key or an exhausted budget
 * are not reasons to restart the server — recycling the container would drop
 * everyone out of their room without fixing either.
 */

import { NextResponse } from "next/server";
import { getRoomStore } from "@/lib/server/room-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getRoomStore().getSpend("health-probe");
    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
