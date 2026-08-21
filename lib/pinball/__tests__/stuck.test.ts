import { describe, it, expect } from "vitest";
import { createGame, stepGame } from "../game";
import { TABLE_HEIGHT, TABLE_WIDTH } from "../table";

/**
 * A pinball table has one unforgivable bug: a ball that stops somewhere it can
 * never leave. The game is over and there is no way to end it — the player has
 * to close the window, which is exactly how this one was reported.
 *
 * These tests drop a ball all over the table, hold a flipper up long enough to
 * cradle it, then let go, and insist that every ball eventually comes back.
 */

const STEP = 1 / 240;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hold: "left" | "right" | "none";
}

/** Play out one drop. Returns where the ball ended and whether it got free. */
function drop({ x, y, vx, vy, hold }: Drop, seconds = 30, holdFor = 3) {
  const state = createGame();
  state.status = "playing";
  state.ball.p = { x, y };
  state.ball.v = { x: vx, y: vy };
  const startingBalls = state.ballsLeft;

  for (let i = 0; i < seconds / STEP; i++) {
    const held = i * STEP < holdFor;
    stepGame(
      state,
      { left: held && hold === "left", right: held && hold === "right", launch: false },
      STEP,
      i * STEP,
    );
    // Losing a ball is the ball coming back: it drained, so it was never stuck
    if (state.ballsLeft < startingBalls) {
      return { freed: true, seconds: i * STEP, at: { ...state.ball.p } };
    }
  }
  return { freed: false, seconds, at: { ...state.ball.p } };
}

describe("cradling the ball", () => {
  it("rests it on the flipper rather than wedging it against the wall", () => {
    // The reported bug: the ball wound up in the gap between the funnel wall
    // and the flipper's pivot — a pocket narrower than the ball itself, with
    // each surface pushing it back into the other. The pivot never moves, so
    // dropping the flipper did not help and the ball stayed there for good.
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: 62, y: 400 };
    state.ball.v = { x: -40, y: 120 };

    for (let i = 0; i < 2.5 / STEP; i++) {
      stepGame(state, { left: true, right: false, launch: false }, STEP, i * STEP);
    }

    const cradled = { ...state.ball.p };
    // Resting on the flipper's face, not buried in the corner behind it
    expect(cradled.y).toBeLessThan(470);

    for (let i = 0; i < 2.5 / STEP; i++) {
      stepGame(state, { left: false, right: false, launch: false }, STEP, i * STEP);
    }

    expect(Math.hypot(state.ball.p.x - cradled.x, state.ball.p.y - cradled.y)).toBeGreaterThan(20);
  });

  it("lets go of the ball on both sides", () => {
    for (const hold of ["left", "right"] as const) {
      const side = hold === "left" ? 70 : 220;
      expect(drop({ x: side, y: 400, vx: 0, vy: 140, hold }).freed).toBe(true);
    }
  });

  it("holds the ball for as long as the button is held", () => {
    // Cradling is a technique, not a fault: while the flipper is up the ball
    // should stay put, and the table should not shove it off
    const held = drop({ x: 70, y: 400, vx: 0, vy: 140, hold: "left" }, 12, 12);
    expect(held.freed).toBe(false);
  });
});

describe("nowhere on the table keeps the ball", () => {
  it("gives every ball back, wherever it is dropped", () => {
    const stuck: string[] = [];

    for (let x = 20; x <= 300; x += 20) {
      for (let y = 40; y <= 500; y += 40) {
        for (const [vx, vy] of [
          [0, 0],
          [-160, 60],
          [0, -300],
        ]) {
          for (const hold of ["none", "left", "right"] as const) {
            const result = drop({ x, y, vx, vy, hold });
            if (!result.freed) {
              stuck.push(
                `(${x},${y}) v=(${vx},${vy}) hold=${hold} → (${result.at.x.toFixed(0)},${result.at.y.toFixed(0)})`,
              );
            }
          }
        }
      }
    }

    expect(stuck).toEqual([]);
  });

  it("does not let a ball bounce on a bumper for ever", () => {
    // Dropped dead centre onto a bumper, a perfectly square bounce would
    // return it to exactly where it fell from, with the kick added each time
    expect(drop({ x: 196, y: 40, vx: 0, vy: 0, hold: "none" }).freed).toBe(true);
  });

  it("keeps the ball on the table while it is doing all that", () => {
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: 150, y: 100 };
    state.ball.v = { x: 300, y: 200 };

    for (let i = 0; i < 20 / STEP; i++) {
      stepGame(state, { left: i % 90 < 30, right: i % 120 < 30, launch: false }, STEP, i * STEP);
      const { p, r } = state.ball;
      expect(p.x).toBeGreaterThan(-r);
      expect(p.x).toBeLessThan(TABLE_WIDTH + r);
      expect(p.y).toBeGreaterThan(-r);
      expect(p.y).toBeLessThan(TABLE_HEIGHT + 2 * r);
    }
  });
});
