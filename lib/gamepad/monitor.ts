/**
 * One reader of the controller for the whole HUD.
 *
 * The Gamepad API has no events for buttons, only a list to poll, so this
 * polls it once a frame and turns the changes into press and release events
 * that any panel can subscribe to. Everything React-side goes through here;
 * the Phaser scenes keep their own frame-locked read for walking, which is
 * fine — the browser's list is just a snapshot, and two readers see the same
 * thing.
 *
 * Chrome only fires `gamepadconnected` on the first input after the page has
 * focus, so a controller plugged in before load would be invisible to
 * anything waiting for the event. Polling sees it straight away.
 */

import { gameEvents } from "@/lib/events";
import {
  detectPadLayout,
  diffButtons,
  effectiveButtons,
  snapshotPad,
  type PadLayout,
  type PadSnapshot,
  type RawPadLike,
} from "./buttons";

export interface PadButtonEvent {
  button: number;
  phase: "down" | "up";
  layout: PadLayout;
}

type Listener = (event: PadButtonEvent) => void;

function readBrowserPads(): PadSnapshot | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  return snapshotPad(navigator.getGamepads() as unknown as (RawPadLike | null)[]);
}

export class PadMonitor {
  private listeners = new Set<Listener>();
  private stateListeners = new Set<() => void>();
  private frame = 0;
  private pad: PadSnapshot | null = null;
  private held: boolean[] = [];
  private read: () => PadSnapshot | null;
  layout: PadLayout = "xbox";

  constructor(read: () => PadSnapshot | null = readBrowserPads) {
    this.read = read;
  }

  /** Hear every press and release while subscribed. Polling runs while anyone listens. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      this.stopIfIdle();
    };
  }

  /** Told when a controller appears or goes away, for the HUD's pill. */
  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    this.start();
    return () => {
      this.stateListeners.delete(listener);
      this.stopIfIdle();
    };
  }

  connected(): boolean {
    return this.pad !== null;
  }

  id(): string | null {
    return this.pad?.id ?? null;
  }

  /** Is the button down right now — the stick counts as the d-pad. */
  isHeld(button: number): boolean {
    return this.held[button] ?? false;
  }

  /** One frame: read the pad, notice what changed, tell everyone. */
  poll() {
    const pad = this.read();
    const wasId = this.pad?.id ?? null;
    const nowId = pad?.id ?? null;
    this.pad = pad;

    if (wasId !== nowId) {
      this.layout = detectPadLayout(pad?.id);
      gameEvents.emit("gamepad-state", nowId, this.layout);
      for (const listener of this.stateListeners) listener();
    }

    const next = pad ? effectiveButtons(pad) : [];
    const { down, up } = diffButtons(this.held, next);
    this.held = next;

    // Releases first: a pad that vanished mid-press lets go of everything
    // before anything new is heard.
    for (const button of up) this.emit({ button, phase: "up", layout: this.layout });
    for (const button of down) this.emit({ button, phase: "down", layout: this.layout });
  }

  private emit(event: PadButtonEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private start() {
    if (this.frame || typeof window === "undefined") return;
    const tick = () => {
      this.frame = window.requestAnimationFrame(tick);
      this.poll();
    };
    this.frame = window.requestAnimationFrame(tick);
  }

  private stopIfIdle() {
    if (this.listeners.size > 0 || this.stateListeners.size > 0) return;
    if (this.frame && typeof window !== "undefined") window.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export const padMonitor = new PadMonitor();
