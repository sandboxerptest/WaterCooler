/**
 * The room's log: what happened, in the order it happened.
 *
 * Chat holds one conversation. This holds everything else the room did —
 * which agent was set to work and how it went, what it cost, who walked in,
 * who cleared the board — so the panel beside the office is a record of the
 * day rather than a transcript of the last thing typed.
 */

export type ActivityKind = "task" | "agent" | "human" | "badge" | "board" | "game" | "spend";

export interface ActivityEntry {
  /** Position in the room's log, which is also its order. */
  id: number;
  at: string;
  kind: ActivityKind;
  /** Who did it: an agent's name, a person's name, or the room itself. */
  actor: string;
  text: string;
  /** A second line, for the figures: what it cost, how long it took. */
  detail?: string;
}

/** How many entries a room keeps. Older ones fall off the end. */
export const ACTIVITY_LIMIT = 500;

/** The icon each kind gets in the panel. */
export const ACTIVITY_ICON: Record<ActivityKind, string> = {
  task: "▸",
  agent: "◆",
  human: "●",
  badge: "★",
  board: "✎",
  game: "◈",
  spend: "$",
};
