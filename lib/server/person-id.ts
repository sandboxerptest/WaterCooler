import { createHash } from "node:crypto";

/**
 * The id an account's desk and presence go under.
 *
 * Derived from the email so it never changes and never needs storing, and
 * shaped like a browser-minted id — lowercase letters and digits — so
 * everything that already handles those handles it. The leading letter
 * keeps it from ever colliding with a minted one, which is all digits and
 * letters in base 36 but never starts with "u" followed by hex.
 */
export function personIdForEmail(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `u${digest.slice(0, 11)}`;
}
