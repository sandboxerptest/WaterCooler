/**
 * How loud another person is, by how far away they stand.
 *
 * Shared by the voice chat and its tests; nothing here touches the browser.
 * Within a few tiles you hear them in full; past earshot, not at all; in
 * between, a straight fade.
 */

import { TILE } from "../map/office";

/** Full volume this close, in pixels. */
export const NEAR_PX = 3 * TILE;
/** Silent from here on. */
export const FAR_PX = 9 * TILE;

export function volumeAt(distance: number): number {
  if (!Number.isFinite(distance) || distance <= NEAR_PX) return 1;
  if (distance >= FAR_PX) return 0;
  return 1 - (distance - NEAR_PX) / (FAR_PX - NEAR_PX);
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Of two people who both have a microphone on, which one opens the
 * connection. Both must agree without talking, so the lower id offers.
 */
export function offers(myId: string, peerId: string): boolean {
  return myId < peerId;
}
