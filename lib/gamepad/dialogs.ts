/**
 * Which dialog, if any, has the screen.
 *
 * Every panel that takes over — the welcome, the lift, the terminal, the
 * character studio, the game machines — is marked `role="dialog"`, so the
 * controller can find the one on top without each of them registering. The
 * game machines read the pad themselves and say so with an attribute, and
 * the shared driver leaves those alone.
 */

/** On a dialog that handles the controller itself. */
export const PAD_OWN_ATTR = "data-pad-own";

export function openDialogs(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** The dialog on top: the last one in the document, since later ones stack over earlier. */
export function topDialog(): HTMLElement | null {
  const dialogs = openDialogs();
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
}

/** True while any dialog is up, so the character stands still under it. */
export function dialogOpen(): boolean {
  return openDialogs().length > 0;
}
