import { describe, it, expect, vi } from "vitest";
import { ARRIVE_RADIUS, TapNavigator, advanceAlong, isTap, steerTo } from "../TapNavigator";

describe("telling a tap from a drag", () => {
  it("counts a quick press in one place as a tap", () => {
    expect(isTap({ x: 100, y: 100, at: 0 }, { x: 103, y: 98, at: 120 })).toBe(true);
  });

  it("does not count a press that wandered — that was the camera being dragged", () => {
    expect(isTap({ x: 100, y: 100, at: 0 }, { x: 160, y: 100, at: 120 })).toBe(false);
  });

  it("does not count a long press, which is somebody thinking", () => {
    expect(isTap({ x: 100, y: 100, at: 0 }, { x: 100, y: 100, at: 900 })).toBe(false);
  });
});

describe("steering", () => {
  it("heads straight at the target, at the speed asked for", () => {
    const { vx, vy } = steerTo({ x: 0, y: 0 }, { x: 30, y: 40 }, 100);
    expect(vx).toBeCloseTo(60);
    expect(vy).toBeCloseTo(80);
    expect(Math.hypot(vx, vy)).toBeCloseTo(100);
  });

  it("stands still when it is already there", () => {
    expect(steerTo({ x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("moving along the route", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ];

  it("stays on the current waypoint until it is reached", () => {
    expect(advanceAlong(path, 0, { x: 20, y: 0 })).toBe(0);
  });

  it("moves on once it arrives", () => {
    expect(advanceAlong(path, 0, { x: 2, y: 0 })).toBe(1);
  });

  it("skips every waypoint a long frame flew past, rather than doubling back", () => {
    // One slow frame can cross a whole tile; taking them one at a time makes
    // the character turn round to collect the ones it already passed
    const dense = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 60, y: 0 },
    ];
    expect(advanceAlong(dense, 0, { x: 6, y: 0 })).toBe(3);
  });

  it("runs off the end when the last waypoint is reached", () => {
    expect(advanceAlong(path, 2, { x: 100, y: 0 })).toBe(3);
  });
});

describe("the navigator", () => {
  it("has nothing to do until it is given a route", () => {
    const nav = new TapNavigator();
    expect(nav.active).toBe(false);
    expect(nav.step({ x: 0, y: 0 }, 100)).toBeNull();
  });

  it("walks toward the next waypoint", () => {
    const nav = new TapNavigator();
    nav.follow([{ x: 100, y: 0 }]);
    const velocity = nav.step({ x: 0, y: 0 }, 120);
    expect(velocity).toEqual({ vx: 120, vy: 0 });
  });

  it("says when it has arrived, once", () => {
    const arrived = vi.fn();
    const nav = new TapNavigator();
    nav.follow([{ x: 10, y: 0 }], arrived);

    expect(nav.step({ x: 10, y: 0 }, 100)).toBeNull();
    expect(arrived).toHaveBeenCalledTimes(1);

    nav.step({ x: 10, y: 0 }, 100);
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(nav.active).toBe(false);
  });

  it("drops what it was going to do when it is cancelled", () => {
    // Touching a key means the player has taken over, and whatever the tap
    // was going to open when it got there is no longer what they asked for
    const arrived = vi.fn();
    const nav = new TapNavigator();
    nav.follow([{ x: 100, y: 0 }], arrived);
    nav.cancel();

    expect(nav.active).toBe(false);
    expect(nav.step({ x: 100, y: 0 }, 100)).toBeNull();
    expect(arrived).not.toHaveBeenCalled();
  });

  it("knows where it is headed, for a marker on the floor", () => {
    const nav = new TapNavigator();
    nav.follow([
      { x: 10, y: 0 },
      { x: 90, y: 40 },
    ]);
    expect(nav.destination).toEqual({ x: 90, y: 40 });
  });

  it("walks a whole route end to end", () => {
    const nav = new TapNavigator();
    const arrived = vi.fn();
    nav.follow(
      [
        { x: 0, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: 80 },
      ],
      arrived,
    );

    const at = { x: 0, y: 0 };
    for (let frame = 0; frame < 400 && nav.active; frame++) {
      const velocity = nav.step(at, 200);
      if (!velocity) break;
      at.x += velocity.vx * (1 / 60);
      at.y += velocity.vy * (1 / 60);
    }

    expect(arrived).toHaveBeenCalledTimes(1);
    expect(Math.hypot(at.x - 40, at.y - 80)).toBeLessThan(ARRIVE_RADIUS + 4);
  });
});
