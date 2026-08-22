/**
 * Walking the player somewhere they tapped.
 *
 * A phone has no arrow keys, so the office needs the other way of moving a
 * character about: point at the floor and they walk there, around the desks
 * rather than into them. The route comes from the same pathfinder the workers
 * use; this steers along it.
 *
 * The arithmetic is in pure functions so the awkward parts — arriving,
 * running out of path, being interrupted — can be checked without a scene.
 */

export interface Point {
  x: number;
  y: number;
}

/** Close enough to a waypoint to move on to the next one. */
export const ARRIVE_RADIUS = 6;

/**
 * How many steps of no real progress mean the walk is going nowhere.
 *
 * A route is planned on a grid and walked by a physics body, and the two do
 * not always agree — squeezing past a desk corner, the body can end up held
 * against a wall while the steering keeps pushing at it. Better to give up
 * than to grind there.
 */
export const STUCK_STEPS = 40;
/** Movement below this in one step does not count as getting anywhere. */
export const STUCK_DISTANCE = 0.35;

/** A tap that wanders further than this was somebody dragging the camera. */
export const TAP_SLOP = 12;
/** And one held longer than this was not a tap either. */
export const TAP_TIME_MS = 400;

/** Straight-line velocity from one point toward another. */
export function steerTo(from: Point, to: Point, speed: number): { vx: number; vy: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { vx: 0, vy: 0 };
  return { vx: (dx / distance) * speed, vy: (dy / distance) * speed };
}

/**
 * How far along the path the walker is now.
 *
 * Skips any waypoints already reached rather than only the next one: a fast
 * frame can cross a whole tile, and stepping one at a time would leave the
 * character doubling back to collect them.
 */
export function advanceAlong(
  path: Point[],
  index: number,
  at: Point,
  radius = ARRIVE_RADIUS,
): number {
  let next = index;
  while (next < path.length && Math.hypot(path[next].x - at.x, path[next].y - at.y) <= radius) {
    next += 1;
  }
  return next;
}

/** Was that a tap, or the beginning of a drag? */
export function isTap(
  down: { x: number; y: number; at: number },
  up: { x: number; y: number; at: number },
  slop = TAP_SLOP,
  time = TAP_TIME_MS,
): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop && up.at - down.at <= time;
}

/**
 * Follows a route, one waypoint at a time.
 *
 * Holds no opinion about who is walking: it is handed a path and a position
 * and gives back a velocity, which is what both the keyboard and the gamepad
 * hand the player too.
 */
export class TapNavigator {
  private path: Point[] = [];
  private index = 0;
  private arrival: (() => void) | null = null;
  private wasAt: Point | null = null;
  private stuckFor = 0;

  get active(): boolean {
    return this.index < this.path.length;
  }

  /** The place being walked to, for a marker on the floor. */
  get destination(): Point | null {
    return this.path.length > 0 ? this.path[this.path.length - 1] : null;
  }

  follow(path: Point[], onArrive?: () => void): void {
    this.path = path;
    this.index = 0;
    this.arrival = onArrive ?? null;
    this.wasAt = null;
    this.stuckFor = 0;
  }

  /**
   * Give up on the route.
   *
   * Anything the player does themselves — a key, a stick — cancels it, and
   * whatever was going to happen on arrival is dropped with it. Walking
   * somewhere else means they changed their mind.
   */
  cancel(): void {
    this.path = [];
    this.index = 0;
    this.arrival = null;
    this.wasAt = null;
    this.stuckFor = 0;
  }

  /** The velocity to walk this frame, or null when there is nowhere to be. */
  step(at: Point, speed: number): { vx: number; vy: number } | null {
    if (!this.active) return null;

    // Walked into something and stopped getting anywhere: let it go, rather
    // than leaning on the wall until the player works out what happened
    if (this.wasAt && Math.hypot(at.x - this.wasAt.x, at.y - this.wasAt.y) < STUCK_DISTANCE) {
      this.stuckFor += 1;
      if (this.stuckFor > STUCK_STEPS) {
        this.cancel();
        return null;
      }
    } else {
      this.stuckFor = 0;
    }
    this.wasAt = { x: at.x, y: at.y };

    this.index = advanceAlong(this.path, this.index, at);
    if (!this.active) {
      const arrived = this.arrival;
      this.arrival = null;
      this.path = [];
      this.index = 0;
      arrived?.();
      return null;
    }

    return steerTo(at, this.path[this.index], speed);
  }
}
