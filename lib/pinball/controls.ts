/**
 * Turning what the player is doing into what the table sees.
 *
 * Keyboard, gamepad and touch all end up as the same three booleans, and the
 * merging is worth keeping out of the component: it is the part with rules in
 * it, and rules are easier to check here than through a canvas.
 */

import type { GameStatus, PinballInput } from "./game";

export type FlipperSide = "left" | "right";

/**
 * Which flipper a touch belongs to: whichever half of the playfield it landed
 * on. No buttons to find and no hand-eye work — the side of the screen you
 * touch is the side that flips, which is how a real table works too.
 */
export function touchSide(clientX: number, rectLeft: number, rectWidth: number): FlipperSide {
  return clientX - rectLeft < rectWidth / 2 ? "left" : "right";
}

export interface ControlSources {
  keys: { left: boolean; right: boolean; launch: boolean };
  pad: { left: boolean; right: boolean; launch: boolean };
  /** How many fingers are down, and on which sides. */
  touch: { left: boolean; right: boolean; count: number };
  status: GameStatus;
}

/**
 * A touch means "flip this side" once the ball is in play, and "pull the
 * plunger" while it is still in the lane — one gesture, because a phone has
 * no spare button and the two are never wanted at the same moment.
 */
export function combineInput({ keys, pad, touch, status }: ControlSources): PinballInput {
  return {
    left: keys.left || pad.left || touch.left,
    right: keys.right || pad.right || touch.right,
    launch: keys.launch || pad.launch || (status === "ready" && touch.count > 0),
  };
}
