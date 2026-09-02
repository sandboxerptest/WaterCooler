/**
 * Walking a dialog's controls with a controller.
 *
 * A pad has no Tab key and no pointer, so without this a dialog is a dead
 * end: the terminal opens, the text box takes focus, and Assign, the mic and
 * the close button cannot be reached at all.
 *
 * Focus is moved with `.focus()` rather than by synthesising a Tab press,
 * because a synthetic key event does not move focus: only trusted events
 * carry the browser's default behaviour. Same reason buttons are activated
 * with `.click()`.
 */

/** What counts as a stop on the way round the dialog. */
const FOCUSABLE = [
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Marks a control that wants the button held, not clicked — push-to-talk. */
export const PAD_HOLD_ATTR = "data-pad-hold";

/** The ring is drawn by us: `:focus-visible` does not fire for `.focus()`. */
export const RING_CLASS = "pad-focus";

/**
 * Where the ring goes next. Wraps at both ends, and starts at whichever end
 * the first press comes from when nothing in the dialog is focused yet.
 */
export function nextFocusIndex(current: number, delta: -1 | 1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Visible, reachable controls in DOM order — the order the ring travels. */
export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

export function clearRing(container: HTMLElement) {
  container
    .querySelectorAll(`.${RING_CLASS}`)
    .forEach((element) => element.classList.remove(RING_CLASS));
}

/** Step the ring forward or back through the container's controls. */
export function moveFocus(container: HTMLElement, delta: -1 | 1) {
  const stops = focusableIn(container);
  if (stops.length === 0) return;

  const active = document.activeElement as HTMLElement | null;
  const from = active && container.contains(active) ? stops.indexOf(active) : -1;
  const next = stops[nextFocusIndex(from, delta, stops.length)];

  clearRing(container);
  next.classList.add(RING_CLASS);
  next.focus();
}

/**
 * Press, or let go of, whatever the ring is on. Push-to-talk needs the
 * whole press, so it gets the key events it already listens for; everything
 * else is a plain tap. A text box has nothing to activate: dictation is how
 * a pad fills it in.
 */
export function confirmFocused(container: HTMLElement, phase: "down" | "up") {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !container.contains(active)) return;

  if (active.hasAttribute(PAD_HOLD_ATTR)) {
    active.dispatchEvent(
      new KeyboardEvent(phase === "down" ? "keydown" : "keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }

  if (
    phase === "down" &&
    !(active instanceof HTMLTextAreaElement) &&
    !(active instanceof HTMLInputElement)
  ) {
    active.click();
  }
}
