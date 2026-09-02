/**
 * Who is in the room right now.
 *
 * Presence is deliberately not persisted: it changes twenty times a second and
 * means nothing once someone closes the tab. The hub holds it in memory, caps
 * the number of humans, and refuses movement that walking could not produce.
 *
 * The clock is injectable so the timing rules can be tested without waiting.
 */

import {
  IDLE_TIMEOUT_MS,
  MAX_HUMAN_PLAYERS,
  MOVE_SPEED_PX_S,
  SPEED_TOLERANCE,
  type Facing,
  type PresencePlayer,
} from "../presence-types";

interface TrackedPlayer extends PresencePlayer {
  lastSeen: number;
  lastMoveAt: number;
}

export interface JoinRequest {
  name: string;
  spriteKey: string;
  x: number;
  y: number;
  facing: Facing;
  /** A server-driven resident: takes no human seat and never times out. */
  resident?: boolean;
}

export type JoinResult =
  | { ok: true; player: PresencePlayer }
  | { ok: false; reason: "full"; capacity: number };

export interface HubOptions {
  capacity?: number;
  now?: () => number;
}

/** Trim a name to something that fits over a character's head. */
export function sanitiseName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 16);
  return cleaned || "Guest";
}

export class PresenceHub {
  private players = new Map<string, TrackedPlayer>();
  private now: () => number;
  readonly capacity: number;

  constructor(options: HubOptions = {}) {
    this.capacity = options.capacity ?? MAX_HUMAN_PLAYERS;
    this.now = options.now ?? (() => Date.now());
  }

  /** How many people — residents do not count against the room. */
  get count(): number {
    let humans = 0;
    for (const player of this.players.values()) if (!player.resident) humans++;
    return humans;
  }

  get isFull(): boolean {
    return this.players.size >= this.capacity;
  }

  join(id: string, request: JoinRequest): JoinResult {
    const existing = this.players.get(id);
    if (!existing && this.isFull) {
      return { ok: false, reason: "full", capacity: this.capacity };
    }

    const at = this.now();
    const player: TrackedPlayer = {
      id,
      name: sanitiseName(request.name),
      spriteKey: request.spriteKey,
      x: request.x,
      y: request.y,
      facing: request.facing,
      moving: false,
      resident: request.resident || undefined,
      lastSeen: at,
      lastMoveAt: at,
    };
    this.players.set(id, player);
    return { ok: true, player: strip(player) };
  }

  /**
   * Put a player where a scene says they stand. A join is the scene's word
   * on where a person is — through a door, off a ferry — so unlike a move it
   * is not held to walking speed from wherever they were before.
   */
  place(id: string, at: { x: number; y: number; facing: Facing }): PresencePlayer | null {
    const player = this.players.get(id);
    if (!player) return null;
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return strip(player);
    const now = this.now();
    player.x = at.x;
    player.y = at.y;
    player.facing = at.facing;
    player.moving = false;
    player.lastSeen = now;
    player.lastMoveAt = now;
    return strip(player);
  }

  leave(id: string): PresencePlayer | null {
    const player = this.players.get(id);
    if (!player) return null;
    this.players.delete(id);
    return strip(player);
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  /**
   * Apply a movement update. Positions are clamped to what walking could cover
   * since the player's last update, so a modified client cannot teleport across
   * the office or into a locked room.
   */
  move(
    id: string,
    update: { x: number; y: number; facing: Facing; moving: boolean },
  ): PresencePlayer | null {
    const player = this.players.get(id);
    if (!player) return null;
    if (!Number.isFinite(update.x) || !Number.isFinite(update.y)) return strip(player);

    const at = this.now();
    const elapsedMs = Math.max(at - player.lastMoveAt, 0);
    const budget = (MOVE_SPEED_PX_S / 1000) * elapsedMs * SPEED_TOLERANCE;

    const dx = update.x - player.x;
    const dy = update.y - player.y;
    const distance = Math.hypot(dx, dy);

    if (distance > budget && distance > 0) {
      // Move as far along their intended direction as walking allows
      const scale = budget / distance;
      player.x += dx * scale;
      player.y += dy * scale;
    } else {
      player.x = update.x;
      player.y = update.y;
    }

    player.facing = update.facing;
    player.moving = update.moving;
    player.lastSeen = at;
    player.lastMoveAt = at;
    return strip(player);
  }

  /** Note that a client is still alive without moving it. */
  touch(id: string) {
    const player = this.players.get(id);
    if (player) player.lastSeen = this.now();
  }

  /** Drop players who have gone quiet. Returns the ones removed. */
  sweep(): PresencePlayer[] {
    const at = this.now();
    const dropped: PresencePlayer[] = [];
    for (const [id, player] of this.players) {
      if (player.resident) continue;
      if (at - player.lastSeen > IDLE_TIMEOUT_MS) {
        this.players.delete(id);
        dropped.push(strip(player));
      }
    }
    return dropped;
  }

  snapshot(): PresencePlayer[] {
    return [...this.players.values()].map(strip);
  }
}

function strip(player: TrackedPlayer): PresencePlayer {
  return {
    id: player.id,
    name: player.name,
    spriteKey: player.spriteKey,
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100,
    facing: player.facing,
    moving: player.moving,
    ...(player.resident ? { resident: true } : {}),
  };
}
