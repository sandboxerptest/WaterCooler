/**
 * Ping pong, over the water bucket by the cauldron.
 *
 * Kept as pure functions over plain state for the same reason as the pinball
 * table: a game of two paddles and a ball is easy to reason about and easy to
 * get subtly wrong, and both are far easier to check without a canvas.
 *
 * The same module runs three ways — against the computer, as the host of a
 * match, and as the guest watching the host's version of events — so nothing
 * in here knows about any of that. It takes two paddle intents and a step of
 * time, whoever is deciding them.
 */

export const TABLE_WIDTH = 480;
export const TABLE_HEIGHT = 300;

export const PADDLE_HEIGHT = 62;
export const PADDLE_WIDTH = 9;
export const PADDLE_INSET = 22;
export const PADDLE_SPEED = 330;

export const BALL_RADIUS = 6;
export const SERVE_SPEED = 260;
/** Every return speeds the ball up, up to this. */
export const MAX_BALL_SPEED = 560;
export const SPEED_UP = 1.045;

/** Table tennis to eleven, and you have to win by two. */
export const WINNING_SCORE = 11;
export const WIN_BY = 2;

/** How long the ball waits at the middle before it is served. */
export const SERVE_PAUSE = 0.9;

export type Side = "left" | "right";

export interface PongState {
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: Record<Side, number>;
  score: Record<Side, number>;
  /** Counts down before a serve; the ball sits still while it does. */
  servePause: number;
  /** Which side receives the next serve. */
  serveTo: Side;
  /** Who served first, which is what the alternation is measured from. */
  firstServer: Side;
  winner: Side | null;
  /** Bumped whenever a point is scored, so the UI can react without polling. */
  rallyHits: number;
}

/** What each player is asking their paddle to do this frame. */
export interface PongInput {
  left: -1 | 0 | 1;
  right: -1 | 0 | 1;
}

export function createPong(serveTo: Side = "right"): PongState {
  return {
    ball: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, vx: 0, vy: 0 },
    paddles: { left: TABLE_HEIGHT / 2, right: TABLE_HEIGHT / 2 },
    score: { left: 0, right: 0 },
    servePause: SERVE_PAUSE,
    serveTo,
    firstServer: serveTo === "right" ? "left" : "right",
    winner: null,
    rallyHits: 0,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where a paddle's face sits, in x. */
export function paddleX(side: Side): number {
  return side === "left" ? PADDLE_INSET : TABLE_WIDTH - PADDLE_INSET;
}

function serve(state: PongState) {
  const towardRight = state.serveTo === "right";
  // Never dead flat: a serve straight down the middle is a dull rally
  const angle = (Math.sin(state.rallyHits * 12.9898) * 0.5 + 0.15) * (state.rallyHits % 2 ? 1 : -1);
  state.ball = {
    x: TABLE_WIDTH / 2,
    y: TABLE_HEIGHT / 2,
    vx: towardRight ? SERVE_SPEED : -SERVE_SPEED,
    vy: SERVE_SPEED * angle,
  };
}

/**
 * Bounce off a paddle, taking the angle from where it was hit.
 *
 * Middle of the bat sends it back flat, the edges send it away at an angle —
 * which is what makes placement worth anything.
 */
function bounceOffPaddle(state: PongState, side: Side) {
  const paddle = state.paddles[side];
  const offset = clamp((state.ball.y - paddle) / (PADDLE_HEIGHT / 2), -1, 1);
  const speed = Math.min(Math.hypot(state.ball.vx, state.ball.vy) * SPEED_UP, MAX_BALL_SPEED);
  const angle = offset * 0.9;

  state.ball.vx = (side === "left" ? 1 : -1) * speed * Math.cos(angle);
  state.ball.vy = speed * Math.sin(angle);
  state.ball.x =
    paddleX(side) + (side === "left" ? 1 : -1) * (PADDLE_WIDTH / 2 + BALL_RADIUS + 0.5);
  state.rallyHits += 1;
}

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/**
 * Who serves next.
 *
 * Every two points, as in the real game — and every point once it is close.
 * Serving to whoever just conceded, which is the obvious thing to write, is
 * quietly brutal: receiving is the harder job, so the player who is behind
 * keeps getting it and the game runs away. Two evenly matched opponents were
 * finishing 11-0 on that rule alone.
 */
function nextServer(state: PongState): Side {
  const played = state.score.left + state.score.right;
  const deuce = state.score.left >= WINNING_SCORE - 1 && state.score.right >= WINNING_SCORE - 1;
  const turns = deuce ? played : Math.floor(played / 2);
  return turns % 2 === 0 ? state.firstServer : other(state.firstServer);
}

function pointTo(state: PongState, side: Side) {
  state.score[side] += 1;
  state.serveTo = other(nextServer(state));
  state.servePause = SERVE_PAUSE;
  state.ball = { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, vx: 0, vy: 0 };

  const mine = state.score[side];
  const theirs = state.score[side === "left" ? "right" : "left"];
  if (mine >= WINNING_SCORE && mine - theirs >= WIN_BY) state.winner = side;
}

/** One fixed step of the game. */
export function stepPong(state: PongState, input: PongInput, dt: number): void {
  if (state.winner) return;

  for (const side of ["left", "right"] as const) {
    const direction = input[side];
    if (direction !== 0) {
      state.paddles[side] = clamp(
        state.paddles[side] + direction * PADDLE_SPEED * dt,
        PADDLE_HEIGHT / 2,
        TABLE_HEIGHT - PADDLE_HEIGHT / 2,
      );
    }
  }

  if (state.servePause > 0) {
    state.servePause -= dt;
    if (state.servePause <= 0) serve(state);
    return;
  }

  const ball = state.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Top and bottom rails
  if (ball.y < BALL_RADIUS && ball.vy < 0) {
    ball.y = BALL_RADIUS;
    ball.vy = -ball.vy;
  } else if (ball.y > TABLE_HEIGHT - BALL_RADIUS && ball.vy > 0) {
    ball.y = TABLE_HEIGHT - BALL_RADIUS;
    ball.vy = -ball.vy;
  }

  // Bats. Checked as "has it reached the face while moving toward it", so a
  // ball that is already past cannot be caught from behind.
  const leftFace = paddleX("left") + PADDLE_WIDTH / 2 + BALL_RADIUS;
  if (ball.vx < 0 && ball.x <= leftFace && ball.x > PADDLE_INSET - PADDLE_WIDTH) {
    if (Math.abs(ball.y - state.paddles.left) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
      bounceOffPaddle(state, "left");
    }
  }

  const rightFace = paddleX("right") - PADDLE_WIDTH / 2 - BALL_RADIUS;
  if (ball.vx > 0 && ball.x >= rightFace && ball.x < TABLE_WIDTH - PADDLE_INSET + PADDLE_WIDTH) {
    if (Math.abs(ball.y - state.paddles.right) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
      bounceOffPaddle(state, "right");
    }
  }

  if (ball.x < -BALL_RADIUS * 2) pointTo(state, "right");
  else if (ball.x > TABLE_WIDTH + BALL_RADIUS * 2) pointTo(state, "left");
}

/** Match point, for the scoreboard to make something of. */
export function isMatchPoint(state: PongState): Side | null {
  for (const side of ["left", "right"] as const) {
    const mine = state.score[side];
    const theirs = state.score[side === "left" ? "right" : "left"];
    if (mine >= WINNING_SCORE - 1 && mine - theirs >= WIN_BY - 1) return side;
  }
  return null;
}
