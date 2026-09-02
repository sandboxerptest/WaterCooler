import { describe, it, expect } from "vitest";
import {
  EdgeTracker,
  selectPad,
  PAD_BUTTON,
  buttonsForAction,
  confirmLabel,
  detectPadLayout,
  padVelocity,
} from "../GamepadInput";
import { nextFocusIndex } from "@/lib/gamepad/focus";

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

describe("selectPad", () => {
  const pad = (over = {}) => ({
    id: "Xbox Wireless Controller",
    connected: true,
    axes: [0, 0],
    buttons: [{ pressed: false }],
    ...over,
  });

  it("finds a connected controller", () => {
    expect(selectPad([pad()])?.id).toBe("Xbox Wireless Controller");
  });

  it("skips the empty slots the browser pads the list with", () => {
    // navigator.getGamepads() returns a fixed-length array full of nulls
    expect(selectPad([null, null, pad(), null])?.id).toBe("Xbox Wireless Controller");
  });

  it("ignores a disconnected entry", () => {
    expect(selectPad([pad({ connected: false })])).toBeNull();
  });

  it("ignores an entry with no buttons, which is not a usable pad", () => {
    expect(selectPad([pad({ buttons: [] })])).toBeNull();
  });

  it("returns null when nothing is plugged in", () => {
    expect(selectPad([null, null, null, null])).toBeNull();
  });

  it("finds a pad that was already connected before the page loaded", () => {
    // The original bug: Phaser only counts pads whose "connected" event it saw,
    // so a controller plugged in beforehand stayed invisible. Reading the list
    // directly does not care when it arrived.
    const alreadyThere = [pad({ id: "Xbox Wireless Controller (STANDARD GAMEPAD)" })];
    expect(selectPad(alreadyThere)).not.toBeNull();
  });
});

describe("driving a dialog with the pad", () => {
  it("reports the release as well as the press, for push-to-talk", () => {
    const edges = new EdgeTracker();

    edges.sample([PAD_BUTTON.A]);
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(true);
    expect(edges.justReleased(PAD_BUTTON.A)).toBe(false);

    edges.sample([PAD_BUTTON.A]); // still held
    expect(edges.justPressed(PAD_BUTTON.A)).toBe(false);
    expect(edges.justReleased(PAD_BUTTON.A)).toBe(false);

    edges.sample([]);
    expect(edges.justReleased(PAD_BUTTON.A)).toBe(true);

    edges.sample([]);
    expect(edges.justReleased(PAD_BUTTON.A)).toBe(false);
  });

  it("moves the focus ring with either axis of the d-pad", () => {
    expect(buttonsForAction("menuLeft")).toEqual([PAD_BUTTON.DPAD_LEFT]);
    expect(buttonsForAction("menuRight")).toEqual([PAD_BUTTON.DPAD_RIGHT]);
  });
});

describe("where the focus ring goes next", () => {
  it("steps forward and back", () => {
    expect(nextFocusIndex(0, 1, 4)).toBe(1);
    expect(nextFocusIndex(2, -1, 4)).toBe(1);
  });

  it("wraps at both ends, so the ring cannot be stranded", () => {
    expect(nextFocusIndex(3, 1, 4)).toBe(0);
    expect(nextFocusIndex(0, -1, 4)).toBe(3);
  });

  it("starts at whichever end the first press comes from", () => {
    // Nothing in the dialog is focused yet: down opens at the top, up at the end
    expect(nextFocusIndex(-1, 1, 4)).toBe(0);
    expect(nextFocusIndex(-1, -1, 4)).toBe(3);
  });

  it("has nowhere to go in a dialog with no controls", () => {
    expect(nextFocusIndex(-1, 1, 0)).toBe(-1);
  });
});
