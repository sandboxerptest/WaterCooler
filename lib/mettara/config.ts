/**
 * Mettara Connect configuration.
 *
 * Mettara is the second AI backend WaterCooler can run agents on, alongside
 * the Claude CLI. Where Claude is reached by spawning a binary, Mettara is a
 * hosted service reached in-process over its SDK, so the only setup is a pair
 * of environment variables — there is nothing to install on PATH.
 *
 * Docs: https://connect-a12e4c.gitlab.io/
 */

/** Default API host, overridable for staging or a self-hosted deployment. */
export const DEFAULT_BASE_URL = "https://api.mettara.ai";

/**
 * The AI a seat talks to when nothing more specific is chosen. Mettara
 * addresses its assistants by "technical name" rather than by model id, so
 * this is the HUD's model field in disguise.
 */
export const DEFAULT_AI_NAME = "assistant";

/** Just the shape we read, so tests can pass a plain object. */
export type EnvLike = Record<string, string | undefined>;

export interface MettaraConfig {
  apiSecret: string;
  platformId: string;
  baseUrl: string;
  /** Namespace the room's people are provisioned under on Mettara's side. */
  groupId: string;
  groupName: string;
  defaultAiName: string;
}

/** Reads config from the environment. Returns null when required keys are absent. */
export function readMettaraConfig(env: EnvLike = process.env): MettaraConfig | null {
  const apiSecret = env.METTARA_API_SECRET?.trim();
  const platformId = env.METTARA_PLATFORM_ID?.trim();
  if (!apiSecret || !platformId) return null;
  return {
    apiSecret,
    platformId,
    baseUrl: env.METTARA_BASE_URL?.trim() || DEFAULT_BASE_URL,
    groupId: env.METTARA_GROUP_ID?.trim() || "watercooler",
    groupName: env.METTARA_GROUP_NAME?.trim() || "WaterCooler",
    defaultAiName: env.METTARA_AI_NAME?.trim() || DEFAULT_AI_NAME,
  };
}

/**
 * Why Mettara cannot run right now, or null when it is ready.
 *
 * Checked before every run so a missing secret reads as a sentence in the
 * worker's speech bubble rather than surfacing as an opaque failure.
 */
export function mettaraPreflight(env: EnvLike = process.env): string | null {
  if (!env.METTARA_API_SECRET?.trim()) {
    return "No METTARA_API_SECRET set on the server — Mettara agents cannot run.";
  }
  if (!env.METTARA_PLATFORM_ID?.trim()) {
    return "No METTARA_PLATFORM_ID set on the server — Mettara agents cannot run.";
  }
  return null;
}

/**
 * Mettara identifies each person by the id they carry on our side, so a seat
 * keeps the same Mettara user across restarts and its conversations stay
 * attributable. Falls back to the session key for seats with no label.
 */
export function sourceUserId(seatLabel: string | undefined, sessionKey: string): string {
  // Falling back to a constant would hand every unnameable seat the same
  // Mettara user, and with it a shared conversation history.
  return slug(seatLabel) || slug(sessionKey) || "seat";
}

function slug(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
