/**
 * The building's register, from the browser's side.
 *
 * A profile lives in this browser; the register is what lets everyone else
 * see a desk with your name on your building's floor. Registering is
 * idempotent, so it is done on every visit rather than once.
 */

import type { Occupant } from "./world/floors";
import type { Profile } from "./profile";
import { isComplete } from "./profile";

export async function registerProfile(profile: Profile): Promise<void> {
  if (!isComplete(profile)) return;
  try {
    await fetch("/api/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: profile.id, name: profile.name, home: profile.home }),
    });
  } catch {
    // The desk will appear next time; nothing else depends on it.
  }
}

export async function fetchPeople(home: string): Promise<Occupant[]> {
  try {
    const res = await fetch(`/api/people?home=${encodeURIComponent(home)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { people?: Occupant[] };
    return body.people ?? [];
  } catch {
    return [];
  }
}
