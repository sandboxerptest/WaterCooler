/**
 * The computer's paddle.
 *
 * A machine that simply sets its paddle to the ball's y every frame is
 * unbeatable and no fun. This one has a top speed, only starts moving once
 * the ball is coming its way, and aims at a point slightly off the middle of
 * the bat — so it returns most things, misses the ones angled into a corner,
 * and can be beaten by placement rather than by luck.
 */

import { PADDLE_HEIGHT, PADDLE_SPEED, TABLE_WIDTH, type PongState, type Side } from "./game";

export type Difficulty = "easy" | "steady" | "sharp";

interface Skill {
  /** Fraction of a paddle's full speed the machine can manage. */
  speed: number;
  /** How far off the bat's middle it aims, as a fraction of the bat. */
  sloppiness: number;
  /**
   * How far the ball must have crossed the table before it stirs. Higher is
   * *worse*: a beginner waits until the ball is nearly on them and then has
   * to scramble, while a good player is already moving.
   */
  waitsUntil: number;
}

const SKILL: Record<Difficulty, Skill> = {
  // Sloppiness is measured against the bat: at 1.2 the aim point wanders
  // further than the bat is deep, so the miss is real rather than cosmetic.
  // Below about 0.8 nobody ever misses and the rally never ends.
  easy: { speed: 0.5, sloppiness: 1.7, waitsUntil: 0.7 },
  steady: { speed: 0.74, sloppiness: 1.15, waitsUntil: 0.45 },
  sharp: { speed: 0.94, sloppiness: 0.85, waitsUntil: 0.22 },
};

/**
 * Which way the machine moves its paddle this frame: -1, 0 or 1, the same
 * thing a person's keys produce, so the game itself cannot tell them apart.
 */
export function opponentMove(
  state: PongState,
  side: Side,
  difficulty: Difficulty = "steady",
  dt = 1 / 60,
): -1 | 0 | 1 {
  const skill = SKILL[difficulty];
  const ball = state.ball;
  const towardMe = side === "right" ? ball.vx > 0 : ball.vx < 0;

  // Idle back toward the middle when the ball is going the other way, which
  // is what a person does and also stops it camping at one end
  if (!towardMe || state.servePause > 0) {
    const home = state.paddles[side] - 150;
    return Math.abs(home) < 8 ? 0 : home > 0 ? -1 : 1;
  }

  const crossed = side === "right" ? ball.x / TABLE_WIDTH : 1 - ball.x / TABLE_WIDTH;
  if (crossed < skill.waitsUntil) return 0;

  // Aim off-centre by a fixed amount per rally, so it is wrong in a
  // consistent way rather than jittering about the right answer.
  //
  // The phase is offset per side because hits alternate: without it each
  // player only ever samples every other term of the same sequence, and one
  // of the two ends up with all the bad ones — two identical opponents were
  // finishing 11-1.
  const phase = state.rallyHits * 2.399 + (side === "left" ? 0 : 1.234);
  const wobble = Math.sin(phase) * skill.sloppiness * (PADDLE_HEIGHT / 2);
  const target = ball.y + wobble;
  const gap = target - state.paddles[side];
  const reach = PADDLE_SPEED * skill.speed * dt;

  if (Math.abs(gap) <= reach) return 0;
  return gap > 0 ? 1 : -1;
}
