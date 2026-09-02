/**
 * Who this person is: a name, a home building, and a character.
 *
 * All three are needed before they can walk in. For a guest they live in
 * this browser, the same footing as the room link; for someone signed in
 * they live on the server under their email and are mirrored here, so the
 * game reads them the same way either way. The id is minted once and kept
 * for a guest, and is the account's for someone signed in, so a person's
 * desk keeps its address across visits.
 */

import { loadPlayerName, lsGet, lsSet, savePlayerName } from "./persistence";
import { rememberCharacter, rememberedCharacter, type CharacterChoice } from "./characters/choice";
import { isHome, type Person } from "./world/floors";

const LS_ID = "watercooler:person-id";
const LS_HOME = "watercooler:home";
/** Set when someone chose to go on as a guest rather than sign in. */
const LS_GUEST = "watercooler:guest";
const CHANGE_EVENT = "watercooler:profile-changed";
const NO_NAME = "Guest";

export interface Profile extends Person {
  character: CharacterChoice | null;
  /** Chose to go on without signing in: nothing about them is kept on the server. */
  guest: boolean;
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
    guest: lsGet<boolean>(LS_GUEST, false) === true,
  };
}

/** Go on as a guest: the profile stays in this browser and no account is kept. */
export function chooseGuest(guest: boolean) {
  lsSet(LS_GUEST, guest);
  window.dispatchEvent(new Event(CHANGE_EVENT));
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

/**
 * Take on an account's id, so the desk and presence go under the account
 * rather than this browser's minted id. Idempotent.
 */
export function adoptPersonId(id: string) {
  if (lsGet<string | null>(LS_ID, null) === id) return;
  lsSet(LS_ID, id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Forget everything about who was here: for signing out, so the next person starts afresh. */
export function clearProfile() {
  lsSet(LS_ID, null);
  lsSet(LS_HOME, null);
  lsSet(LS_GUEST, false);
  savePlayerName(NO_NAME);
  rememberCharacter(null);
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
