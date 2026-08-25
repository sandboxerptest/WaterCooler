/**
 * What two people send each other to play a game of ping pong.
 *
 * The match is host-authoritative: whoever sent the challenge runs the game
 * and says where the ball is, and the guest sends nothing but the position of
 * its own bat. That keeps one version of events — with two simulations there
 * is no answer to "whose ball was out?" — and it means the server needs to
 * know nothing about ping pong at all. It only passes these along.
 */

import type { Side } from "./game";

export interface PongInvite {
  kind: "invite";
  /** What the challenger's browser calls this match, so replies can be paired. */
  matchId: string;
}

export interface PongReply {
  kind: "accept" | "decline";
  matchId: string;
}

export interface PongQuit {
  kind: "quit";
  matchId: string;
}

/** Guest → host, many times a second: where my bat is. */
export interface PongPaddle {
  kind: "paddle";
  matchId: string;
  y: number;
}

/** Host → guest, many times a second: how the game actually stands. */
export interface PongSync {
  kind: "state";
  matchId: string;
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: { left: number; right: number };
  score: { left: number; right: number };
  servePause: number;
  winner: Side | null;
  rallyHits: number;
}

export type PongPayload = PongInvite | PongReply | PongQuit | PongPaddle | PongSync;

const KINDS = new Set(["invite", "accept", "decline", "quit", "paddle", "state"]);

/** As long as a match id may be. Anything longer is not one of ours. */
export const MAX_MATCH_ID = 64;

/**
 * Name a match, briefly.
 *
 * Player ids are uuids, and two of them joined together with a counter comes
 * to 75 characters — past the length the relay accepts, so every real
 * challenge was dropped as malformed while the short ids in the tests sailed
 * through. A prefix of each is plenty: the pair only has to tell one match
 * between these two players from the next.
 */
export function makeMatchId(from: string, to: string, sequence: number): string {
  return `${from.slice(0, 8)}-${to.slice(0, 8)}-${sequence}`;
}

/**
 * Enough of a check to relay safely.
 *
 * The server does not play ping pong and does not validate the game — it only
 * makes sure this is one of ours and small enough to pass on.
 */
export function isPongPayload(value: unknown): value is PongPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as { kind?: unknown; matchId?: unknown };
  if (typeof payload.kind !== "string" || !KINDS.has(payload.kind)) return false;
  return typeof payload.matchId === "string" && payload.matchId.length <= MAX_MATCH_ID;
}
