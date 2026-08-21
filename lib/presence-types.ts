/**
 * Shared presence vocabulary for the room socket.
 *
 * Imported by both the browser and the server, so it must stay free of Phaser
 * and of node built-ins.
 */

/** How many *humans* can be in a room at once. Agent seats are unrelated. */
export const MAX_HUMAN_PLAYERS = 4;

/** Presence broadcast rate. 20 Hz is smooth once the client interpolates. */
export const TICK_MS = 50;

/** Client send rate. Matching the tick avoids sending frames nobody reads. */
export const MOVE_SEND_MS = 50;

/** How often the server pings idle sockets to confirm somebody is still there. */
export const HEARTBEAT_MS = 5_000;

/** Drop a player who has gone quiet for this long (tab closed, laptop asleep). */
export const IDLE_TIMEOUT_MS = 15_000;

/**
 * Walking speed in px/s, mirrored from the game's MOVE_SPEED so the server can
 * reject teleports without importing Phaser.
 */
export const MOVE_SPEED_PX_S = 160;

/** Allowance over walking speed before a move is treated as a teleport. */
export const SPEED_TOLERANCE = 2.5;

export type Facing = "up" | "down" | "left" | "right";

export interface PresencePlayer {
  id: string;
  name: string;
  spriteKey: string;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
}

// ── Client → server ────────────────────────────────────

export interface JoinMessage {
  type: "join";
  name: string;
  spriteKey: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface MoveMessage {
  type: "move";
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
}

export type ClientMessage = JoinMessage | MoveMessage;

// ── Server → client ────────────────────────────────────

export interface WelcomeMessage {
  type: "welcome";
  you: string;
  players: PresencePlayer[];
  capacity: number;
}

export interface RejectedMessage {
  type: "rejected";
  reason: "full";
  capacity: number;
}

export interface PresenceMessage {
  type: "presence";
  players: PresencePlayer[];
}

export interface PlayerJoinedMessage {
  type: "joined";
  player: PresencePlayer;
}

export interface PlayerLeftMessage {
  type: "left";
  id: string;
  name: string;
}

export type ServerMessage =
  | WelcomeMessage
  | RejectedMessage
  | PresenceMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "join" || type === "move";
}
