import { isCliProviderId } from "@/lib/cli-providers";
import { describeProviders, providerSwitch } from "@/lib/server/provider-choice";

export const dynamic = "force-dynamic";

/** Which AI runs the agents, and what else could. */
export async function GET() {
  const sw = providerSwitch();
  if (!sw) return Response.json({ error: "No agent bridge is running" }, { status: 404 });
  return Response.json(await describeProviders(sw.defaultId, sw.active()));
}

/** Switch the agents to another AI: { id }. Answers with the new state, or why not. */
export async function POST(request: Request) {
  const sw = providerSwitch();
  if (!sw) return Response.json({ error: "No agent bridge is running" }, { status: 404 });
  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!isCliProviderId(id)) return Response.json({ error: "Unknown provider" }, { status: 400 });
  const refused = await sw.switchTo(id);
  const state = await describeProviders(sw.defaultId, sw.active());
  if (refused) return Response.json({ error: refused, ...state }, { status: 409 });
  return Response.json(state);
}
