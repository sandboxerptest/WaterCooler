/**
 * Camera fitting.
 *
 * The game is a menu as much as a place: the door, the lift and the games
 * should all be on screen at once, so a click reaches any of them. The zoom
 * is therefore the one that fits the whole lobby inside the viewport, with
 * background around it where the shape does not match — and it is fitted to
 * the lobby's size whatever room is on screen, so a smaller room is drawn
 * at the same scale (a fractional zoom-in makes the pixels uneven and the
 * sprites look blurred) and simply sits centred with more room around it.
 */

import { HEIGHT, TILE, WIDTH } from "./map/office";

/** The room every zoom is fitted to: the lobby. */
export const ROOM_FRAME = { width: WIDTH * TILE, height: HEIGHT * TILE };

/** The largest zoom at which a room of this size fits inside the viewport. */
export function fitZoom(viewW: number, viewH: number, mapW: number, mapH: number): number {
  if (mapW <= 0 || mapH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  return Math.min(viewW / mapW, viewH / mapH);
}

/** The zoom that fits the lobby in this viewport — used for every room, within limits. */
export function frameZoom(viewW: number, viewH: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, fitZoom(viewW, viewH, ROOM_FRAME.width, ROOM_FRAME.height)));
}

/**
 * How far out a map can be zoomed: until it just fills the viewport, so the
 * camera never looks past its edge, and never below the game's least zoom.
 * A room stops at the lobby's fit; a map is bigger than a screen, and
 * seeing more of it is the point of zooming out.
 */
export function coverZoom(
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  min: number,
  max: number,
): number {
  const fill = mapW > 0 && mapH > 0 ? Math.max(viewW / mapW, viewH / mapH) : 0;
  return Math.min(max, Math.max(min, fill));
}
