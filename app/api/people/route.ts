import { getRoomStore } from "@/lib/server/room-store";
import { isHome } from "@/lib/world/floors";

export const dynamic = "force-dynamic";

const ID = /^[a-z0-9]{4,16}$/;

/** Who calls a building home: ?home=<slug>. */
export async function GET(request: Request) {
  const home = new URL(request.url).searchParams.get("home");
  if (!isHome(home)) return Response.json({ error: "Unknown building" }, { status: 400 });
  return Response.json({ people: getRoomStore().listPeople(home) });
}

/** Say who you are and where you work; a desk with your name appears there. */
export async function POST(request: Request) {
  let body: { id?: unknown; name?: unknown; home?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  const home = typeof body.home === "string" ? body.home : "";
  if (!ID.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  if (!name || name === "Guest")
    return Response.json({ error: "A name is needed" }, { status: 400 });
  if (!isHome(home)) return Response.json({ error: "Unknown building" }, { status: 400 });
  getRoomStore().upsertPerson({ id, name, home });
  return Response.json({ ok: true });
}
