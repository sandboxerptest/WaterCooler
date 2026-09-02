/**
 * The controller, by its Xbox names.
 *
 * Browsers report every common pad through the W3C "standard gamepad"
 * mapping, and that mapping is the Xbox layout: A at the bottom of the
 * diamond, B to its right, X to its left, Y on top, bumpers and triggers
 * above, View and Menu in the middle, the d-pad at 12 to 15. A DualSense or
 * a Switch Pro pad lands on the same indices, so the numbers below drive
 * them too; only the printed labels differ, and the prompts on screen use
 * the Xbox ones throughout.
 *
 * Everything here is pure, so the bindings can be tested and listed on
 * screen without a controller plugged in.
 */

export const XBOX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

const LABELS: Record<number, string> = {
  [XBOX.A]: "A",
  [XBOX.B]: "B",
  [XBOX.X]: "X",
  [XBOX.Y]: "Y",
  [XBOX.LB]: "LB",
  [XBOX.RB]: "RB",
  [XBOX.LT]: "LT",
  [XBOX.RT]: "RT",
  [XBOX.VIEW]: "View",
  [XBOX.MENU]: "Menu",
  [XBOX.LS]: "LS",
  [XBOX.RS]: "RS",
  [XBOX.UP]: "↑",
  [XBOX.DOWN]: "↓",
  [XBOX.LEFT]: "←",
  [XBOX.RIGHT]: "→",
};

/** What is printed on the button, Xbox style. */
export function buttonLabel(button: number): string {
  return LABELS[button] ?? `#${button}`;
}

export type PadLayout = "xbox" | "playstation" | "nintendo";

/**
 * Guess the make from the pad's id string. The indices are the same
 * whatever it is; this only says which family the HUD's pill names.
 */
export function detectPadLayout(id: string | undefined): PadLayout {
  const lower = (id ?? "").toLowerCase();
  if (/dualsense|dualshock|playstation|sony|054c/.test(lower)) return "playstation";
  if (/switch|joy-?con|nintendo|057e/.test(lower)) return "nintendo";
  return "xbox";
}

/** The slice of the browser's Gamepad object this reads. */
export interface RawPadLike {
  id: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

/** One frame of one controller, copied out of the browser's live object. */
export interface PadSnapshot {
  id: string;
  buttons: boolean[];
  axes: number[];
}

/**
 * The first usable pad in the browser's list. The list is padded with nulls
 * for empty slots, and a pad that has gone away can linger as disconnected.
 */
export function snapshotPad(pads: readonly (RawPadLike | null | undefined)[]): PadSnapshot | null {
  for (const pad of pads) {
    if (!pad?.connected || pad.buttons.length === 0) continue;
    return {
      id: pad.id,
      buttons: pad.buttons.map((button) => button.pressed),
      axes: [...pad.axes],
    };
  }
  return null;
}

/** How far the left stick must go to count as a d-pad press. */
export const STICK_AS_DPAD = 0.6;

/** The left stick read as four buttons, so menus answer to it as well. */
export function stickAsDpad(axes: readonly number[], threshold = STICK_AS_DPAD) {
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;
  return {
    up: y < -threshold,
    down: y > threshold,
    left: x < -threshold,
    right: x > threshold,
  };
}

/** Which buttons are down this frame, with the stick folded into the d-pad slots. */
export function effectiveButtons(pad: PadSnapshot): boolean[] {
  const held = [...pad.buttons];
  while (held.length <= XBOX.RIGHT) held.push(false);
  const stick = stickAsDpad(pad.axes);
  held[XBOX.UP] = held[XBOX.UP] || stick.up;
  held[XBOX.DOWN] = held[XBOX.DOWN] || stick.down;
  held[XBOX.LEFT] = held[XBOX.LEFT] || stick.left;
  held[XBOX.RIGHT] = held[XBOX.RIGHT] || stick.right;
  return held;
}

/** What changed between two frames: buttons that went down, and ones let go. */
export function diffButtons(previous: readonly boolean[], next: readonly boolean[]) {
  const down: number[] = [];
  const up: number[] = [];
  const count = Math.max(previous.length, next.length);
  for (let button = 0; button < count; button++) {
    const was = previous[button] ?? false;
    const is = next[button] ?? false;
    if (is && !was) down.push(button);
    else if (was && !is) up.push(button);
  }
  return { down, up };
}

/**
 * What the controller does on a game machine — the arcade cabinet, the
 * pinball table, the ping pong table. One button each, the same on all of
 * them, and printed on the machine so nobody has to guess.
 */
export type MachineAction = "act" | "back" | "fullscreen" | "mute" | "close" | "restart" | "talk";

export const MACHINE_BUTTONS: Record<MachineAction, number> = {
  act: XBOX.A,
  back: XBOX.B,
  fullscreen: XBOX.X,
  mute: XBOX.Y,
  close: XBOX.VIEW,
  restart: XBOX.MENU,
  talk: XBOX.LT,
};

export function machineAction(button: number): MachineAction | null {
  for (const action of Object.keys(MACHINE_BUTTONS) as MachineAction[]) {
    if (MACHINE_BUTTONS[action] === button) return action;
  }
  return null;
}

/**
 * The controller outside the machines: walking about, the dialogs and the
 * HUD's panels. A confirms, B backs out of whatever is open, the bumpers
 * turn through the panels, View closes, and the left trigger is the voice.
 */
export const HUD_BUTTONS = {
  confirm: XBOX.A,
  back: XBOX.B,
  prevPanel: XBOX.LB,
  nextPanel: XBOX.RB,
  closePanel: XBOX.VIEW,
  talk: XBOX.LT,
} as const;
