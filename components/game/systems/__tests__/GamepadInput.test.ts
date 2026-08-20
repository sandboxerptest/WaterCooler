import { describe, it, expect } from "vitest";
import {
  EdgeTracker,
  PAD_BUTTON,
  buttonsForAction,
  confirmLabel,
  detectPadLayout,
  padVelocity,
} from "../GamepadInput";

const SPEED = 100;

describe("padVelocity", () => {
  it("ignores stick drift inside the deadzone", () => {
    const v = padVelocity(
      { axisX: 0.2, axisY: -0.15, left: false, right: false, up: false, down: false },
      SPEED,
    );
    expect(v).toEqual({ vx: 0, vy: 0 });
  });

  it("moves at full speed once the stick clears the deadzone", () => {
    const v = padVelocity(
      { axisX: 0.9, axisY: 0, left: false, right: false, up: false, down: false },
      SPEED,
    );
    expect(v).toEqual({ vx: SPEED, vy: 0 });
  });

  it("normalises diagonals so the pad is not faster than the keyboard", () => {
    const v = padVelocity(
      { axisX: 1, axisY: 1, left: false, right: false, up: false, down: false },
      SPEED,
    );
    expect(v.vx).toBeCloseTo(SPEED * Math.SQRT1_2);
    expect(v.vy).toBeCloseTo(SPEED * Math.SQRT1_2);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(SPEED);
  });

  it("lets the d-pad win over a stick pushed the other way", () => {
    const v = padVelocity(
      { axisX: 0.9, axisY: 0, left: true, right: false, up: false, down: false },
      SPEED,
    );
    expect(v).toEqual({ vx: -SPEED, vy: 0 });
  });

  it("maps a negative Y axis to upward movement", () => {
    const v = padVelocity(
      { axisX: 0, axisY: -0.8, left: false, right: false, up: false, down: false },
      SPEED,
    );
    expect(v).toEqual({ vx: 0, vy: -SPEED });
  });
});

describe("EdgeTracker", () => {
  it("reports a press only on the frame it goes down", () => {
    const edges = new EdgeTracker();

    edges.sample([]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(false);

    edges.sample([PAD_BUTTON.A]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(true);
    expect(edges.isDown(PAD_BUTTON.A)).toBe(true);

    // Still held — must not fire again, or one press opens and closes a menu
    edges.sample([PAD_BUTTON.A]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(false);
    expect(edges.isDown(PAD_BUTTON.A)).toBe(true);
  });

  it("fires again after the button is released", () => {
    const edges = new EdgeTracker();
    edges.sample([PAD_BUTTON.A]);
    edges.sample([]);
    edges.sample([PAD_BUTTON.A]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(true);
  });

  it("treats a disconnect as everything released", () => {
    const edges = new EdgeTracker();
    edges.sample([PAD_BUTTON.A]);
    edges.reset();
    expect(edges.isDown(PAD_BUTTON.A)).toBe(false);
    edges.sample([PAD_BUTTON.A]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(true);
  });
});

describe("layout detection", () => {
  it("recognises an Xbox pad", () => {
    expect(detectPadLayout("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)")).toBe(
      "xbox",
    );
  });

  it("recognises a DualSense", () => {
    expect(detectPadLayout("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")).toBe(
      "playstation",
    );
  });

  it("recognises a Switch Pro pad", () => {
    expect(detectPadLayout("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe(
      "nintendo",
    );
  });

  it("falls back to Xbox labels for an unknown pad", () => {
    expect(detectPadLayout(undefined)).toBe("xbox");
    expect(confirmLabel(detectPadLayout("some generic pad"))).toBe("A");
  });

  it("labels the PlayStation confirm button", () => {
    expect(confirmLabel("playstation")).toBe("✕");
  });
});

describe("action mapping", () => {
  it("confirms with A and cancels with B", () => {
    expect(buttonsForAction("interact")).toContain(PAD_BUTTON.A);
    expect(buttonsForAction("cancel")).toContain(PAD_BUTTON.B);
  });

  it("cycles panels with the shoulder buttons", () => {
    expect(buttonsForAction("panelPrev")).toEqual([PAD_BUTTON.LB]);
    expect(buttonsForAction("panelNext")).toEqual([PAD_BUTTON.RB]);
  });
});
