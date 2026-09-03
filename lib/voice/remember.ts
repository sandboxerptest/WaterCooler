/**
 * Whether voice was on, remembered for this tab.
 *
 * Walking into a building loads a new page, and a microphone that was on
 * should come back on rather than fall silent at the door. Session
 * storage is per tab, so a second tab does not open a second microphone,
 * and it is forgotten when the tab closes.
 */

const KEY = "watercooler:voice";

export interface VoiceMemory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function tabStore(): VoiceMemory | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberVoice(on: boolean, store: VoiceMemory | null = tabStore()) {
  try {
    if (on) store?.setItem(KEY, "on");
    else store?.removeItem(KEY);
  } catch {
    // Storage can be off; then the microphone just does not come back by itself.
  }
}

export function voiceWasOn(store: VoiceMemory | null = tabStore()): boolean {
  try {
    return store?.getItem(KEY) === "on";
  } catch {
    return false;
  }
}
