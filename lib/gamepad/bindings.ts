/**
 * The one binding a person can change: which button is hold-to-talk.
 *
 * Every pad puts A, B, X, Y and the d-pad where the standard mapping says,
 * but the shoulders and triggers wander: some 8BitDo and Switch-style pads
 * report a bumper at the trigger's index. Rather than guess, the Controller
 * check lets the person press the button they want, and it is remembered in
 * the browser. Everything that documents or reads the talk button asks here.
 */

import { MACHINE_BUTTONS, XBOX, type MachineAction } from "./buttons";

const STORAGE_KEY = "watercooler:pad-talk";

export const DEFAULT_TALK_BUTTON: number = XBOX.LT;

/** The slice of localStorage this uses, so it can be tested with a stand-in. */
export interface TalkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStore(): TalkStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A stored value is a small whole number; anything else is ignored. */
export function parseTalkButton(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value < 32 ? value : null;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The button that talks, right now. */
export function talkButton(store: TalkStore | null = browserStore()): number {
  return parseTalkButton(store?.getItem(STORAGE_KEY)) ?? DEFAULT_TALK_BUTTON;
}

export function setTalkButton(button: number, store: TalkStore | null = browserStore()) {
  if (parseTalkButton(String(button)) === null) return;
  try {
    store?.setItem(STORAGE_KEY, String(button));
  } catch {
    // Storage can be off; the choice then lasts as long as the page.
  }
  notify();
}

export function resetTalkButton(store: TalkStore | null = browserStore()) {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
  notify();
}

/** Told when the talk button changes, for anything that prints it. */
export function subscribeTalkButton(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What a machine action is bound to, with the talk button as chosen. */
export function machineButton(action: MachineAction): number {
  return action === "talk" ? talkButton() : MACHINE_BUTTONS[action];
}
