/**
 * Snake: a grid, an apple, and a body that grows with every one eaten.
 * Walls and your own tail end it. It speeds up a little as it grows.
 */

import { FONT, SCREEN, type ArcadeGame, type ArcadeInput } from "./types";

export const CELL = 16;
export const COLS = SCREEN.width / CELL;
export const ROWS = (SCREEN.height - 32) / CELL;
const TOP = 32;
const START_INTERVAL = 0.13;
const MIN_INTERVAL = 0.06;

export type Dir = "up" | "down" | "left" | "right";
export interface Cell {
  x: number;
  y: number;
}

export interface SnakeState {
  body: Cell[];
  dir: Dir;
  nextDir: Dir;
  apple: Cell;
  timer: number;
  interval: number;
  score: number;
  started: boolean;
  over: boolean;
  sfx: string[];
  random: () => number;
}

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const CLOCKWISE: Record<Dir, Dir> = { up: "right", right: "down", down: "left", left: "up" };
const COUNTER: Record<Dir, Dir> = { up: "left", left: "down", down: "right", right: "up" };

function placeApple(body: Cell[], random: () => number): Cell {
  for (let tries = 0; tries < 500; tries++) {
    const apple = { x: Math.floor(random() * COLS), y: Math.floor(random() * ROWS) };
    if (!body.some((c) => c.x === apple.x && c.y === apple.y)) return apple;
  }
  return { x: 0, y: 0 };
}

export function createSnake(random: () => number = Math.random): SnakeState {
  const body = [
    { x: 8, y: 14 },
    { x: 7, y: 14 },
    { x: 6, y: 14 },
  ];
  return {
    body,
    dir: "right",
    nextDir: "right",
    apple: placeApple(body, random),
    timer: 0,
    interval: START_INTERVAL,
    score: 0,
    started: false,
    over: false,
    sfx: [],
    random,
  };
}

/** Turn, unless it would double straight back. */
export function turn(state: SnakeState, dir: Dir) {
  if (dir === OPPOSITE[state.dir]) return;
  state.nextDir = dir;
}

export function stepSnake(state: SnakeState, input: ArcadeInput, dt: number) {
  if (state.over) return;
  if (input.up) turn(state, "up");
  else if (input.down) turn(state, "down");
  else if (input.left) turn(state, "left");
  else if (input.right) turn(state, "right");
  // A tap on the left of the screen turns left, on the right turns right.
  if (input.tap)
    turn(state, input.tap.x < SCREEN.width / 2 ? COUNTER[state.dir] : CLOCKWISE[state.dir]);
  if (!state.started) {
    if (input.up || input.down || input.left || input.right || input.tap || input.actionPressed) {
      state.started = true;
    } else return;
  }
  state.timer += dt;
  while (state.timer >= state.interval) {
    state.timer -= state.interval;
    advance(state);
    if (state.over) return;
  }
}

export function advance(state: SnakeState) {
  state.dir = state.nextDir;
  const head = state.body[0];
  const next = { x: head.x + DELTA[state.dir].x, y: head.y + DELTA[state.dir].y };
  if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS) {
    state.over = true;
    state.sfx.push("die");
    return;
  }
  const eating = next.x === state.apple.x && next.y === state.apple.y;
  // The tail moves out of the way unless the body is about to grow.
  const occupied = eating ? state.body : state.body.slice(0, -1);
  if (occupied.some((c) => c.x === next.x && c.y === next.y)) {
    state.over = true;
    state.sfx.push("die");
    return;
  }
  state.body.unshift(next);
  if (eating) {
    state.score += 1;
    state.sfx.push("eat");
    state.apple = placeApple(state.body, state.random);
    state.interval = Math.max(MIN_INTERVAL, state.interval * 0.97);
  } else {
    state.body.pop();
  }
}

export function drawSnake(ctx: CanvasRenderingContext2D, state: SnakeState) {
  const { width, height } = SCREEN;
  ctx.fillStyle = "#0f1a12";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#16261a";
  for (let y = 0; y < ROWS; y++)
    for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(x * CELL, TOP + y * CELL, CELL, CELL);
  // Apple.
  ctx.fillStyle = "#e8552f";
  ctx.fillRect(state.apple.x * CELL + 2, TOP + state.apple.y * CELL + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = "#3fbf4f";
  ctx.fillRect(state.apple.x * CELL + 7, TOP + state.apple.y * CELL, 3, 4);
  // Body, head brightest.
  state.body.forEach((cell, i) => {
    ctx.fillStyle = i === 0 ? "#b6f27a" : i % 2 ? "#5fbf4f" : "#4aa53e";
    ctx.fillRect(cell.x * CELL + 1, TOP + cell.y * CELL + 1, CELL - 2, CELL - 2);
  });
  ctx.fillStyle = "#1c2a1f";
  ctx.fillRect(0, 0, width, TOP);
  ctx.fillStyle = "#fff";
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`APPLES ${state.score}`, 8, 21);
  ctx.textAlign = "center";
  ctx.font = `8px ${FONT}`;
  if (!state.started) ctx.fillText("ARROWS OR TAP TO START", width / 2, height / 2 + 40);
  if (state.over) ctx.fillText("GAME OVER", width / 2, height / 2 - 40);
}

export const snake: ArcadeGame<SnakeState> = {
  id: "snake",
  title: "Snake",
  blurb: "Eat apples, grow long, avoid yourself.",
  keys: "Arrows or WASD to turn",
  touch: "Tap left or right of the screen to turn",
  create: createSnake,
  step: stepSnake,
  draw: drawSnake,
  score: (s) => s.score,
  over: (s) => s.over,
};
