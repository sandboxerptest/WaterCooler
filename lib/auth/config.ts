/**
 * Sign-in, through Auth.js. Server only.
 *
 * Each provider is switched on by its pair of keys in the environment —
 * AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, AUTH_MICROSOFT_ENTRA_ID_ID and
 * AUTH_MICROSOFT_ENTRA_ID_SECRET — plus AUTH_SECRET to sign the session
 * with. Auth.js reads those names itself; this file only decides which
 * providers to offer. With none of them set, sign-in is simply off and a
 * profile lives in the browser as it always did.
 *
 * The session is a signed cookie carrying the email; every fact about the
 * person is looked up from the accounts table by that email, so there is
 * no session store to keep.
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { SignInProvider } from "../accounts";

const has = (name: string) => !!process.env[name]?.trim();

const PROVIDERS = [
  {
    id: "google",
    label: "Google",
    ready: () => has("AUTH_GOOGLE_ID") && has("AUTH_GOOGLE_SECRET"),
    make: () => Google({ allowDangerousEmailAccountLinking: true }),
  },
  {
    id: "microsoft-entra-id",
    label: "Microsoft",
    ready: () => has("AUTH_MICROSOFT_ENTRA_ID_ID") && has("AUTH_MICROSOFT_ENTRA_ID_SECRET"),
    make: () => MicrosoftEntraID({ allowDangerousEmailAccountLinking: true }),
  },
] as const;

/** The providers with keys in the environment, in the order they are offered. */
export function configuredProviders(): SignInProvider[] {
  return PROVIDERS.filter((p) => p.ready()).map(({ id, label }) => ({ id, label }));
}

/** Whether anyone can sign in: a secret to sign sessions with, and at least one provider. */
export function authConfigured(): boolean {
  return has("AUTH_SECRET") && configuredProviders().length > 0;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The app runs behind its own server on whatever port it is given; the
  // Host header is the address, there is no other.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: PROVIDERS.filter((p) => p.ready()).map((p) => p.make()),
  callbacks: {
    // Only someone with an email address can be an account.
    signIn: ({ user }) => !!user.email,
  },
});
