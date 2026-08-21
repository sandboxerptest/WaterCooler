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
  /** Which room to walk into; absent means the default one. */
  room?: string;
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

/**
 * A change to the shared world. One entity at a time: with four people acting
 * at once, sending whole collections means the later write erases the other
 * person's work.
 */
export type WorldChange =
  | { entity: "task"; task: Record<string, unknown> }
  | { entity: "message"; message: Record<string, unknown> }
  | { entity: "seat"; seat: Record<string, unknown> }
  | { entity: "session"; session: Record<string, unknown> };

export interface WorldMessage {
  type: "world";
  change: WorldChange;
}

/** How far a "nearby" remark carries, in pixels — roughly five tiles. */
export const EARSHOT_PX = 260;

export type SayScope = "room" | "nearby";

export interface SayMessage {
  type: "say";
  text: string;
  scope: SayScope;
}

/** A mark added to the room's whiteboard, or a request to wipe it. */
export interface BoardMessage {
  type: "board";
  action: "draw" | "clear";
  stroke?: unknown;
  /** False while the pen is still moving, true when it is lifted. */
  done?: boolean;
}

export type ClientMessage = JoinMessage | MoveMessage | WorldMessage | SayMessage | BoardMessage;

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

/** What this room has spent on agents, and the ceiling it stops at. */
export interface BudgetMessage {
  type: "budget";
  spentUsd: number;
  limitUsd: number;
  /** True once the ceiling is reached and dispatch has stopped. */
  halted: boolean;
}

/** Somebody — or some agent — just earned a badge. */
export interface AchievementMessage {
  type: "achievement";
  code: string;
  subjectType: "agent" | "human";
  subjectId: string;
  subjectName: string;
  title: string;
  description: string;
  icon: string;
  at: string;
}

export interface WorldBroadcast {
  type: "world";
  change: WorldChange;
  /** Who made the change, so the room can say who asked for what. */
  by?: { id: string; name: string };
}

/** Something a human said, as heard by everyone in range. */
export interface SaidMessage {
  type: "said";
  id: string;
  from: { id: string; name: string };
  text: string;
  at: string;
  scope: SayScope;
}

export interface BoardBroadcast {
  type: "board";
  action: "draw" | "clear";
  stroke?: unknown;
  done?: boolean;
  by?: string;
}

export type ServerMessage =
  | WelcomeMessage
  | RejectedMessage
  | PresenceMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | WorldBroadcast
  | BudgetMessage
  | SaidMessage
  | AchievementMessage
  | BoardBroadcast;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "join" || type === "move" || type === "world" || type === "say" || type === "board"
  );
}

const WORLD_ENTITIES = ["task", "message", "seat", "session"] as const;

export function isWorldChange(value: unknown): value is WorldChange {
  if (typeof value !== "object" || value === null) return false;
  const entity = (value as { entity?: unknown }).entity;
  if (!WORLD_ENTITIES.includes(entity as (typeof WORLD_ENTITIES)[number])) return false;
  const payload = (value as Record<string, unknown>)[entity as string];
  return typeof payload === "object" && payload !== null;
}
