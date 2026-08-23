/**
 * The game itself: a ball, three lives, and a score.
 *
 * Everything the table does lives here rather than in the React component, so
 * a game can be played out in a test with no canvas and no browser — which is
 * the only way to answer the questions that matter about a pinball table: does
 * the ball ever escape through a wall, and can the flippers actually save it?
 */

import {
  bumperContact,
  clampSpeed,
  dot,
  flipperContact,
  integrate,
  resolveContacts,
  segmentContact,
  swingFlipper,
  type Ball,
  type Contact,
  type Flipper,
} from "./physics";
import {
  BALLS_PER_GAME,
  BANK_BONUS,
  DROP_TARGETS,
  LANE_GATE,
  MAX_MULTIPLIER,
  TARGET_COUNT,
  TARGET_FACE_MIN,
  TARGET_FRONT,
  TARGET_POINTS,
  TARGET_RESTITUTION,
  TARGET_THICKNESS,
  BALL_RADIUS,
  BUMPERS,
  DRAIN_Y,
  FLIPPER_RESTITUTION,
  FLIPPER_SPEED,
  GRAVITY,
  LAUNCH_CHARGE_TIME,
  LAUNCH_MAX,
  LAUNCH_MIN,
  LAUNCH_POSITION,
  MAX_BALL_SPEED,
  TABLE_WIDTH,
  WALLS,
  WALL_RESTITUTION,
  createFlippers,
} from "./table";

export type GameStatus = "ready" | "playing" | "over";

/**
 * How long a ball may sit still before the table shoves it.
 *
 * Real machines have a ball search for the same reason: however carefully the
 * table is laid out, a ball that has found somewhere to die takes the game
 * with it, and no amount of button-pressing gets it back.
 */
/** How much pace a target takes out of the ball as it folds away. */
const TARGET_ABSORB = 0.86;

const STUCK_SECONDS = 2.5;
const STUCK_DISTANCE = 2;
const NUDGE_SPEED = 260;

export interface PinballState {
  ball: Ball;
  flippers: { left: Flipper; right: Flipper };
  status: GameStatus;
  score: number;
  ballsLeft: number;
  /** How far the plunger is drawn back, 0 to 1. */
  charge: number;
  /** Set for a moment after a hit, so the canvas can flash the thing that was hit. */
  lastHit: { x: number; y: number; points: number; at: number } | null;
  /** Where the ball was when it last did anything, and how long ago that was. */
  settled: { x: number; y: number; seconds: number };
  /** Which drop targets are still standing. */
  standing: boolean[];
  /** What every point is worth, earned by clearing the bank. */
  multiplier: number;
  /** When the bank was last cleared, so the canvas can make something of it. */
  bankClearedAt: number | null;
}

export interface PinballInput {
  left: boolean;
  right: boolean;
  /** The plunger: held to charge, released to fire. */
  launch: boolean;
}

export function createGame(): PinballState {
  return {
    ball: { p: { ...LAUNCH_POSITION }, v: { x: 0, y: 0 }, r: BALL_RADIUS },
    flippers: createFlippers(),
    status: "ready",
    score: 0,
    ballsLeft: BALLS_PER_GAME,
    charge: 0,
    lastHit: null,
    settled: { ...LAUNCH_POSITION, seconds: 0 },
    standing: Array.from({ length: TARGET_COUNT }, () => true),
    multiplier: 1,
    bankClearedAt: null,
  };
}

/**
 * Shove a ball that has stopped going anywhere.
 *
 * Nudged toward the middle of the table and upward, which is away from every
 * corner a ball can find, and gentle enough that it reads as the table being
 * knocked rather than the ball teleporting.
 */
function unstick(state: PinballState, dt: number, onFlipper: boolean): void {
  const { ball, settled } = state;

  // A ball held still on a raised flipper is a cradle, not a stuck ball —
  // it is the player doing it, and dropping the flipper always releases it
  if (onFlipper) {
    state.settled = { x: ball.p.x, y: ball.p.y, seconds: 0 };
    return;
  }

  if (Math.hypot(ball.p.x - settled.x, ball.p.y - settled.y) > STUCK_DISTANCE) {
    state.settled = { x: ball.p.x, y: ball.p.y, seconds: 0 };
    return;
  }

  settled.seconds += dt;
  if (settled.seconds < STUCK_SECONDS) return;

  ball.v.x += ball.p.x < TABLE_WIDTH / 2 ? NUDGE_SPEED : -NUDGE_SPEED;
  ball.v.y -= NUDGE_SPEED;
  state.settled = { x: ball.p.x, y: ball.p.y, seconds: 0 };
}

/** Put the next ball in the lane, or end the game if that was the last one. */
export function serveNextBall(state: PinballState): void {
  state.ballsLeft -= 1;
  if (state.ballsLeft <= 0) {
    state.status = "over";
    return;
  }
  state.ball.p = { ...LAUNCH_POSITION };
  state.ball.v = { x: 0, y: 0 };
  state.charge = 0;
  state.status = "ready";
  state.settled = { ...LAUNCH_POSITION, seconds: 0 };
}

/**
 * Reset the bank and raise the multiplier when the last target goes down.
 *
 * The targets pop straight back up rather than staying down for the rest of
 * the ball, so the bank can be cleared again — which is the only way the
 * multiplier climbs.
 */
function clearBank(state: PinballState, now: number): void {
  if (state.standing.some(Boolean)) return;

  state.multiplier = Math.min(MAX_MULTIPLIER, state.multiplier + 1);
  state.score += BANK_BONUS * state.multiplier;
  state.standing = state.standing.map(() => true);
  state.bankClearedAt = now;
}

/**
 * Advance the table by one fixed step.
 *
 * Fixed rather than frame-length on purpose: a ball travelling 900px/s crosses
 * its own diameter in 15ms, so a long frame would step it straight through a
 * wall. The caller runs this as many times as the frame was worth.
 */
export function stepGame(state: PinballState, input: PinballInput, dt: number, now: number): void {
  const { ball, flippers } = state;

  const leftOmega = swingFlipper(flippers.left, input.left, dt, FLIPPER_SPEED);
  const rightOmega = swingFlipper(flippers.right, input.right, dt, FLIPPER_SPEED);

  if (state.status === "ready") {
    // Waiting in the lane: the plunger charges while held and fires on release
    if (input.launch) {
      state.charge = Math.min(1, state.charge + dt / LAUNCH_CHARGE_TIME);
    } else if (state.charge > 0) {
      ball.v.y = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * state.charge);
      state.charge = 0;
      state.status = "playing";
    }
    return;
  }

  if (state.status !== "playing") return;

  integrate(ball, dt, GRAVITY);

  // Everything the ball is touching is collected before any of it is acted
  // on, so two surfaces meeting in a corner cannot each undo the other
  const contacts: Contact[] = [];

  for (const segment of WALLS) {
    const contact = segmentContact(ball, segment, 0, WALL_RESTITUTION);
    if (contact) contacts.push(contact);
  }

  for (const bumper of BUMPERS) {
    const contact = bumperContact(ball, bumper);
    if (contact) {
      contacts.push(contact);
      state.lastHit = { x: bumper.c.x, y: bumper.c.y, points: bumper.points, at: now };
    }
  }

  // The lane's one-way gate. Only there when the ball is on its way down, so
  // a plunged ball rides up through it and nothing falls back in behind it.
  if (ball.v.y > 0) {
    const gate = segmentContact(ball, LANE_GATE, 0, WALL_RESTITUTION);
    if (gate) contacts.push(gate);
  }

  let targetPoints = 0;

  DROP_TARGETS.forEach((target, index) => {
    if (!state.standing[index]) return;
    const contact = segmentContact(ball, target, TARGET_THICKNESS, TARGET_RESTITUTION);
    if (!contact) return;

    // Only a hit in the face folds a target away: the ball has to be on the
    // front of it and driving into it. Dropping onto the top of the bank, or
    // clipping the end of a target, meets a plate that does not give.
    const onTheFace = dot(contact.normal, TARGET_FRONT) > TARGET_FACE_MIN;
    const drivingIn = dot(ball.v, TARGET_FRONT) < 0;
    if (!onTheFace || !drivingIn) {
      contacts.push(contact);
      return;
    }

    // Down it goes, taking some of the ball's pace with it. No contact is
    // added: the target is out of the way, so the ball carries on through.
    state.standing[index] = false;
    targetPoints += TARGET_POINTS;
    ball.v = { x: ball.v.x * TARGET_ABSORB, y: ball.v.y * TARGET_ABSORB };
    state.lastHit = {
      x: (target.a.x + target.b.x) / 2,
      y: (target.a.y + target.b.y) / 2,
      points: TARGET_POINTS,
      at: now,
    };
  });

  const left = flipperContact(ball, flippers.left, leftOmega, FLIPPER_RESTITUTION);
  if (left) contacts.push(left);
  const right = flipperContact(ball, flippers.right, rightOmega, FLIPPER_RESTITUTION);
  if (right) contacts.push(right);

  // Everything is worth more once the bank has been cleared
  state.score += (resolveContacts(ball, contacts) + targetPoints) * state.multiplier;
  clearBank(state, now);

  clampSpeed(ball, MAX_BALL_SPEED);
  unstick(state, dt, Boolean(left || right));

  if (ball.p.y > DRAIN_Y) serveNextBall(state);
}
