/**
 * Which character this person plays as, remembered in the browser.
 *
 * Kept in localStorage rather than on the server on purpose: the choice is
 * about this person at this keyboard, not about the room, and it should not
 * need an account to stick. Every read is guarded — storage can be absent or
 * throw in private windows and previews, and the game must still start.
 */

const KEY = "watercooler:character";

/** Fired on this window whenever the choice changes, so readers here update. */
const CHANGE_EVENT = "watercooler:character-changed";

export interface CharacterChoice {
  key: string;
  path: string;
}

export function rememberedCharacter(): CharacterChoice | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CharacterChoice>;
    return typeof parsed.key === "string" && typeof parsed.path === "string"
      ? { key: parsed.key, path: parsed.path }
      : null;
  } catch {
    return null;
  }
}

export function rememberCharacter(choice: CharacterChoice | null) {
  try {
    if (choice) window.localStorage.setItem(KEY, JSON.stringify(choice));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: the choice simply will not survive a reload.
  }
  // The "storage" event only fires in *other* tabs; tell this one ourselves.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Subscribe to changes, for useSyncExternalStore.
 *
 * Both this tab's own changes and another tab's are covered, so two windows
 * on the same room agree about who you are.
 */
export function subscribeToChoice(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The remembered texture key, or null. Stable across renders when unchanged. */
export function rememberedKey(): string | null {
  return rememberedCharacter()?.key ?? null;
}
