/**
 * Camera fitting.
 *
 * Zoom used to be a constant that only the scroll wheel changed, so widening
 * the viewport — collapsing the chat column, most obviously — did not enlarge
 * the office. It exposed more background beside it instead, because the camera
 * pins the room to the left and puts any slack on the right.
 */

/**
 * The smallest zoom at which the room still covers the viewport.
 *
 * `max` of the two ratios rather than `min`: fitting the room *inside* the
 * viewport would letterbox it, and the room is the whole picture here. Cover
 * it, and let the longer axis overflow — the camera is already bounded, so
 * the overflow is room to pan rather than something lost.
 */
export function fillZoom(viewW: number, viewH: number, mapW: number, mapH: number): number {
  if (mapW <= 0 || mapH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  return Math.max(viewW / mapW, viewH / mapH);
}

/**
 * The zoom to use after the viewport changes.
 *
 * Raises the zoom when the room no longer covers the viewport, and otherwise
 * leaves it alone: someone who has zoomed in deliberately should keep their
 * view when the column is dragged a few pixels. Capped, so a very large window
 * does not blow the pixel art up past what `max` allows.
 */
export function zoomToCover(
  current: number,
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
  max: number,
): number {
  const floor = Math.min(fillZoom(viewW, viewH, mapW, mapH), max);
  return current < floor ? floor : current;
}
