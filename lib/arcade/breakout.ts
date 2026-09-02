/**
 * Breakout: a paddle, a ball, and a wall of bricks to clear. Three balls;
 * every wall cleared brings a faster one. Some bricks drop a capsule when
 * broken; catch it on the paddle for a power: a wider paddle, a slower
 * ball, two more balls, or an extra life.
 */

import { FONT, SCREEN, type ArcadeGame, type ArcadeInput } from "./types";

export const PADDLE_WIDTH = 64;
export const WIDE_PADDLE_WIDTH = 104;
export const PADDLE_HEIGHT = 10;
export const PADDLE_Y = SCREEN.height - 36;
export const PADDLE_SPEED = 340;
export const BALL_R = 5;
export const BALL_SPEED = 260;
export const COLS = 8;
export const ROWS = 6;
export const BRICK_WIDTH = 36;
export const BRICK_HEIGHT = 14;
const BRICK_GAP = 4;
const BRICK_TOP = 60;
const BRICK_LEFT = (SCREEN.width - (COLS * BRICK_WIDTH + (COLS - 1) * BRICK_GAP)) / 2;
export const BALLS = 3;
/** How likely a broken brick is to drop a capsule. */
export const DROP_CHANCE = 0.18;
const DROP_SPEED = 110;
const DROP_SIZE = 18;
/** How long a wide paddle or a slow ball lasts. */
export const POWER_SECONDS = 12;
const ROW_COLOURS = ["#e8552f", "#f2913d", "#f2c94c", "#5fbf4f", "#4ec0ca", "#8a7ff2"];

export type Power = "wide" | "slow" | "multi" | "life";
export const POWERS: Power[] = ["wide", "slow", "multi", "life"];
const POWER_LABEL: Record<Power, string> = { wide: "W", slow: "S", multi: "M", life: "+" };
const POWER_COLOUR: Record<Power, string> = {
  wide: "#4ec0ca",
  slow: "#8a7ff2",
  multi: "#f2c94c",
  life: "#5fbf4f",
};
const POWER_NAME: Record<Power, string> = {
  wide: "WIDE PADDLE",
  slow: "SLOW BALL",
  multi: "MULTI BALL",
  life: "EXTRA BALL",
};

export interface Brick {
  x: number;
  y: number;
  row: number;
  alive: boolean;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Drop {
  x: number;
  y: number;
  power: Power;
}

export interface BreakoutState {
  paddleX: number;
  balls: Ball[];
  stuck: boolean;
  bricks: Brick[];
  drops: Drop[];
  score: number;
  ballsLeft: number;
  level: number;
  over: boolean;
  /** Seconds of wide paddle left. */
  wide: number;
  /** Seconds of slow ball left. */
  slow: number;
  /** What was just caught, and for how much longer to say so. */
  caught: { power: Power; until: number } | null;
  t: number;
  sfx: string[];
  random: () => number;
}

function wall(): Brick[] {
  const bricks: Brick[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      bricks.push({
        x: BRICK_LEFT + col * (BRICK_WIDTH + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
        row,
        alive: true,
      });
  return bricks;
}

export function createBreakout(random: () => number = Math.random): BreakoutState {
  return {
    paddleX: SCREEN.width / 2,
    balls: [{ x: SCREEN.width / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }],
    stuck: true,
    bricks: wall(),
    drops: [],
    score: 0,
    ballsLeft: BALLS,
    level: 1,
    over: false,
    wide: 0,
    slow: 0,
    caught: null,
    t: 0,
    sfx: [],
    random,
  };
}

export function paddleWidth(state: BreakoutState): number {
  return state.wide > 0 ? WIDE_PADDLE_WIDTH : PADDLE_WIDTH;
}

function speedFor(state: BreakoutState): number {
  return BALL_SPEED * (1 + (state.level - 1) * 0.15) * (state.slow > 0 ? 0.65 : 1);
}

function launch(state: BreakoutState) {
  const speed = speedFor(state);
  const angle = -Math.PI / 2 + (state.random() - 0.5) * 0.8;
  const ball = state.balls[0];
  ball.vx = Math.cos(angle) * speed;
  ball.vy = Math.sin(angle) * speed;
  state.stuck = false;
}

/** Give a caught capsule its effect. */
export function applyPower(state: BreakoutState, power: Power) {
  state.caught = { power, until: state.t + 1.5 };
  state.sfx.push("power");
  switch (power) {
    case "wide":
      state.wide = POWER_SECONDS;
      return;
    case "slow":
      state.slow = POWER_SECONDS;
      for (const ball of state.balls) {
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed === 0) continue;
        const target = speedFor(state);
        ball.vx = (ball.vx / speed) * target;
        ball.vy = (ball.vy / speed) * target;
      }
      return;
    case "multi": {
      const source = state.balls[0];
      const speed = Math.max(Math.hypot(source.vx, source.vy), speedFor(state));
      for (const angle of [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5]) {
        state.balls.push({
          x: source.x,
          y: source.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
        });
      }
      return;
    }
    case "life":
      state.ballsLeft += 1;
      return;
  }
}

function bounceBall(state: BreakoutState, ball: Ball): boolean {
  if (ball.x - BALL_R < 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  }
  if (ball.x + BALL_R > SCREEN.width) {
    ball.x = SCREEN.width - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - BALL_R < 0) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
  }
  const half = paddleWidth(state) / 2;
  // The paddle: the strike point sets the angle, so aiming is possible.
  if (
    ball.vy > 0 &&
    ball.y + BALL_R >= PADDLE_Y &&
    ball.y + BALL_R <= PADDLE_Y + PADDLE_HEIGHT + 6 &&
    Math.abs(ball.x - state.paddleX) <= half + BALL_R
  ) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const offset = Math.max(-1, Math.min(1, (ball.x - state.paddleX) / half));
    const angle = -Math.PI / 2 + offset * 1.05;
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.y = PADDLE_Y - BALL_R;
    state.sfx.push("bounce");
  }
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    if (
      ball.x + BALL_R < brick.x ||
      ball.x - BALL_R > brick.x + BRICK_WIDTH ||
      ball.y + BALL_R < brick.y ||
      ball.y - BALL_R > brick.y + BRICK_HEIGHT
    )
      continue;
    brick.alive = false;
    state.score += (ROWS - brick.row) * 10;
    state.sfx.push("brick");
    if (state.random() < DROP_CHANCE) {
      state.drops.push({
        x: brick.x + BRICK_WIDTH / 2,
        y: brick.y + BRICK_HEIGHT / 2,
        power: POWERS[Math.floor(state.random() * POWERS.length)],
      });
    }
    // Bounce off whichever face is nearer.
    const fromLeft = ball.x < brick.x;
    const fromRight = ball.x > brick.x + BRICK_WIDTH;
    if (fromLeft || fromRight) ball.vx = -ball.vx;
    else ball.vy = -ball.vy;
    break;
  }
  // Gone off the bottom.
  return ball.y - BALL_R > SCREEN.height;
}

export function stepBreakout(state: BreakoutState, input: ArcadeInput, dt: number) {
  if (state.over) return;
  state.t += dt;
  if (state.wide > 0) state.wide = Math.max(0, state.wide - dt);
  if (state.slow > 0) state.slow = Math.max(0, state.slow - dt);
  if (state.caught && state.t > state.caught.until) state.caught = null;

  if (input.pointerX !== null) state.paddleX = input.pointerX;
  if (input.left) state.paddleX -= PADDLE_SPEED * dt;
  if (input.right) state.paddleX += PADDLE_SPEED * dt;
  const half = paddleWidth(state) / 2;
  state.paddleX = Math.max(half, Math.min(SCREEN.width - half, state.paddleX));

  // Capsules fall; the paddle catches them, the floor eats them.
  for (const drop of state.drops) drop.y += DROP_SPEED * dt;
  const kept: Drop[] = [];
  for (const drop of state.drops) {
    const onPaddle =
      drop.y + DROP_SIZE / 2 >= PADDLE_Y &&
      drop.y - DROP_SIZE / 2 <= PADDLE_Y + PADDLE_HEIGHT &&
      Math.abs(drop.x - state.paddleX) <= half + DROP_SIZE / 2;
    if (onPaddle) applyPower(state, drop.power);
    else if (drop.y - DROP_SIZE / 2 < SCREEN.height) kept.push(drop);
  }
  state.drops = kept;

  if (state.stuck) {
    const ball = state.balls[0];
    ball.x = state.paddleX;
    ball.y = PADDLE_Y - BALL_R - 1;
    if (input.actionPressed || input.tap) {
      launch(state);
      state.sfx.push("select");
    }
    return;
  }

  for (const ball of state.balls) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }
  state.balls = state.balls.filter((ball) => !bounceBall(state, ball));

  if (state.bricks.every((b) => !b.alive)) {
    state.level += 1;
    state.sfx.push("win");
    state.bricks = wall();
    state.drops = [];
    state.balls = [{ x: state.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }];
    state.stuck = true;
    return;
  }
  if (state.balls.length === 0) {
    state.ballsLeft -= 1;
    state.sfx.push(state.ballsLeft <= 0 ? "die" : "lose");
    state.balls = [{ x: state.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }];
    state.stuck = true;
    if (state.ballsLeft <= 0) state.over = true;
  }
}

export function drawBreakout(ctx: CanvasRenderingContext2D, state: BreakoutState) {
  const { width, height } = SCREEN;
  ctx.fillStyle = "#101b24";
  ctx.fillRect(0, 0, width, height);
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    ctx.fillStyle = ROW_COLOURS[brick.row % ROW_COLOURS.length];
    ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, 3);
  }
  // Capsules, lettered by what they do.
  for (const drop of state.drops) {
    ctx.fillStyle = POWER_COLOUR[drop.power];
    ctx.fillRect(drop.x - DROP_SIZE / 2, drop.y - DROP_SIZE / 2, DROP_SIZE, DROP_SIZE);
    ctx.fillStyle = "#101b24";
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(POWER_LABEL[drop.power], drop.x, drop.y + 4);
  }
  const pw = paddleWidth(state);
  ctx.fillStyle = state.wide > 0 ? "#4ec0ca" : "#e2e8f0";
  ctx.fillRect(state.paddleX - pw / 2, PADDLE_Y, pw, PADDLE_HEIGHT);
  ctx.fillStyle = "#7fd4ff";
  ctx.fillRect(state.paddleX - pw / 2, PADDLE_Y, pw, 3);
  ctx.fillStyle = state.slow > 0 ? "#c9c0ff" : "#fff";
  for (const ball of state.balls) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`${state.score}`, 8, 22);
  ctx.textAlign = "right";
  ctx.fillText("●".repeat(Math.max(0, state.ballsLeft)), width - 8, 22);
  ctx.textAlign = "center";
  ctx.font = `8px ${FONT}`;
  if (state.level > 1) ctx.fillText(`LEVEL ${state.level}`, width / 2, 22);
  if (state.caught) {
    ctx.fillStyle = POWER_COLOUR[state.caught.power];
    ctx.fillText(POWER_NAME[state.caught.power], width / 2, height / 2 + 30);
    ctx.fillStyle = "#fff";
  }
  if (state.stuck && !state.over)
    ctx.fillText("SPACE OR TAP TO LAUNCH", width / 2, height / 2 + 60);
  if (state.over) ctx.fillText("GAME OVER", width / 2, height / 2 - 40);
}

export const breakout: ArcadeGame<BreakoutState> = {
  id: "breakout",
  title: "Breakout",
  blurb: "Clear the wall. Catch the capsules.",
  keys: "← → or A/D move · Space launches",
  touch: "Drag to move · tap to launch",
  create: createBreakout,
  step: stepBreakout,
  draw: drawBreakout,
  score: (s) => s.score,
  over: (s) => s.over,
};
