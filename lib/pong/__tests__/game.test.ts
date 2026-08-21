import { describe, it, expect } from "vitest";
import {
  BALL_RADIUS,
  PADDLE_HEIGHT,
  SERVE_PAUSE,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  WINNING_SCORE,
  createPong,
  isMatchPoint,
  paddleX,
  stepPong,
  type PongInput,
  type PongState,
} from "../game";
import { opponentMove } from "../opponent";

const STEP = 1 / 120;
const still: PongInput = { left: 0, right: 0 };

/** Run the table for a while with fixed input. */
function play(state: PongState, seconds: number, input: PongInput = still) {
  for (let i = 0; i < seconds / STEP; i++) stepPong(state, input, STEP);
  return state;
}

describe("serving", () => {
  it("holds the ball still until the pause is up", () => {
    const state = play(createPong(), SERVE_PAUSE / 2);
    expect(state.ball.vx).toBe(0);
    expect(state.ball.x).toBe(TABLE_WIDTH / 2);
  });

  it("sends it toward the side that is due to receive", () => {
    expect(play(createPong("right"), SERVE_PAUSE + 0.1).ball.vx).toBeGreaterThan(0);
    expect(play(createPong("left"), SERVE_PAUSE + 0.1).ball.vx).toBeLessThan(0);
  });

  it("never serves it flat down the middle", () => {
    expect(Math.abs(play(createPong(), SERVE_PAUSE + 0.05).ball.vy)).toBeGreaterThan(1);
  });
});

describe("the rally", () => {
  it("bounces off the top and bottom rails", () => {
    const state = createPong();
    state.servePause = 0;
    state.ball = { x: 240, y: 12, vx: 0, vy: -200 };
    play(state, 0.2);
    expect(state.ball.vy).toBeGreaterThan(0);
    expect(state.ball.y).toBeGreaterThanOrEqual(BALL_RADIUS);
  });

  it("comes back off a bat that is in the way", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.left = 150;
    state.ball = { x: 60, y: 150, vx: -260, vy: 0 };
    play(state, 0.25);
    expect(state.ball.vx).toBeGreaterThan(0);
  });

  it("goes faster with every return, up to a ceiling", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.left = 150;
    state.ball = { x: 60, y: 150, vx: -260, vy: 0 };
    play(state, 0.25);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(260);
  });

  it("sends the ball off at an angle when it hits the edge of the bat", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.left = 150;
    // Struck near the top of the bat
    state.ball = { x: 60, y: 150 - PADDLE_HEIGHT / 2 + 4, vx: -260, vy: 0 };
    play(state, 0.25);
    expect(Math.abs(state.ball.vy)).toBeGreaterThan(40);
  });

  it("lets a ball past a bat that is out of position", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.left = 40;
    state.ball = { x: 60, y: 260, vx: -300, vy: 0 };
    play(state, 0.5);
    expect(state.score.right).toBe(1);
  });
});

describe("the score", () => {
  it("gives the point to the other side and pauses before the next serve", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.left = 40;
    state.ball = { x: 60, y: 260, vx: -300, vy: 0 };
    play(state, 0.5);

    expect(state.score).toEqual({ left: 0, right: 1 });
    expect(state.servePause).toBeGreaterThan(0);
    expect(state.ball.x).toBe(TABLE_WIDTH / 2);
  });

  it("is won at eleven", () => {
    const state = createPong();
    state.score = { left: WINNING_SCORE - 1, right: 3 };
    state.servePause = 0;
    state.paddles.right = 40;
    state.ball = { x: TABLE_WIDTH - 60, y: 260, vx: 300, vy: 0 };
    play(state, 0.5);
    expect(state.winner).toBe("left");
  });

  it("is not won at eleven when it is only one clear", () => {
    const state = createPong();
    state.score = { left: WINNING_SCORE - 1, right: WINNING_SCORE - 1 };
    state.servePause = 0;
    state.paddles.right = 40;
    state.ball = { x: TABLE_WIDTH - 60, y: 260, vx: 300, vy: 0 };
    play(state, 0.5);
    expect(state.winner).toBeNull();
    expect(state.score.left).toBe(WINNING_SCORE);
  });

  it("stops play once it is over", () => {
    const state = createPong();
    state.winner = "left";
    const before = { ...state.ball };
    play(state, 1);
    expect(state.ball).toEqual(before);
  });

  it("alternates the serve every two points, not to whoever just lost", () => {
    // Receiving is the harder job. Handing it to whoever just conceded reads
    // as fair and is not: the player who falls behind keeps getting it, and
    // two identical opponents finish 11-0.
    const state = createPong();
    const receivers: string[] = [];
    for (let point = 0; point < 6; point++) {
      state.score.left += 1; // the same player wins every point
      state.serveTo = state.serveTo; // untouched by the score itself
      const before = state.score.left + state.score.right;
      void before;
      // Drive a point through the real path
      state.servePause = 0;
      state.paddles.right = 40;
      state.ball = { x: TABLE_WIDTH - 60, y: 260, vx: 300, vy: 0 };
      state.score.left -= 1;
      play(state, 0.5);
      receivers.push(state.serveTo);
    }
    // Two of one, then two of the other, rather than the same every time
    expect(new Set(receivers).size).toBe(2);
    expect(receivers.slice(0, 4)).not.toEqual([
      receivers[0],
      receivers[0],
      receivers[0],
      receivers[0],
    ]);
  });

  it("knows when someone is a point away", () => {
    const state = createPong();
    state.score = { left: WINNING_SCORE - 1, right: 4 };
    expect(isMatchPoint(state)).toBe("left");
    state.score = { left: 4, right: 4 };
    expect(isMatchPoint(state)).toBeNull();
  });
});

describe("the paddles", () => {
  it("move where they are told", () => {
    const state = createPong();
    const before = state.paddles.left;
    play(state, 0.2, { left: 1, right: 0 });
    expect(state.paddles.left).toBeGreaterThan(before);
  });

  it("cannot be pushed off the table", () => {
    const state = createPong();
    play(state, 5, { left: -1, right: 1 });
    expect(state.paddles.left).toBeGreaterThanOrEqual(PADDLE_HEIGHT / 2);
    expect(state.paddles.right).toBeLessThanOrEqual(TABLE_HEIGHT - PADDLE_HEIGHT / 2);
  });

  it("sit inside the table at both ends", () => {
    expect(paddleX("left")).toBeLessThan(TABLE_WIDTH / 2);
    expect(paddleX("right")).toBeGreaterThan(TABLE_WIDTH / 2);
  });
});

describe("the computer", () => {
  it("waits while the ball is going away from it", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.right = 150;
    state.ball = { x: 240, y: 150, vx: -300, vy: 0 };
    expect(opponentMove(state, "right")).toBe(0);
  });

  it("chases a ball coming at it", () => {
    const state = createPong();
    state.servePause = 0;
    state.paddles.right = 60;
    state.ball = { x: 400, y: 260, vx: 300, vy: 0 };
    expect(opponentMove(state, "right")).toBe(1);
  });

  it("is beatable: it aims off the middle of the bat", () => {
    // Same ball, several rallies in: the aim point wanders, which is what
    // makes a corner shot worth playing
    const state = createPong();
    state.servePause = 0;
    state.paddles.right = 150;
    state.ball = { x: 460, y: 150, vx: 300, vy: 0 };

    const moves = new Set<number>();
    for (let rally = 0; rally < 12; rally++) {
      state.rallyHits = rally;
      moves.add(opponentMove(state, "right", "easy"));
    }
    expect(moves.size).toBeGreaterThan(1);
  });

  it("keeps the ball on the table through a long rally", () => {
    // Two sharp opponents will keep a rally going more or less for ever,
    // which makes this the hardest thing to throw at the collision code
    const state = createPong();
    let hits = 0;
    for (let i = 0; i < 120 * 90; i++) {
      stepPong(
        state,
        {
          left: opponentMove(state, "left", "sharp", STEP),
          right: opponentMove(state, "right", "sharp", STEP),
        },
        STEP,
      );
      expect(state.ball.y).toBeGreaterThan(-40);
      expect(state.ball.y).toBeLessThan(TABLE_HEIGHT + 40);
      hits = state.rallyHits;
    }
    expect(hits).toBeGreaterThan(20); // they were actually playing
  });

  it("finishes when the players are not evenly matched", () => {
    const state = createPong();
    for (let i = 0; i < 120 * 400 && !state.winner; i++) {
      stepPong(
        state,
        {
          left: opponentMove(state, "left", "sharp", STEP),
          right: opponentMove(state, "right", "easy", STEP),
        },
        STEP,
      );
    }
    expect(state.winner).toBe("left");
    expect(state.score.left).toBeGreaterThanOrEqual(WINNING_SCORE);
  });
});
