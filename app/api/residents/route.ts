import { residentWhereabouts } from "@/lib/server/residents";

export const dynamic = "force-dynamic";

/** Where every resident agent is right now, for the places that have no room. */
export async function GET() {
  return Response.json({ residents: residentWhereabouts() });
}
