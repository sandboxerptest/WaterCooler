/**
 * The shared whiteboard.
 *
 * Drawings are stored as strokes rather than as an image: they are small, they
 * merge cleanly when two people draw at once, and a late arrival can be handed
 * the list and replay it. Shared by client and server, so no imports.
 */

/** Board coordinates are fixed, so a drawing looks the same on every screen. */
export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;

/** Beyond this the oldest strokes are dropped, so a board cannot grow forever. */
export const MAX_STROKES = 2000;

export type BoardTool = "pen" | "line" | "rect" | "ellipse" | "eraser";

export interface Stroke {
  id: string;
  tool: BoardTool;
  color: string;
  width: number;
  /** Flat pairs — x0, y0, x1, y1 … — in board coordinates. */
  points: number[];
  /** Who drew it, for the "cleared by" note and future attribution. */
  author?: string;
}

/** The palette offered in the toolbar. Chalk-ish, since it is a board. */
export const BOARD_COLORS = [
  "#f4f4f4",
  "#ffd866",
  "#7ee0a2",
  "#78bfff",
  "#ff8d7a",
  "#d4a5ff",
] as const;

export const BOARD_WIDTHS = [2, 6, 14] as const;

export function isStroke(value: unknown): value is Stroke {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<Stroke>;
  return (
    typeof s.id === "string" &&
    typeof s.tool === "string" &&
    typeof s.color === "string" &&
    typeof s.width === "number" &&
    Array.isArray(s.points) &&
    s.points.length >= 2 &&
    s.points.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Clamp a stroke to the board and cap its size, so one client cannot flood it. */
export function sanitiseStroke(stroke: Stroke): Stroke {
  const points = stroke.points.slice(0, 2000).map((value, index) => {
    const limit = index % 2 === 0 ? BOARD_WIDTH : BOARD_HEIGHT;
    return Math.min(Math.max(Math.round(value), 0), limit);
  });

  return {
    id: stroke.id.slice(0, 64),
    tool: stroke.tool,
    color: stroke.color.slice(0, 32),
    width: Math.min(Math.max(stroke.width, 1), 40),
    points,
    author: stroke.author?.slice(0, 16),
  };
}

/**
 * The board is one board. Every room shows the same drawing, so it is
 * stored under this name rather than the room's, and a change is told to
 * every room rather than the one it was made in.
 */
export const SHARED_BOARD = "global";
