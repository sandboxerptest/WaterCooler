/**
 * Gamepad support.
 *
 * The mapping maths lives in exported pure functions so it can be unit-tested:
 * the browser Gamepad API only reports real hardware, so there is no way to
 * drive a synthetic pad through Phaser in a test.
 *
 * Buttons follow the W3C "standard gamepad" mapping, which macOS reports for
 * Xbox, DualSense/DualShock and Switch Pro controllers alike:
 *   0 A/✕/B   1 B/○/A   2 X/□/Y   3 Y/△/X
 *   4 LB      5 RB      8 Back    9 Start
 *   12 D-up   13 D-down 14 D-left 15 D-right
 */

import * as Phaser from "phaser";

/** Ignore stick noise below this magnitude. */
export const STICK_DEADZONE = 0.25;

export const PAD_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  BACK: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export type PadAction =
  | "interact"
  | "cancel"
  | "menuUp"
  | "menuDown"
  | "panelPrev"
  | "panelNext"
  | "panelClose";

/** Which physical buttons fire each action. */
const ACTION_BUTTONS: Record<PadAction, number[]> = {
  interact: [PAD_BUTTON.A],
  cancel: [PAD_BUTTON.B],
  menuUp: [PAD_BUTTON.DPAD_UP],
  menuDown: [PAD_BUTTON.DPAD_DOWN],
  panelPrev: [PAD_BUTTON.LB],
  panelNext: [PAD_BUTTON.RB],
  panelClose: [PAD_BUTTON.BACK],
};

export type PadLayout = "xbox" | "playstation" | "nintendo";

/**
 * Guess the button labelling from the pad's id string. Only affects on-screen
 * prompts — the button indices are the same standard mapping either way.
 */
export function detectPadLayout(id: string | undefined): PadLayout {
  const lower = (id ?? "").toLowerCase();
  if (/dualsense|dualshock|playstation|sony|054c/.test(lower)) return "playstation";
  if (/switch|joy-?con|nintendo|057e/.test(lower)) return "nintendo";
  return "xbox";
}

/** Label for the confirm button, for prompts like "Press A". */
export function confirmLabel(layout: PadLayout): string {
  if (layout === "playstation") return "✕";
  if (layout === "nintendo") return "A";
  return "A";
}

export interface StickInput {
  axisX: number;
  axisY: number;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/**
 * Turn stick axes and d-pad presses into a velocity, matching the keyboard's
 * behaviour: full speed in any direction, normalised on the diagonal. The
 * d-pad wins over the stick when both are pushed.
 */
export function padVelocity(input: StickInput, speed: number, deadzone = STICK_DEADZONE) {
  let vx = 0;
  let vy = 0;

  if (input.left) vx = -speed;
  else if (input.right) vx = speed;
  else if (Math.abs(input.axisX) > deadzone) vx = Math.sign(input.axisX) * speed;

  if (input.up) vy = -speed;
  else if (input.down) vy = speed;
  else if (Math.abs(input.axisY) > deadzone) vy = Math.sign(input.axisY) * speed;

  if (vx !== 0 && vy !== 0) {
    vx *= Math.SQRT1_2;
    vy *= Math.SQRT1_2;
  }

  return { vx, vy };
}

/**
 * Tracks button state across frames so callers can ask "was this just
 * pressed?" the way Phaser's JustDown works for keys.
 */
export class EdgeTracker {
  private previous = new Set<number>();
  private current = new Set<number>();

  /** Replace the held-button set for this frame. */
  sample(pressed: Iterable<number>) {
    this.previous = this.current;
    this.current = new Set(pressed);
  }

  justPressed(button: number): boolean {
    return this.current.has(button) && !this.previous.has(button);
  }

  isDown(button: number): boolean {
    return this.current.has(button);
  }

  reset() {
    this.previous = new Set();
    this.current = new Set();
  }
}

/** Buttons an action maps to — exported for tests and prompt rendering. */
export function buttonsForAction(action: PadAction): number[] {
  return ACTION_BUTTONS[action];
}

/**
 * Frame-by-frame view of the first connected pad. Safe to construct and call
 * when no gamepad is attached or the plugin is disabled — everything reports
 * "nothing pressed".
 */
/** The slice of the browser Gamepad API this needs. */
export interface RawPad {
  id: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

/**
 * Pick a pad from what the browser reports.
 *
 * Chrome only fires `gamepadconnected` on the first input *after* a page has
 * focus, so a controller plugged in before load is invisible to anything that
 * waits for the event — which is why this polls the list directly instead.
 */
export function selectPad(pads: readonly (RawPad | null)[]): RawPad | null {
  for (const pad of pads) {
    if (pad?.connected && pad.buttons.length > 0) return pad;
  }
  return null;
}

export class GamepadInput {
  private scene: Phaser.Scene;
  private edges = new EdgeTracker();
  private pad: RawPad | null = null;
  private prevStickDir: -1 | 0 | 1 = 0;
  private stickEdge: -1 | 0 | 1 = 0;
  layout: PadLayout = "xbox";

  /** Told when a pad appears or disappears, so the HUD can show it. */
  onConnected: ((id: string | null, layout: PadLayout) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Read the pad from the browser, falling back to Phaser's plugin.
   *
   * Phaser only counts pads it saw connect, so relying on it alone means a
   * controller that was already plugged in never registers.
   */
  private readPad(): RawPad | null {
    if (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function") {
      const direct = selectPad(navigator.getGamepads() as unknown as (RawPad | null)[]);
      if (direct) return direct;
    }

    const plugin = this.scene.input.gamepad;
    const fallback = plugin?.total ? plugin.getPad(0) : null;
    if (!fallback) return null;

    return {
      id: fallback.id,
      connected: true,
      axes: fallback.axes.map((axis) => axis.getValue()),
      buttons: fallback.buttons.map((button) => ({ pressed: button.pressed })),
    };
  }

  get connected(): boolean {
    return this.pad !== null;
  }

  /** Call once per frame, before reading movement or actions. */
  poll() {
    const pad = this.readPad();

    if (pad?.id !== this.pad?.id) {
      this.edges.reset();
      this.pad = pad;
      if (pad) {
        this.layout = detectPadLayout(pad.id);
        this.onConnected?.(pad.id, this.layout);
      } else {
        this.onConnected?.(null, this.layout);
      }
    } else {
      this.pad = pad;
    }

    if (!pad) {
      this.edges.sample([]);
      this.prevStickDir = 0;
      this.stickEdge = 0;
      return;
    }

    // Menu navigation by stick needs an edge, or one flick scrolls the list
    const dir = this.stickDirection(pad);
    this.stickEdge = dir !== 0 && dir !== this.prevStickDir ? dir : 0;
    this.prevStickDir = dir;

    const pressed: number[] = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed) pressed.push(i);
    }
    this.edges.sample(pressed);
  }

  /** Velocity contribution from the pad; zeroes when nothing is connected. */
  velocity(speed: number) {
    const pad = this.pad;
    if (!pad) return { vx: 0, vy: 0 };

    return padVelocity(
      {
        axisX: pad.axes[0] ?? 0,
        axisY: pad.axes[1] ?? 0,
        left: this.edges.isDown(PAD_BUTTON.DPAD_LEFT),
        right: this.edges.isDown(PAD_BUTTON.DPAD_RIGHT),
        up: this.edges.isDown(PAD_BUTTON.DPAD_UP),
        down: this.edges.isDown(PAD_BUTTON.DPAD_DOWN),
      },
      speed,
    );
  }

  justPressed(action: PadAction): boolean {
    return buttonsForAction(action).some((b) => this.edges.justPressed(b));
  }

  private stickDirection(pad: RawPad): -1 | 0 | 1 {
    const y = pad.axes[1] ?? 0;
    if (y < -0.6) return -1;
    if (y > 0.6) return 1;
    return 0;
  }

  /**
   * Menu navigation by stick: non-zero only on the frame the stick crosses
   * into a direction, so holding it does not run down the list.
   */
  menuDirectionEdge(): -1 | 0 | 1 {
    return this.stickEdge;
  }
}
