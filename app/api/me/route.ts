import { parseProfileUpdate } from "@/lib/accounts";
import { authConfigured, configuredProviders } from "@/lib/auth/config";
import { signedIn } from "@/lib/auth/session";
import { getRoomStore } from "@/lib/server/room-store";

export const dynamic = "force-dynamic";

/**
 * Who you are, to the server: whether sign-in is on, and if you are signed
 * in, your account with the profile and counts it keeps. Each call counts
 * as a visit — the welcome screen asks once per page load.
 */
export async function GET() {
  const auth = { enabled: authConfigured(), providers: configuredProviders() };
  const person = await signedIn();
  if (!person) return Response.json({ auth, account: null });
  const account = getRoomStore().visitAccount(person);
  return Response.json({ auth, account });
}

/** Choose, or change, who you are in the world: name, home building, character. */
export async function POST(request: Request) {
  const person = await signedIn();
  if (!person) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const profile = parseProfileUpdate(body);
  if (!profile)
    return Response.json({ error: "A name, a home and a character are needed" }, { status: 400 });
  const account = getRoomStore().saveAccountProfile(person, profile);
  return Response.json({ account });
}
