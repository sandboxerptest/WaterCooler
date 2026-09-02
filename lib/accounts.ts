/**
 * An account is a person known by their email address, signed in through
 * Google or Microsoft. Shared by the browser and the server, so nothing here
 * touches the database or the session.
 *
 * A profile — name, home building, character — used to live only in the
 * browser. For an account it lives on the server, keyed by email, so it
 * follows the person to any device, along with whatever is counted about
 * them: visits, and any stat a feature cares to keep.
 */

import type { CharacterChoice } from "./characters/choice";
import { isHome } from "./world/floors";

export const NAME_LIMIT = 16;

/** The sign-in choices the welcome screen can offer. */
export interface SignInProvider {
  /** Auth.js's id for the provider, e.g. "google". */
  id: string;
  /** What the button says. */
  label: string;
}

/** What a signed-in person has chosen, once they have chosen it. */
export interface AccountProfile {
  name: string;
  home: string;
  character: CharacterChoice;
}

export interface Account {
  email: string;
  /** The name the sign-in provider gave, before any choice here. */
  displayName: string | null;
  /** The provider's picture of them, if any. */
  image: string | null;
  /** The id their desk and presence go under: derived from the email, never changing. */
  personId: string;
  profile: AccountProfile | null;
  visits: number;
  stats: Record<string, number>;
}

/** What GET /api/me answers with. */
export interface Me {
  auth: {
    /** Whether sign-in is set up at all. Without it, a profile lives in the browser as before. */
    enabled: boolean;
    providers: SignInProvider[];
  };
  account: Account | null;
}

/** What the session says about a signed-in person: enough to make an account of. */
export interface SignedIn {
  email: string;
  name: string | null;
  image: string | null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const KEY = /^[\w-]{1,64}$/;
const PATH = /^\/[\w\-./]{1,200}$/;

/**
 * A profile as the browser sends it, checked. Null when anything is off:
 * the server keeps nothing it would not hand back.
 */
export function parseProfileUpdate(body: unknown): AccountProfile | null {
  if (!body || typeof body !== "object") return null;
  const { name, home, character } = body as Record<string, unknown>;
  if (typeof name !== "string" || typeof home !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
  if (!trimmed || trimmed === "Guest") return null;
  if (!isHome(home)) return null;
  if (!character || typeof character !== "object") return null;
  const { key, path } = character as Record<string, unknown>;
  if (typeof key !== "string" || typeof path !== "string") return null;
  if (!KEY.test(key) || !PATH.test(path) || path.includes("..")) return null;
  return { name: trimmed, home, character: { key, path } };
}
