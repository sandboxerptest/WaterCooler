/**
 * Desks on a floor.
 *
 * A floor has a fixed set of desk slots, filled in order by whoever has a
 * desk there — the building's people on Floor 1, its agents on Floor 2.
 * Slots are shared by the scene (which draws the desks) and the server
 * (which sits an agent at theirs), so both agree on where everyone is.
 */

import { TILE } from "../map/office";
import { HEIGHT, WIDTH } from "../map/floor";

export interface Slot {
  tx: number;
  ty: number;
}

/** Two rows of four, left to right, top row first. */
export const DESK_SLOTS: readonly Slot[] = (() => {
  const slots: Slot[] = [];
  for (const ty of [4, 8]) for (let i = 0; i < 4; i++) slots.push({ tx: 2 + i * 4, ty });
  return slots;
})();

export const MAX_DESKS = DESK_SLOTS.length;

/** The desk's own footprint: two tiles wide, and the top of its two rows. */
export function deskBox(slot: number) {
  const s = DESK_SLOTS[slot];
  return { x: s.tx * TILE, y: s.ty * TILE + 8, width: 2 * TILE, height: TILE + 20 };
}

/** Where the desk's picture is drawn from: top-left, two tiles square. */
export function deskOrigin(slot: number) {
  const s = DESK_SLOTS[slot];
  return { x: s.tx * TILE, y: s.ty * TILE };
}

/**
 * Where someone stands at a desk: centred, on the row below it, facing it.
 * Given as the sprite's centre, the way presence positions are.
 */
export function standingSpot(slot: number) {
  const s = DESK_SLOTS[slot];
  return { x: (s.tx + 1) * TILE, y: (s.ty + 2) * TILE + 12 - 43 };
}

/** Whether every slot is inside the floor's walls. */
export function slotsFit(): boolean {
  return DESK_SLOTS.every((s) => s.tx + 2 < WIDTH - 1 && s.ty + 2 < HEIGHT - 1);
}
