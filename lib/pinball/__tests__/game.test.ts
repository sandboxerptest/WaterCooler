import { describe, it, expect } from "vitest";
import { createGame, serveNextBall, stepGame, type PinballInput, type PinballState } from "../game";
import {
  bounce,
  bumperContact,
  closestPointOnSegment,
  resolveContacts,
  swingFlipper,
} from "../physics";
import { BALLS_PER_GAME, TABLE_HEIGHT, TABLE_WIDTH, createFlippers } from "../table";

const STEP = 1 / 240;
const idle: PinballInput = { left: false, right: false, launch: false };

/** Run the table for a while, returning what happened along the way. */
function play(
  seconds: number,
  input: (t: number, state: PinballState) => PinballInput,
  state = createGame(),
) {
  const steps = Math.round(seconds / STEP);
  let escaped = false;
  for (let i = 0; i < steps; i++) {
    stepGame(state, input(i * STEP, state), STEP, i * STEP);
    const { p, r } = state.ball;
    // Off the sides or through the top is a ball that has left the table
    if (p.x < -r || p.x > TABLE_WIDTH + r || p.y < -r) escaped = true;
    if (state.status === "over") break;
  }
  return { state, escaped };
}

const launchFor = (seconds: number) => (t: number) => ({ ...idle, launch: t < seconds });

/** Plays hands-off: pulls the plunger fully for every ball, never flips. */
const autoPlunge = (_t: number, state: PinballState) => ({
  ...idle,
  launch: state.status === "ready" && state.charge < 1,
});

describe("the plunger", () => {
  it("holds the ball in the lane until it is fired", () => {
    const { state } = play(2, () => idle);
    expect(state.status).toBe("ready");
    expect(state.ball.v.y).toBe(0);
  });

  it("charges while held and fires up the lane on release", () => {
    const { state } = play(0.6, launchFor(0.5));
    expect(state.status).toBe("playing");
    expect(state.ball.v.y).toBeLessThan(0); // up the table
  });

  it("fires harder the longer it is held", () => {
    const soft = play(0.3, launchFor(0.1)).state.ball.v.y;
    const hard = play(1.3, launchFor(1.1)).state.ball.v.y;
    expect(hard).toBeLessThan(soft);
  });
});

describe("the plunger lane", () => {
  it("does not let a ball fall back into it", () => {
    // The way out of the lane must not be a way back in: a ball dropping down
    // the lane has nothing to hit and takes the ball with it
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: 297, y: 120 }; // over the lane, above the gate
    state.ball.v = { x: 0, y: 260 };

    for (let i = 0; i < 1.5 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    // It may well carry on down — but into the playfield, off the tilt of the
    // gate, rather than into the lane where nothing could be done about it
    const inTheLane = state.ball.p.x > 282 && state.ball.p.y > 220;
    expect(inTheLane).toBe(false);
    expect(state.ballsLeft).toBe(BALLS_PER_GAME);
  });

  it("still lets a plunged ball ride up and out", () => {
    const { state } = play(3, launchFor(1.2));
    expect(state.ball.p.x).toBeLessThan(282); // out in the playfield
  });

  it("does not catch a ball on its way up", () => {
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: 297, y: 300 };
    state.ball.v = { x: 0, y: -700 };

    for (let i = 0; i < 0.3 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    expect(state.ball.p.y).toBeLessThan(180); // sailed past the gate
  });
});

describe("the ball stays on the table", () => {
  it("never escapes through a wall, however hard it is hit", () => {
    // A full-power launch is the fastest the ball ever moves, and the walls
    // are the thing a fast ball tunnels through if the step is too coarse
    const { state, escaped } = play(60, autoPlunge);
    expect(escaped).toBe(false);
    expect(state.score).toBeGreaterThan(0); // it found the bumpers on the way
  });

  it("drains and costs a ball when nothing is done to save it", () => {
    const { state } = play(30, autoPlunge);
    expect(state.ballsLeft).toBeLessThan(BALLS_PER_GAME);
  });

  it("ends after three balls", () => {
    const { state } = play(200, autoPlunge);
    expect(state.status).toBe("over");
    expect(state.ballsLeft).toBe(0);
  });
});

describe("the flippers", () => {
  it("swings toward the button and back again when it is let go", () => {
    const { left } = createFlippers();
    const start = left.angle;

    swingFlipper(left, true, 0.05, 20);
    expect(left.angle).toBeLessThan(start); // up the table

    for (let i = 0; i < 100; i++) swingFlipper(left, false, 0.05, 20);
    expect(left.angle).toBeCloseTo(left.restAngle, 5);
  });

  it("sends a falling ball back up the table", () => {
    const state = createGame();
    state.status = "playing";
    // Dropped onto the left flipper, which is on its way up
    state.ball.p = { x: 100, y: 455 };
    state.ball.v = { x: 0, y: 260 };

    for (let i = 0; i < 40; i++) {
      stepGame(state, { left: true, right: false, launch: false }, STEP, i * STEP);
    }

    expect(state.ball.v.y).toBeLessThan(0);
  });

  it("does not fling the ball when it is only resting on a still flipper", () => {
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: 100, y: 450 };
    state.ball.v = { x: 0, y: 40 };

    for (let i = 0; i < 60; i++) stepGame(state, idle, STEP, i * STEP);

    // It settles or rolls off, but it is never launched back up the table
    expect(state.ball.v.y).toBeGreaterThan(-120);
  });
});

describe("scoring", () => {
  it("pays out and kicks the ball away when it hits a bumper", () => {
    const ball = { p: { x: 96, y: 190 }, v: { x: 0, y: -100 }, r: 7 };
    const contact = bumperContact(ball, { c: { x: 96, y: 168 }, r: 17, kick: 150, points: 100 });
    const points = resolveContacts(ball, contact ? [contact] : []);

    expect(points).toBe(100);
    expect(ball.v.y).toBeGreaterThan(100); // sent back the way it came, faster
  });

  it("keeps the score across the balls of one game", () => {
    const state = createGame();
    state.score = 700;
    serveNextBall(state);
    expect(state.score).toBe(700);
    expect(state.status).toBe("ready");
  });
});

describe("the maths under it all", () => {
  it("finds the nearest point on a wall, ends included", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(closestPointOnSegment({ x: 5, y: 5 }, a, b)).toEqual({ x: 5, y: 0 });
    expect(closestPointOnSegment({ x: -5, y: 1 }, a, b)).toEqual(a);
    expect(closestPointOnSegment({ x: 50, y: 1 }, a, b)).toEqual(b);
  });

  it("reflects a bounce and keeps some of the speed", () => {
    const out = bounce({ x: 0, y: 100 }, { x: 0, y: -1 }, 0.5);
    expect(out.y).toBeCloseTo(-50);
  });

  it("leaves a ball alone that is already moving away from the wall", () => {
    // Without this a ball resting against a wall gets sucked into it
    const away = { x: 0, y: -30 };
    expect(bounce(away, { x: 0, y: -1 }, 0.5)).toEqual(away);
  });

  it("hands the ball the flipper's own speed, so a swing adds energy", () => {
    const still = bounce({ x: 0, y: 100 }, { x: 0, y: -1 }, 0.5);
    const swinging = bounce({ x: 0, y: 100 }, { x: 0, y: -1 }, 0.5, { x: 0, y: -200 });
    expect(swinging.y).toBeLessThan(still.y);
  });
});

describe("the table itself", () => {
  it("is the size the canvas draws", () => {
    expect(TABLE_WIDTH).toBe(320);
    expect(TABLE_HEIGHT).toBe(560);
  });
});
