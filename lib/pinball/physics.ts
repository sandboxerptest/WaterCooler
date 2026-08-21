/**
 * Pinball physics.
 *
 * Pure functions over plain objects, kept apart from the canvas so the table
 * can be reasoned about — and tested — without a browser. A pinball table is
 * mostly one question asked repeatedly: how does a moving circle bounce off a
 * line? Everything here is that question, plus the flippers, which are lines
 * that swing and hand the ball their own speed on the way past.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Ball {
  p: Vec;
  v: Vec;
  r: number;
}

export interface Segment {
  a: Vec;
  b: Vec;
  /** How bouncy this wall is. 1 would return every joule the ball arrived with. */
  restitution?: number;
}

export interface Bumper {
  c: Vec;
  r: number;
  /** Speed added along the outward normal, which is what makes a bumper fun. */
  kick: number;
  points: number;
}

export interface Flipper {
  pivot: Vec;
  length: number;
  /** Radians, measured from +x. Rest is where it sits with the button up. */
  restAngle: number;
  activeAngle: number;
  angle: number;
  radius: number;
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
/** Exported because the drop targets need to know which way a hit came from. */
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const length = (a: Vec): number => Math.hypot(a.x, a.y);

export function normalise(a: Vec): Vec {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Rotate a vector a quarter turn, which turns a radius into a tangent. */
const perpendicular = (a: Vec): Vec => ({ x: -a.y, y: a.x });

/** Where on the segment the point is nearest to, ends included. */
export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  if (lengthSquared === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSquared));
  return add(a, scale(ab, t));
}

/**
 * Bounce a velocity off a surface.
 *
 * `surface` is how fast the wall itself is moving at the point of contact —
 * zero for everything except a flipper mid-swing, which is the whole reason a
 * flipper can send a ball back up the table faster than it arrived.
 */
export function bounce(
  v: Vec,
  normal: Vec,
  restitution: number,
  surface: Vec = { x: 0, y: 0 },
): Vec {
  const relative = sub(v, surface);
  const along = dot(relative, normal);
  if (along >= 0) return v; // already travelling away; a second hit would suck it in
  return add(sub(relative, scale(normal, along * (1 + restitution))), surface);
}

/** Gravity and a step of time. A whisper of drag, so a rattling ball settles. */
export function integrate(ball: Ball, dt: number, gravity: number, damping = 0.9995): void {
  ball.v.y += gravity * dt;
  ball.v.x *= damping;
  ball.v.y *= damping;
  ball.p.x += ball.v.x * dt;
  ball.p.y += ball.v.y * dt;
}

/**
 * One place the ball is touching something.
 *
 * Contacts are gathered before any of them is acted on, because resolving them
 * one at a time is what wedges a ball in a corner: two surfaces meeting at an
 * angle push in different directions, so each correction undoes the last and
 * the ball sits there shivering between them. Nothing frees it, because in a
 * corner there is nothing else to move it.
 */
export interface Contact {
  /** Unit vector from the surface toward the ball. */
  normal: Vec;
  /** How far the ball has sunk in. */
  penetration: number;
  restitution: number;
  /** How fast the surface is moving here — only a swinging flipper is. */
  surface: Vec;
  /** Extra speed along the normal, for bumpers. */
  kick?: number;
  points?: number;
}

/**
 * Where a ball touches a segment, treating the segment as a capsule of the
 * given thickness. Walls are thin; flippers are chunky, and a ball that rolls
 * down a one-dimensional flipper looks like it is cutting through it.
 */
export function segmentContact(
  ball: Ball,
  segment: Segment,
  thickness: number,
  defaultRestitution: number,
  surface: Vec = { x: 0, y: 0 },
): Contact | null {
  const closest = closestPointOnSegment(ball.p, segment.a, segment.b);
  const away = sub(ball.p, closest);
  const distance = length(away);
  const reach = ball.r + thickness;
  if (distance > reach) return null;

  // Dead centre on the line has no direction to escape along; use the normal
  const normal =
    distance === 0
      ? normalise(perpendicular(sub(segment.b, segment.a)))
      : scale(away, 1 / distance);

  return {
    normal,
    penetration: reach - distance,
    restitution: segment.restitution ?? defaultRestitution,
    surface,
  };
}

/**
 * How far off true a bumper throws the ball, in radians.
 *
 * A ball hitting a bumper dead centre would otherwise be thrown straight back
 * the way it came, and a ball falling straight down onto one bounces between
 * the same two points for ever, gaining the kick each time. No real bumper is
 * mounted that squarely; this one is not either.
 */
const BUMPER_SKEW = 0.12;

/** Bumpers bounce, then shove, and pay out points for it. */
export function bumperContact(ball: Ball, bumper: Bumper): Contact | null {
  const away = sub(ball.p, bumper.c);
  const distance = length(away);
  const reach = ball.r + bumper.r;
  if (distance > reach) return null;

  const straight = distance === 0 ? { x: 0, y: -1 } : scale(away, 1 / distance);
  const side = Math.sign(away.x) || Math.sign(ball.v.x) || 1;
  const skew = BUMPER_SKEW * side;

  return {
    normal: {
      x: straight.x * Math.cos(skew) - straight.y * Math.sin(skew),
      y: straight.x * Math.sin(skew) + straight.y * Math.cos(skew),
    },
    penetration: reach - distance,
    restitution: 0.5,
    surface: { x: 0, y: 0 },
    kick: bumper.kick,
    points: bumper.points,
  };
}

/** The line the flipper currently occupies, from pivot to tip. */
export function flipperSegment(flipper: Flipper): Segment {
  return {
    a: flipper.pivot,
    b: {
      x: flipper.pivot.x + Math.cos(flipper.angle) * flipper.length,
      y: flipper.pivot.y + Math.sin(flipper.angle) * flipper.length,
    },
  };
}

/**
 * Swing the flipper toward where the button says it should be.
 *
 * Returns the angular velocity actually used, because the ball needs it: a
 * flipper that has finished travelling is just a wall, and should not launch
 * anything.
 */
export function swingFlipper(
  flipper: Flipper,
  pressed: boolean,
  dt: number,
  speed: number,
): number {
  const target = pressed ? flipper.activeAngle : flipper.restAngle;
  const remaining = target - flipper.angle;
  if (Math.abs(remaining) < 1e-4) {
    flipper.angle = target;
    return 0;
  }

  const step = Math.sign(remaining) * Math.min(Math.abs(remaining), speed * dt);
  flipper.angle += step;
  return step / dt;
}

/** Where the ball touches a flipper, with the flipper's own motion included. */
export function flipperContact(
  ball: Ball,
  flipper: Flipper,
  omega: number,
  restitution: number,
): Contact | null {
  const segment = flipperSegment(flipper);
  const closest = closestPointOnSegment(ball.p, segment.a, segment.b);
  // v = ω × r, which in two dimensions is ω times the perpendicular
  const surface = scale(perpendicular(sub(closest, flipper.pivot)), omega);
  return segmentContact(ball, segment, flipper.radius, restitution, surface);
}

/**
 * Act on everything the ball is touching, once.
 *
 * The push-out follows the sum of the normals rather than each in turn, so a
 * ball in a corner is lifted out along the direction both surfaces agree on
 * instead of being batted between them.
 */
export function resolveContacts(ball: Ball, contacts: Contact[]): number {
  if (contacts.length === 0) return 0;

  let push: Vec = { x: 0, y: 0 };
  let deepest = 0;
  let restitution = 0;
  let surface: Vec = { x: 0, y: 0 };
  let points = 0;

  for (const contact of contacts) {
    push = add(push, scale(contact.normal, contact.penetration));
    deepest = Math.max(deepest, contact.penetration);
    restitution = Math.max(restitution, contact.restitution);
    // The fastest-moving surface wins: a flipper mid-swing should still throw
    // the ball even while it is also brushing a wall
    if (length(contact.surface) > length(surface)) surface = contact.surface;
    points += contact.points ?? 0;
  }

  const normal = normalise(push);
  if (normal.x === 0 && normal.y === 0) return points; // exactly opposed; leave it

  ball.p = add(ball.p, scale(normal, deepest));
  ball.v = bounce(ball.v, normal, restitution, surface);

  for (const contact of contacts) {
    if (contact.kick) ball.v = add(ball.v, scale(contact.normal, contact.kick));
  }

  return points;
}

/** Stop a ball that has been kicked hard enough to leave the table. */
export function clampSpeed(ball: Ball, max: number): void {
  const speed = length(ball.v);
  if (speed > max) ball.v = scale(ball.v, max / speed);
}
