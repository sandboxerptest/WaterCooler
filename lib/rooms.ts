/**
 * Room identity.
 *
 * A room is named by its slug, and the slug is in the URL — which means the
 * link is the credential. Anyone holding it can walk in, so slugs should be
 * unguessable for anything but a demo.
 *
 * Shared by client and server, so no imports beyond this file.
 */

export const DEFAULT_ROOM_SLUG = "local";

const MAX_SLUG_LENGTH = 40;

/**
 * Reduce anything to a safe slug. Rooms end up as directory names for agent
 * sandboxes, so this has to exclude separators and traversal outright rather
 * than trusting callers.
 */
export function normaliseRoomSlug(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_ROOM_SLUG;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug || DEFAULT_ROOM_SLUG;
}

/** A random slug with enough entropy that a link cannot be guessed. */
export function generateRoomSlug(randomBytes: () => string): string {
  return `r-${randomBytes()}`;
}

/** Which room this browser is in, taken from /r/<slug> or ?room=<slug>. */
export function roomFromLocation(location: { pathname: string; search: string }): string {
  const path = location.pathname.match(/^\/r\/([^/]+)/);
  if (path) return normaliseRoomSlug(decodeURIComponent(path[1]));

  const params = new URLSearchParams(location.search);
  const query = params.get("room");
  if (query) return normaliseRoomSlug(query);

  return DEFAULT_ROOM_SLUG;
}
