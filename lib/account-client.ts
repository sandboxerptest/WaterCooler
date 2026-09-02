/**
 * The account, from the browser's side.
 *
 * One question per page load — who am I to the server? — shared by every
 * part of the HUD that asks. When the answer is an account, its profile is
 * mirrored into this browser, so the scenes, presence and the register
 * read it exactly as they read a guest's.
 */

import { useEffect, useState } from "react";
import type { Account, AccountProfile, Me } from "./accounts";
import { adoptPersonId, chooseGuest, isComplete, saveProfile, type Profile } from "./profile";

const NOBODY: Me = { auth: { enabled: false, providers: [] }, account: null };

let cached: Promise<Me> | null = null;

export function fetchMe(fresh = false): Promise<Me> {
  if (!cached || fresh) {
    cached = fetch("/api/me")
      .then(async (res) => (res.ok ? ((await res.json()) as Me) : NOBODY))
      .catch(() => NOBODY);
  }
  return cached;
}

/** The answer, once it has arrived; undefined until then. */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchMe().then((answer) => {
      if (live) setMe(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return me;
}

/** Take the account's identity, and its profile if it has one, into this browser. */
export function adoptAccount(account: Account) {
  // Signed in now, whatever was chosen before.
  chooseGuest(false);
  adoptPersonId(account.personId);
  if (account.profile) saveProfile(account.profile);
}

/** Keep the account's profile: null when refused, or when nobody is signed in. */
export async function saveAccountProfile(profile: AccountProfile): Promise<Account | null> {
  try {
    const res = await fetch("/api/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { account?: Account };
    return body.account ?? null;
  } catch {
    return null;
  }
}

/**
 * A change made in the browser — a new character in the studio, say —
 * follows the person to their account. Nothing happens for a guest.
 */
export async function pushProfileToAccount(profile: Profile): Promise<void> {
  if (!isComplete(profile) || !profile.home || !profile.character) return;
  const me = await fetchMe();
  if (!me.account) return;
  await saveAccountProfile({
    name: profile.name,
    home: profile.home,
    character: profile.character,
  });
}
