import { describe, it, expect } from "vitest";
import { createGame, stepGame, type PinballState } from "../game";
import { BANK_BONUS, DROP_TARGETS, MAX_MULTIPLIER, TARGET_COUNT, TARGET_POINTS } from "../table";

const STEP = 1 / 240;
const idle = { left: false, right: false, launch: false };

function middleOf(index: number) {
  const target = DROP_TARGETS[index];
  return { x: (target.a.x + target.b.x) / 2, y: (target.a.y + target.b.y) / 2 };
}

/** Drive the ball up the table into a target's face, the way the game does. */
function hitTarget(state: PinballState, index: number) {
  const middle = middleOf(index);
  state.status = "playing";
  state.ball.p = { x: middle.x, y: middle.y + 26 };
  state.ball.v = { x: 0, y: -300 };

  // The fourth target is a special case: knocking it down clears the bank,
  // which stands every target straight back up in the same step
  const clearedBefore = state.bankClearedAt;
  for (let i = 0; i < 0.6 / STEP; i++) {
    stepGame(state, idle, STEP, i * STEP);
    if (!state.standing[index] || state.bankClearedAt !== clearedBefore) return true;
  }
  return false;
}

describe("the drop target bank", () => {
  it("starts with four targets standing", () => {
    const state = createGame();
    expect(state.standing).toHaveLength(TARGET_COUNT);
    expect(state.standing.every(Boolean)).toBe(true);
    expect(DROP_TARGETS).toHaveLength(TARGET_COUNT);
  });

  it("sits across the top of the playfield", () => {
    for (const target of DROP_TARGETS) {
      for (const end of [target.a, target.b]) {
        expect(end.y).toBeGreaterThan(60);
        expect(end.y).toBeLessThan(140);
        expect(end.x).toBeGreaterThan(60);
        expect(end.x).toBeLessThan(230);
      }
    }
  });

  it("is tilted, so nothing can come to rest on it", () => {
    // Gravity points straight down the playfield here, so a level bank would
    // be a shelf: a ball landing dead on it would sit there for good
    for (const target of DROP_TARGETS) {
      expect(Math.abs(target.a.y - target.b.y)).toBeGreaterThan(1);
    }
  });

  it("drops a target that is hit, and pays for it", () => {
    const state = createGame();
    expect(hitTarget(state, 0)).toBe(true);
    expect(state.standing[0]).toBe(false);
    expect(state.score).toBe(TARGET_POINTS);
  });

  it("lets the ball straight through a target that is already down", () => {
    const state = createGame();
    hitTarget(state, 1);
    const scoreAfterFirst = state.score;

    // Same shot again: nothing there to hit now
    const middle = middleOf(1);
    state.ball.p = { x: middle.x, y: middle.y + 24 };
    state.ball.v = { x: 0, y: -300 };
    for (let i = 0; i < 0.12 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    expect(state.score).toBe(scoreAfterFirst);
    expect(state.ball.p.y).toBeLessThan(middle.y);
  });

  it("raises the multiplier and stands the bank back up when the last one falls", () => {
    const state = createGame();
    for (let index = 0; index < TARGET_COUNT; index++) hitTarget(state, index);

    expect(state.multiplier).toBe(2);
    expect(state.standing.every(Boolean)).toBe(true);
    expect(state.bankClearedAt).not.toBeNull();
    expect(state.score).toBe(TARGET_COUNT * TARGET_POINTS + BANK_BONUS * 2);
  });

  it("stands firm when the ball lands on top of it", () => {
    // A drop target is a plate on edge: it folds when it is hit in the face,
    // and from above it is a wall. Falling on the bank should not clear it.
    const state = createGame();
    state.status = "playing";
    const middle = middleOf(2);
    state.ball.p = { x: middle.x, y: middle.y - 26 };
    state.ball.v = { x: 0, y: 300 };

    for (let i = 0; i < 0.5 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    expect(state.standing[2]).toBe(true);
    expect(state.score).toBe(0);
    // And it bounced: the ball is back above the bank, not through it
    expect(state.ball.p.y).toBeLessThan(middle.y);
  });

  it("stands firm when the ball rolls across the top of the bank", () => {
    const state = createGame();
    state.status = "playing";
    state.ball.p = { x: middleOf(0).x - 30, y: middleOf(0).y - 14 };
    state.ball.v = { x: 320, y: 40 };

    for (let i = 0; i < 1 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    expect(state.standing.every(Boolean)).toBe(true);
    expect(state.score).toBe(0);
  });

  it("makes everything else worth more once it is cleared", () => {
    const state = createGame();
    for (let index = 0; index < TARGET_COUNT; index++) hitTarget(state, index);
    const afterClear = state.score;

    // A bumper at double: 100 points becomes 200
    state.ball.p = { x: 96, y: 195 };
    state.ball.v = { x: 0, y: -300 };
    for (let i = 0; i < 0.3 / STEP; i++) stepGame(state, idle, STEP, i * STEP);

    expect(state.score - afterClear).toBeGreaterThanOrEqual(200);
  });

  it("climbs a step per clearance and then stops", () => {
    const state = createGame();
    for (let round = 0; round < MAX_MULTIPLIER + 3; round++) {
      for (let index = 0; index < TARGET_COUNT; index++) hitTarget(state, index);
    }
    expect(state.multiplier).toBe(MAX_MULTIPLIER);
  });

  it("keeps the multiplier for the rest of the game, across balls", () => {
    const state = createGame();
    for (let index = 0; index < TARGET_COUNT; index++) hitTarget(state, index);

    state.ball.p = { x: 150, y: 600 }; // straight down the drain
    stepGame(state, idle, STEP, 0);

    expect(state.ballsLeft).toBe(2);
    expect(state.multiplier).toBe(2);
  });
});
