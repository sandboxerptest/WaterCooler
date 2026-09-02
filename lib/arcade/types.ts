/**
 * The arcade cabinet's games share one shape, so the cabinet can run any
 * of them: a state made once, stepped by time and input, drawn to its
 * screen. Nothing here touches React or the DOM; the games are plain
 * functions, and the cabinet is the only thing that knows about a canvas.
 */

export type ArcadeGameId = "flappy" | "snake" | "breakout" | "oak-island" | "solitaire";

/** The cabinet's screen, in game pixels; the canvas scales it. */
export const SCREEN = { width: 320, height: 480 };

export interface ArcadeInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Held. */
  action: boolean;
  /** Went down this frame: a flap, a launch, a start. */
  actionPressed: boolean;
  /** Where a finger or the mouse is on the screen while held, in game pixels. */
  pointerX: number | null;
  /** A touch or click that began this frame, in game pixels. */
  tap: { x: number; y: number } | null;
}

export const NO_INPUT: ArcadeInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  action: false,
  actionPressed: false,
  pointerX: null,
  tap: null,
};

export interface ArcadeGame<S> {
  id: ArcadeGameId;
  title: string;
  blurb: string;
  /** One line each for keys and touch. */
  keys: string;
  touch: string;
  create(random?: () => number): S;
  step(state: S, input: ArcadeInput, dt: number): void;
  draw(ctx: CanvasRenderingContext2D, state: S): void;
  score(state: S): number;
  over(state: S): boolean;
  /** A game you can abandon for a fresh one mid-way: what its button says. */
  restartLabel?: string;
}

export const FONT = '"Press Start 2P", monospace';
