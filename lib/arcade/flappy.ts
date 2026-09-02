/**
 * Flappy: a bird, gravity, and a tap that fights it. Pipes scroll in from
 * the right with a gap to thread; each one passed is a point.
 */

import { FONT, SCREEN, type ArcadeGame, type ArcadeInput } from "./types";

export const GRAVITY = 1500;
export const FLAP = -430;
export const BIRD_X = 84;
export const BIRD_R = 11;
export const PIPE_WIDTH = 52;
export const GAP = 132;
export const SPEED = 150;
export const SPACING = 200;
export const GROUND_Y = 436;
const TOP_MARGIN = 60;
const BOTTOM_MARGIN = 70;

export interface Pipe {
  x: number;
  /** Top of the gap. */
  gapY: number;
  passed: boolean;
}

export interface FlappyState {
  y: number;
  vy: number;
  pipes: Pipe[];
  score: number;
  started: boolean;
  over: boolean;
  /** For the wing and the ground scroll. */
  t: number;
  /** Sounds for the cabinet to play, by name, since the last frame. */
  sfx: string[];
  random: () => number;
}

export function createFlappy(random: () => number = Math.random): FlappyState {
  return {
    y: SCREEN.height / 2 - 20,
    vy: 0,
    pipes: [],
    score: 0,
    started: false,
    over: false,
    t: 0,
    sfx: [],
    random,
  };
}

function newPipe(x: number, random: () => number): Pipe {
  const room = GROUND_Y - BOTTOM_MARGIN - TOP_MARGIN - GAP;
  return { x, gapY: TOP_MARGIN + random() * room, passed: false };
}

export function stepFlappy(state: FlappyState, input: ArcadeInput, dt: number) {
  if (state.over) return;
  const flap = input.actionPressed || input.tap !== null;
  state.t += dt;
  if (!state.started) {
    // Hover until the first flap.
    state.y = SCREEN.height / 2 - 20 + Math.sin(state.t * 4) * 6;
    if (!flap) return;
    state.started = true;
    state.pipes = [newPipe(SCREEN.width + 40, state.random)];
  }
  if (flap) {
    state.vy = FLAP;
    state.sfx.push("flap");
  }
  state.vy += GRAVITY * dt;
  state.y += state.vy * dt;

  for (const pipe of state.pipes) pipe.x -= SPEED * dt;
  const last = state.pipes[state.pipes.length - 1];
  if (last && last.x < SCREEN.width - SPACING) {
    state.pipes.push(newPipe(last.x + SPACING, state.random));
  }
  state.pipes = state.pipes.filter((p) => p.x + PIPE_WIDTH > -10);

  for (const pipe of state.pipes) {
    if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X) {
      pipe.passed = true;
      state.score += 1;
      state.sfx.push("score");
    }
    const inColumn = BIRD_X + BIRD_R > pipe.x && BIRD_X - BIRD_R < pipe.x + PIPE_WIDTH;
    const inGap = state.y - BIRD_R > pipe.gapY && state.y + BIRD_R < pipe.gapY + GAP;
    if (inColumn && !inGap && !state.over) {
      state.over = true;
      state.sfx.push("die");
    }
  }
  if (state.y + BIRD_R >= GROUND_Y) {
    state.y = GROUND_Y - BIRD_R;
    if (!state.over) state.sfx.push("die");
    state.over = true;
  }
  if (state.y - BIRD_R < 0) {
    state.y = BIRD_R;
    state.vy = 0;
  }
}

export function drawFlappy(ctx: CanvasRenderingContext2D, state: FlappyState) {
  const { width, height } = SCREEN;
  ctx.fillStyle = "#4ec0ca";
  ctx.fillRect(0, 0, width, height);
  // Distant hills.
  ctx.fillStyle = "#5fb26b";
  for (let i = 0; i < 5; i++) {
    const x = ((i * 90 - state.t * 20) % (width + 90)) - 45;
    ctx.beginPath();
    ctx.arc(x, GROUND_Y + 10, 60, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = "#2f8f3a";
  for (const pipe of state.pipes) {
    ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
    ctx.fillRect(pipe.x, pipe.gapY + GAP, PIPE_WIDTH, GROUND_Y - pipe.gapY - GAP);
    ctx.fillStyle = "#3fbf4f";
    ctx.fillRect(pipe.x - 3, pipe.gapY - 18, PIPE_WIDTH + 6, 18);
    ctx.fillRect(pipe.x - 3, pipe.gapY + GAP, PIPE_WIDTH + 6, 18);
    ctx.fillStyle = "#2f8f3a";
  }
  // Ground.
  ctx.fillStyle = "#d9c47a";
  ctx.fillRect(0, GROUND_Y, width, height - GROUND_Y);
  ctx.fillStyle = "#7ac74f";
  ctx.fillRect(0, GROUND_Y, width, 8);
  ctx.fillStyle = "#c9b264";
  for (let x = -((state.t * SPEED) % 24); x < width; x += 24) ctx.fillRect(x, GROUND_Y + 14, 12, 4);
  // The bird: body, wing, eye, beak.
  const tilt = Math.max(-0.5, Math.min(1.2, state.vy / 600));
  ctx.save();
  ctx.translate(BIRD_X, state.y);
  ctx.rotate(state.started ? tilt : 0);
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e0a93a";
  const wing = Math.sin(state.t * 18) * 3;
  ctx.fillRect(-9, -1 + wing, 9, 5);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(4, -4, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(5, -4, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8552f";
  ctx.fillRect(8, 0, 8, 4);
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = `20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(String(state.score), width / 2, 50);
  ctx.font = `8px ${FONT}`;
  if (!state.started) ctx.fillText("TAP OR SPACE TO FLAP", width / 2, height / 2 + 50);
  if (state.over) ctx.fillText("GAME OVER", width / 2, height / 2 - 40);
}

export const flappy: ArcadeGame<FlappyState> = {
  id: "flappy",
  title: "Flappy",
  blurb: "Thread the pipes. One flap at a time.",
  keys: "Space, ↑ or W to flap",
  touch: "Tap anywhere to flap",
  create: createFlappy,
  step: stepFlappy,
  draw: drawFlappy,
  score: (s) => s.score,
  over: (s) => s.over,
};
