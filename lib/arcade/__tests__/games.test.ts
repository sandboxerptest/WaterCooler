import { describe, expect, it } from "vitest";
import { NO_INPUT, SCREEN, type ArcadeInput } from "../types";
import { BIRD_R, BIRD_X, GAP, GROUND_Y, PIPE_WIDTH, createFlappy, stepFlappy } from "../flappy";
import { COLS, advance, createSnake, stepSnake, turn } from "../snake";
import {
  BALLS,
  PADDLE_WIDTH,
  PADDLE_Y,
  WIDE_PADDLE_WIDTH,
  applyPower,
  createBreakout,
  paddleWidth,
  stepBreakout,
} from "../breakout";
import { ARCADE_GAMES, arcadeGame, isArcadeGameId } from "../index";

const press: ArcadeInput = { ...NO_INPUT, actionPressed: true, action: true };
const fixed = () => 0.5;

describe("the cabinet", () => {
  it("holds five games, each answering to its id", () => {
    expect(ARCADE_GAMES.map((g) => g.id)).toEqual([
      "oak-island",
      "flappy",
      "snake",
      "breakout",
      "solitaire",
    ]);
    expect(arcadeGame("snake")?.title).toBe("Snake");
    expect(arcadeGame("pong")).toBeNull();
    expect(isArcadeGameId("breakout")).toBe(true);
    expect(isArcadeGameId("chess")).toBe(false);
  });
});

describe("flappy", () => {
  it("hovers until the first flap, then falls and can flap up", () => {
    const s = createFlappy(fixed);
    stepFlappy(s, NO_INPUT, 0.5);
    expect(s.started).toBe(false);
    stepFlappy(s, press, 1 / 60);
    expect(s.started).toBe(true);
    expect(s.vy).toBeLessThan(0);
    for (let i = 0; i < 30; i++) stepFlappy(s, NO_INPUT, 1 / 60);
    expect(s.vy).toBeGreaterThan(0);
  });

  it("scores a point per pipe passed and ends on the ground", () => {
    const s = createFlappy(fixed);
    stepFlappy(s, press, 1 / 60);
    // Park the bird in the gap and march a pipe past it.
    s.pipes = [{ x: BIRD_X + 5, gapY: 100, passed: false }];
    s.y = 100 + GAP / 2;
    s.vy = 0;
    for (let i = 0; i < 60 && !s.over; i++) {
      s.y = 100 + GAP / 2;
      s.vy = 0;
      stepFlappy(s, NO_INPUT, 1 / 60);
    }
    expect(s.score).toBe(1);
    expect(s.over).toBe(false);
    // Falling to the ground is the end.
    s.pipes = [];
    for (let i = 0; i < 200 && !s.over; i++) stepFlappy(s, NO_INPUT, 1 / 60);
    expect(s.over).toBe(true);
    expect(s.y).toBe(GROUND_Y - BIRD_R);
  });

  it("ends on a pipe", () => {
    const s = createFlappy(fixed);
    stepFlappy(s, press, 1 / 60);
    s.pipes = [{ x: BIRD_X - PIPE_WIDTH / 2, gapY: 300, passed: false }];
    s.y = 50;
    stepFlappy(s, NO_INPUT, 1 / 60);
    expect(s.over).toBe(true);
  });
});

describe("snake", () => {
  it("moves on its clock, eats, grows and speeds up", () => {
    const s = createSnake(fixed);
    expect(s.body).toHaveLength(3);
    stepSnake(s, { ...NO_INPUT, right: true }, 0.2);
    expect(s.started).toBe(true);
    expect(s.body[0].x).toBeGreaterThan(8);
    // Put the apple right in front and step once.
    s.apple = { x: s.body[0].x + 1, y: s.body[0].y };
    const before = s.interval;
    advance(s);
    expect(s.score).toBe(1);
    expect(s.body).toHaveLength(4);
    expect(s.interval).toBeLessThan(before);
  });

  it("will not double back, and dies on walls and itself", () => {
    const s = createSnake(fixed);
    turn(s, "left");
    expect(s.nextDir).toBe("right");
    turn(s, "up");
    expect(s.nextDir).toBe("up");
    const wall = createSnake(fixed);
    wall.body = [
      { x: COLS - 1, y: 5 },
      { x: COLS - 2, y: 5 },
    ];
    advance(wall);
    expect(wall.over).toBe(true);
    const bite = createSnake(fixed);
    bite.body = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
      { x: 6, y: 4 },
    ];
    bite.dir = "right";
    bite.nextDir = "right";
    advance(bite);
    expect(bite.over).toBe(true);
  });

  it("turns relative to its heading on a tap", () => {
    const s = createSnake(fixed);
    stepSnake(s, { ...NO_INPUT, tap: { x: 10, y: 100 } }, 0);
    expect(s.nextDir).toBe("up");
    const t = createSnake(fixed);
    stepSnake(t, { ...NO_INPUT, tap: { x: SCREEN.width - 10, y: 100 } }, 0);
    expect(t.nextDir).toBe("down");
  });
});

describe("breakout", () => {
  // Never drops a capsule, so the wall tests stay about the wall.
  const dry = () => 0.99;

  it("launches on a press, breaks bricks for points, and ends after three balls", () => {
    const s = createBreakout(dry);
    expect(s.stuck).toBe(true);
    stepBreakout(s, press, 1 / 60);
    expect(s.stuck).toBe(false);
    expect(s.balls[0].vy).toBeLessThan(0);
    // Aim straight at a live brick.
    const brick = s.bricks.find((b) => b.alive)!;
    s.balls = [{ x: brick.x + 10, y: brick.y + 30, vx: 0, vy: -300 }];
    stepBreakout(s, NO_INPUT, 0.05);
    expect(brick.alive).toBe(false);
    expect(s.score).toBeGreaterThan(0);
    expect(s.balls[0].vy).toBeGreaterThan(0);
    // Lose every ball.
    for (let lost = 0; lost < BALLS; lost++) {
      s.stuck = false;
      s.balls = [{ x: 100, y: PADDLE_Y + 100, vx: 0, vy: 400 }];
      stepBreakout(s, NO_INPUT, 1);
    }
    expect(s.ballsLeft).toBe(0);
    expect(s.over).toBe(true);
  });

  it("follows a finger and keeps the paddle on screen", () => {
    const s = createBreakout(dry);
    stepBreakout(s, { ...NO_INPUT, pointerX: -50 }, 1 / 60);
    expect(s.paddleX).toBe(32);
    stepBreakout(s, { ...NO_INPUT, pointerX: 900 }, 1 / 60);
    expect(s.paddleX).toBe(SCREEN.width - 32);
  });

  it("drops a capsule from a brick when the dice say so, and the paddle catches it", () => {
    // First roll drops (under the chance), second picks the first power: wide.
    const rolls = [0.01, 0];
    const s = createBreakout(() => rolls.shift() ?? 0.99);
    const brick = s.bricks.find((b) => b.alive)!;
    s.stuck = false;
    s.balls = [{ x: brick.x + 10, y: brick.y + 30, vx: 0, vy: -300 }];
    stepBreakout(s, NO_INPUT, 0.05);
    expect(s.drops).toHaveLength(1);
    expect(s.drops[0].power).toBe("wide");
    // Put the paddle under it and let it fall.
    s.paddleX = s.drops[0].x;
    s.balls = [{ x: 10, y: 200, vx: 0, vy: 0 }];
    for (let i = 0; i < 300 && s.drops.length; i++) stepBreakout(s, NO_INPUT, 1 / 60);
    expect(s.drops).toHaveLength(0);
    expect(paddleWidth(s)).toBe(WIDE_PADDLE_WIDTH);
    expect(s.wide).toBeGreaterThan(0);
  });

  it("gives each power its effect", () => {
    const s = createBreakout(dry);
    stepBreakout(s, press, 1 / 60);
    applyPower(s, "multi");
    expect(s.balls).toHaveLength(3);
    applyPower(s, "life");
    expect(s.ballsLeft).toBe(BALLS + 1);
    const before = Math.hypot(s.balls[0].vx, s.balls[0].vy);
    applyPower(s, "slow");
    expect(Math.hypot(s.balls[0].vx, s.balls[0].vy)).toBeLessThan(before);
    expect(paddleWidth(s)).toBe(PADDLE_WIDTH);
    applyPower(s, "wide");
    expect(paddleWidth(s)).toBe(WIDE_PADDLE_WIDTH);
  });

  it("only loses a life once every ball is gone", () => {
    const s = createBreakout(dry);
    stepBreakout(s, press, 1 / 60);
    applyPower(s, "multi");
    s.balls[0] = { x: 100, y: PADDLE_Y + 100, vx: 0, vy: 400 };
    stepBreakout(s, NO_INPUT, 0.5);
    expect(s.balls).toHaveLength(2);
    expect(s.ballsLeft).toBe(BALLS);
  });
});
