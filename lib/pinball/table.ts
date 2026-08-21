/**
 * The table: where every wall, bumper and flipper sits.
 *
 * Coordinates are the table's own, 320 × 560, with y pointing down the
 * playfield the way gravity does. The canvas scales this to whatever room the
 * screen has, so nothing here is in pixels-on-screen.
 */

import type { Bumper, Flipper, Segment, Vec } from "./physics";

export const TABLE_WIDTH = 320;
export const TABLE_HEIGHT = 560;

export const BALL_RADIUS = 7;
export const GRAVITY = 780;
export const WALL_RESTITUTION = 0.42;
export const FLIPPER_RESTITUTION = 0.55;
export const FLIPPER_SPEED = 20;
export const MAX_BALL_SPEED = 1150;

/** How hard the plunger can fire, from a tap to a full pull. */
/**
 * Even the softest plunge has to clear the top of the lane divider, or a weak
 * pull would drop the ball straight back down the lane and cost a life for
 * nothing. From the plunger that is a rise of 305px, hence the floor here.
 */
export const LAUNCH_MIN = 780;
export const LAUNCH_MAX = 1020;
export const LAUNCH_CHARGE_TIME = 1.1;

/** Below this the ball is gone. */
export const DRAIN_Y = TABLE_HEIGHT + BALL_RADIUS;

export const BALLS_PER_GAME = 3;

// ── The drop target bank ───────────────────────────────

export const TARGET_COUNT = 4;
export const TARGET_POINTS = 200;
/** For clearing the whole bank, on top of the multiplier it earns. */
export const BANK_BONUS = 1000;
export const MAX_MULTIPLIER = 5;
export const TARGET_THICKNESS = 4;
export const TARGET_RESTITUTION = 0.3;

/**
 * Four targets across the top of the playfield, on a slight tilt.
 *
 * The tilt is not decoration: this table's gravity points straight down the
 * playfield, so a level shelf is somewhere a ball can come to rest and stay.
 * Sloped, anything that lands on the bank slides off the end of it.
 */
const BANK_TILT = -0.134;
const BANK_ALONG: Vec = { x: Math.cos(BANK_TILT), y: Math.sin(BANK_TILT) };

/**
 * Which way the targets face: down the playfield, toward the flippers.
 *
 * A drop target is a plate standing on edge. Driven into its face it folds
 * away, and from any other side it is simply part of the wall — landing on
 * top of one does nothing, which is what makes the bank worth aiming at.
 */
export const TARGET_FRONT: Vec = { x: -BANK_ALONG.y, y: BANK_ALONG.x };

/** How square a hit has to be to count as hitting the face. */
export const TARGET_FACE_MIN = 0.5;

export const DROP_TARGETS: Segment[] = Array.from({ length: TARGET_COUNT }, (_, index) => {
  const spacing = 28;
  const width = 20;
  const start = { x: 93, y: 104 };
  const from = index * spacing;
  return {
    a: { x: start.x + BANK_ALONG.x * from, y: start.y + BANK_ALONG.y * from },
    b: {
      x: start.x + BANK_ALONG.x * (from + width),
      y: start.y + BANK_ALONG.y * (from + width),
    },
    restitution: TARGET_RESTITUTION,
  };
});

/** Where the ball waits in the lane before the plunger fires. */
export const LAUNCH_POSITION: Vec = { x: 297, y: 505 };

/** The lane is one ball wide, so the divider ends before the arch. */
const LANE_X = 282;

const wall = (ax: number, ay: number, bx: number, by: number, restitution?: number): Segment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  ...(restitution === undefined ? {} : { restitution }),
});

/**
 * The walls, in the order the ball meets them coming out of the lane: up the
 * right side, round the arch at the top, then down the funnel to the flippers.
 */
export const WALLS: Segment[] = [
  // Outer edges
  wall(8, 44, 8, 360),
  wall(8, 44, 60, 10),
  wall(60, 10, 260, 10),
  wall(260, 10, 312, 44),
  wall(312, 44, 312, 540),

  // The plunger lane. The divider stops well short of the arch, so the ball
  // rides over the top of it and the sloped arch turns it into the playfield.
  wall(LANE_X, 200, LANE_X, 540),

  // The funnel down to the flippers.
  //
  // Each side runs into its flipper's pivot rather than stopping short of it:
  // a gap narrower than the ball is a pocket the ball can enter but never
  // leave, and the pivot never moves, so nothing would ever shake it out.
  wall(8, 360, 66, 470),
  wall(66, 470, 66, 540),
  wall(282, 360, 224, 470),
  wall(224, 470, 224, 540),
];

export const BUMPERS: Bumper[] = [
  { c: { x: 96, y: 168 }, r: 17, kick: 150, points: 100 },
  { c: { x: 196, y: 148 }, r: 17, kick: 150, points: 100 },
  // Off centre by a shade, which is the difference between a lane to the drop
  // targets that a good shot can thread and no lane at all. The bank only
  // falls to a ball driven into its face, so something has to be able to get
  // underneath it — but only just.
  { c: { x: 166, y: 246 }, r: 17, kick: 150, points: 100 },
  // Slingshots: smaller, meaner, and they keep the ball off the drain
  { c: { x: 74, y: 424 }, r: 11, kick: 190, points: 50 },
  { c: { x: 216, y: 424 }, r: 11, kick: 190, points: 50 },
];

const DEGREES = Math.PI / 180;

export function createFlippers(): { left: Flipper; right: Flipper } {
  return {
    left: {
      pivot: { x: 66, y: 470 },
      length: 56,
      radius: 6,
      restAngle: 22 * DEGREES,
      activeAngle: -32 * DEGREES,
      angle: 22 * DEGREES,
    },
    right: {
      pivot: { x: 224, y: 470 },
      length: 56,
      radius: 6,
      restAngle: 158 * DEGREES,
      activeAngle: 212 * DEGREES,
      angle: 158 * DEGREES,
    },
  };
}
