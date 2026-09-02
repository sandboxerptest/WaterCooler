import { describe, expect, it } from "vitest";
import { ArrivalWalk } from "../arrival";

describe("arriving", () => {
  it("walks the distance and no further", () => {
    const walk = new ArrivalWalk();
    walk.begin("down", 96);
    let travelled = 0;
    let frames = 0;
    while (walk.walking && frames < 100) {
      const v = walk.step(16, 160);
      travelled += (v.vy * 16) / 1000;
      frames++;
    }
    expect(travelled).toBeCloseTo(96, 6);
    expect(frames).toBe(Math.ceil(96 / ((160 * 16) / 1000)));
    expect(walk.step(16, 160)).toEqual({ vx: 0, vy: 0 });
  });

  it("goes the way it was told", () => {
    const walk = new ArrivalWalk();
    walk.begin("up", 10);
    expect(walk.step(1000, 10).vy).toBeLessThan(0);
    walk.begin("left", 10);
    expect(walk.step(1000, 10).vx).toBeLessThan(0);
    walk.begin("right", 10);
    expect(walk.step(1000, 10).vx).toBeGreaterThan(0);
  });

  it("keeps hold of the keys until they are let go", () => {
    const walk = new ArrivalWalk();
    walk.begin("down", 20);
    walk.step(1000, 100);
    expect(walk.walking).toBe(false);
    expect(walk.holdsInput).toBe(true);
    walk.release(true); // still holding up through the transition
    expect(walk.holdsInput).toBe(true);
    walk.release(false);
    expect(walk.holdsInput).toBe(false);
  });

  it("lets you carry on the same way, and only refuses the way back", () => {
    const walk = new ArrivalWalk();
    walk.begin("down", 20);
    walk.step(1000, 100);
    walk.release(true);
    expect(walk.allow({ vx: 0, vy: 100 })).toEqual({ vx: 0, vy: 100 });
    expect(walk.allow({ vx: 50, vy: -100 })).toEqual({ vx: 50, vy: 0 });
    walk.release(false);
    expect(walk.allow({ vx: 0, vy: -100 })).toEqual({ vx: 0, vy: -100 });
  });

  it("does not let go early, while still walking", () => {
    const walk = new ArrivalWalk();
    walk.begin("down", 200);
    walk.step(16, 160);
    walk.release(false);
    expect(walk.holdsInput).toBe(true);
  });

  it("is idle from the start and after a reset", () => {
    const walk = new ArrivalWalk();
    expect(walk.holdsInput).toBe(false);
    walk.begin("down", 50);
    walk.reset();
    expect(walk.holdsInput).toBe(false);
  });
});
