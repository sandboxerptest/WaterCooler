/**
 * Who this person is: a name, a home building, and a character.
 *
 * All three are needed before they can walk in, and all three live in this
 * browser rather than on a server — the same footing as the room link,
 * which is the only credential there is. The id is minted once and kept,
 * so a person's office keeps its address across visits.
 */

import { loadPlayerName, lsGet, lsSet, savePlayerName } from "./persistence";
import { rememberCharacter, rememberedCharacter, type CharacterChoice } from "./characters/choice";
import { isHome, type Person } from "./world/floors";

const LS_ID = "watercooler:person-id";
const LS_HOME = "watercooler:home";
const CHANGE_EVENT = "watercooler:profile-changed";
const NO_NAME = "Guest";

export interface Profile extends Person {
  character: CharacterChoice | null;
}

function mintId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

/** This browser's id, minted on first use. */
export function personId(): string {
  const existing = lsGet<string | null>(LS_ID, null);
  if (existing) return existing;
  const id = mintId();
  lsSet(LS_ID, id);
  return id;
}

export function readProfile(): Profile {
  const home = lsGet<string | null>(LS_HOME, null);
  return {
    id: personId(),
    name: loadPlayerName(),
    home: isHome(home) ? home : null,
    character: rememberedCharacter(),
  };
}

/** Whether there is enough here to walk in. */
export function isComplete(profile: Profile): boolean {
  return (
    profile.name !== NO_NAME && profile.name.trim() !== "" && !!profile.home && !!profile.character
  );
}

export function saveProfile(next: { name: string; home: string; character: CharacterChoice }) {
  savePlayerName(next.name.trim().slice(0, 16));
  lsSet(LS_HOME, next.home);
  rememberCharacter(next.character);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore needs the same object back while nothing changed.
let snapshot: { key: string; profile: Profile } | null = null;

export function profileSnapshot(): Profile {
  const profile = readProfile();
  const key = JSON.stringify(profile);
  if (!snapshot || snapshot.key !== key) snapshot = { key, profile };
  return snapshot.profile;
}

export function subscribeToProfile(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("watercooler:character-changed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("watercooler:character-changed", onChange);
    window.removeEventListener("storage", onChange);
  };
}
