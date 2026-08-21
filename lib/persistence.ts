/**
 * Device-local preferences.
 *
 * World state — tasks, chat, sessions, seats — lives on the server now; see
 * lib/room-client.ts. What stays here is everything that is a property of this
 * browser rather than of the world: gateway connection settings, music volume,
 * and whether onboarding has been seen.
 */

import type { GatewayConfig, SeatType, AgentConfig } from "@/types/game";
import { createLogger } from "./logger";
import {
  LS_CONFIG,
  LS_BGM_VOLUME,
  LS_PLAYER_NAME,
  LS_ONBOARDING_DONE,
  DEFAULT_BGM_VOLUME,
} from "./constants";

const log = createLogger("Persistence");

export interface PersistedSeatConfig {
  seatId: string;
  label?: string;
  seatType?: SeatType;
  roleTitle?: string;
  assigned?: boolean;
  spriteKey?: string;
  spritePath?: string;
  agentConfig?: AgentConfig;
}

// ── Generic helpers ────────────────────────────────────

/** Keys were prefixed "agent-town:" before the rename. */
const LEGACY_PREFIX = "agent-town:";
const CURRENT_PREFIX = "watercooler:";

/**
 * Read a preference, adopting the pre-rename value if this browser still has
 * one. Without this the rename would silently forget everyone's display name,
 * music volume and gateway settings.
 */
export function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    let raw = localStorage.getItem(key);

    if (raw === null && key.startsWith(CURRENT_PREFIX)) {
      const legacyKey = key.replace(CURRENT_PREFIX, LEGACY_PREFIX);
      raw = localStorage.getItem(legacyKey);
      if (raw !== null) {
        localStorage.setItem(key, raw);
        localStorage.removeItem(legacyKey);
      }
    }

    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    log.warn(`failed to write "${key}":`, err);
  }
}

// ── Domain-specific loaders ────────────────────────────

export function loadGatewayConfig(): GatewayConfig | null {
  return lsGet<GatewayConfig | null>(LS_CONFIG, null);
}

export function saveGatewayConfig(config: GatewayConfig) {
  lsSet(LS_CONFIG, config);
}

export function loadPlayerName(): string {
  return lsGet<string>(LS_PLAYER_NAME, "Guest");
}

export function savePlayerName(name: string) {
  lsSet(LS_PLAYER_NAME, name);
}

export function loadBgmVolume(): number {
  return lsGet<number>(LS_BGM_VOLUME, DEFAULT_BGM_VOLUME);
}

export function saveBgmVolume(volume: number) {
  lsSet(LS_BGM_VOLUME, volume);
}

export function loadOnboardingDone(): boolean {
  return lsGet<boolean>(LS_ONBOARDING_DONE, false);
}

export function saveOnboardingDone() {
  lsSet(LS_ONBOARDING_DONE, true);
}
