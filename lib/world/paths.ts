/**
 * The addresses of the world, shared by the HUD and the scenes. Nothing here
 * touches Phaser, so the server can render a page that knows about them.
 *
 * Rooms have their own pages, /r/<slug>. The world map and a campus are
 * reached in-page from a lobby, so their scenes write their address into the
 * bar themselves; that way a reload, a bookmark or a shared link lands where
 * the person actually was.
 */

/** The world map's address. */
export const WORLD_PATH = "/world";

const CAMPUS_PREFIX = "/campus/";

export function isWorldPath(pathname: string): boolean {
  return pathname === WORLD_PATH || pathname === `${WORLD_PATH}/`;
}

/** A campus's address: /campus/<organisation>. */
export function campusPath(slug: string): string {
  return `${CAMPUS_PREFIX}${slug}`;
}

/** The organisation a campus address names, or null for any other address. */
export function campusFromPath(pathname: string): string | null {
  if (!pathname.startsWith(CAMPUS_PREFIX)) return null;
  const slug = pathname.slice(CAMPUS_PREFIX.length).replace(/\/$/, "");
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/** Whether an address is somewhere out of doors — the world map or a campus — rather than a room. */
export function isOutdoorPath(pathname: string): boolean {
  return isWorldPath(pathname) || campusFromPath(pathname) !== null;
}

/**
 * Put an address in the bar without loading anything, keeping any query.
 * For a scene that was started in-page, so a reload comes back to it.
 */
export function showAddress(pathname: string, history: History = window.history): void {
  if (window.location.pathname === pathname) return;
  history.replaceState(history.state, "", pathname);
}
