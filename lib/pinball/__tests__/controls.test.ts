import { describe, it, expect } from "vitest";
import { combineInput, touchSide, type ControlSources } from "../controls";

const nothing: ControlSources = {
  keys: { left: false, right: false, launch: false },
  pad: { left: false, right: false, launch: false },
  touch: { left: false, right: false, count: 0 },
  status: "playing",
};

describe("touching the playfield", () => {
  it("flips whichever side was touched", () => {
    // A 300px-wide table starting 40px from the left edge of the window
    expect(touchSide(60, 40, 300)).toBe("left");
    expect(touchSide(300, 40, 300)).toBe("right");
  });

  it("splits down the middle", () => {
    expect(touchSide(189, 40, 300)).toBe("left");
    expect(touchSide(191, 40, 300)).toBe("right");
  });
});

describe("merging the controls", () => {
  it("takes the flippers from whichever input asked", () => {
    expect(
      combineInput({ ...nothing, keys: { left: true, right: false, launch: false } }).left,
    ).toBe(true);
    expect(
      combineInput({ ...nothing, pad: { left: false, right: true, launch: false } }).right,
    ).toBe(true);
    expect(combineInput({ ...nothing, touch: { left: true, right: false, count: 1 } }).left).toBe(
      true,
    );
  });

  it("holds both flippers for two thumbs at once", () => {
    const input = combineInput({ ...nothing, touch: { left: true, right: true, count: 2 } });
    expect(input).toMatchObject({ left: true, right: true });
  });

  it("pulls the plunger while the ball is waiting in the lane", () => {
    const waiting = combineInput({
      ...nothing,
      status: "ready",
      touch: { left: true, right: false, count: 1 },
    });
    expect(waiting.launch).toBe(true);
  });

  it("does not treat a flip as a plunge once the ball is out", () => {
    const playing = combineInput({ ...nothing, touch: { left: true, right: false, count: 1 } });
    expect(playing.launch).toBe(false);
    expect(playing.left).toBe(true);
  });

  it("leaves the table alone when nothing is touched", () => {
    expect(combineInput(nothing)).toEqual({ left: false, right: false, launch: false });
  });
});
