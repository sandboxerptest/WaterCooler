/**
 * Who is signed in, for a route handler. Server only.
 *
 * Null when sign-in is not set up or nobody is signed in; the two are the
 * same to a handler, which then treats the caller as a browser profile.
 */

import { normaliseEmail, type SignedIn } from "../accounts";
import { auth, authConfigured } from "./config";

export async function signedIn(): Promise<SignedIn | null> {
  if (!authConfigured()) return null;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return {
    email: normaliseEmail(email),
    name: session.user?.name ?? null,
    image: session.user?.image ?? null,
  };
}
