/**
 * The few steps you take on arriving somewhere.
 *
 * Every transition puts you in a doorway — the door you came out of, the
 * one you came in by, the lift — with the key you were holding still held.
 * Left to the keys, that walks you straight back through. So on arrival the
 * character takes a few steps away on its own, ignoring input, and then —
 * until every movement key and stick has been let go once — refuses only
 * the way back, the direction opposite the steps just taken. Holding a
 * direction through a transition is then harmless, and holding the *same*
 * direction carries on: down from the world map takes you in through the
 * door, across the lobby and into the lift in one press.
 *
 * Pure, so it can be stepped by hand in tests.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface Velocity {
  vx: number;
  vy: number;
}

const STILL: Velocity = { vx: 0, vy: 0 };

export class ArrivalWalk {
  private direction: Direction = "down";
  private remaining = 0;
  private releasing = false;

  /** Start walking `distance` pixels in a direction. */
  begin(direction: Direction, distance: number) {
    this.direction = direction;
    this.remaining = Math.max(0, distance);
    this.releasing = this.remaining > 0;
  }

  /** Still taking the scripted steps. */
  get walking(): boolean {
    return this.remaining > 0;
  }

  /** Still ignoring input: walking, or waiting for the held key to be let go. */
  get holdsInput(): boolean {
    return this.walking || this.releasing;
  }

  /**
   * The velocity for this frame. The last step is shortened to land exactly
   * on the distance rather than overshoot it.
   */
  step(deltaMs: number, speed: number): Velocity {
    if (!this.walking) return STILL;
    const seconds = Math.max(0, deltaMs) / 1000;
    const wanted = speed * seconds;
    const distance = Math.min(this.remaining, wanted);
    this.remaining -= distance;
    const rate = seconds > 0 ? distance / seconds : 0;
    switch (this.direction) {
      case "up":
        return { vx: 0, vy: -rate };
      case "down":
        return { vx: 0, vy: rate };
      case "left":
        return { vx: -rate, vy: 0 };
      case "right":
        return { vx: rate, vy: 0 };
    }
  }

  /** Once the steps are done, call each frame; the way back opens after a frame with nothing held. */
  release(inputHeld: boolean) {
    if (!this.walking && this.releasing && !inputHeld) this.releasing = false;
  }

  /**
   * Input with the way back taken out, while the keys are still being held
   * from before the transition. Everything else passes.
   */
  allow(velocity: Velocity): Velocity {
    if (!this.releasing || this.walking) return velocity;
    switch (this.direction) {
      case "down":
        return { vx: velocity.vx, vy: Math.max(0, velocity.vy) };
      case "up":
        return { vx: velocity.vx, vy: Math.min(0, velocity.vy) };
      case "right":
        return { vx: Math.max(0, velocity.vx), vy: velocity.vy };
      case "left":
        return { vx: Math.min(0, velocity.vx), vy: velocity.vy };
    }
  }

  /** Forget everything, for a scene that starts over. */
  reset() {
    this.remaining = 0;
    this.releasing = false;
  }
}
