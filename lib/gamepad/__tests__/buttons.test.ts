import { describe, expect, it } from "vitest";
import {
  HUD_BUTTONS,
  MACHINE_BUTTONS,
  XBOX,
  buttonLabel,
  detectPadLayout,
  diffButtons,
  effectiveButtons,
  machineAction,
  snapshotPad,
  stickAsDpad,
  type MachineAction,
  type PadSnapshot,
} from "../buttons";

function pad(buttons: number[] = [], axes: number[] = [0, 0]): PadSnapshot {
  const held = Array.from({ length: 17 }, (_, i) => buttons.includes(i));
  return { id: "Xbox Wireless Controller", buttons: held, axes };
}

describe("the Xbox layout", () => {
  it("names the buttons the way they are printed", () => {
    expect(buttonLabel(XBOX.A)).toBe("A");
    expect(buttonLabel(XBOX.B)).toBe("B");
    expect(buttonLabel(XBOX.X)).toBe("X");
    expect(buttonLabel(XBOX.Y)).toBe("Y");
    expect(buttonLabel(XBOX.LT)).toBe("LT");
    expect(buttonLabel(XBOX.VIEW)).toBe("View");
    expect(buttonLabel(XBOX.MENU)).toBe("Menu");
  });

  it("follows the standard mapping's indices", () => {
    expect(XBOX.A).toBe(0);
    expect(XBOX.LB).toBe(4);
    expect(XBOX.LT).toBe(6);
    expect(XBOX.VIEW).toBe(8);
    expect(XBOX.UP).toBe(12);
    expect(XBOX.RIGHT).toBe(15);
  });

  it("still labels an unknown index rather than crashing", () => {
    expect(buttonLabel(16)).toBe("#16");
  });
});

describe("what the machines do with the pad", () => {
  it("has a button for mute, full screen, close and back, all different", () => {
    const wanted: MachineAction[] = ["mute", "fullscreen", "close", "back"];
    const used = new Set(wanted.map((action) => MACHINE_BUTTONS[action]));
    expect(used.size).toBe(wanted.length);
  });

  it("keeps every binding off the buttons the games play with", () => {
    // A is the action and the bumpers are pinball's flippers; the d-pad
    // steers. Nothing else may sit on those.
    const reserved = new Set<number>([XBOX.LB, XBOX.RB, XBOX.UP, XBOX.DOWN, XBOX.LEFT, XBOX.RIGHT]);
    for (const [action, button] of Object.entries(MACHINE_BUTTONS)) {
      if (action === "act") continue;
      expect(reserved.has(button)).toBe(false);
    }
  });

  it("maps the documented buttons", () => {
    expect(MACHINE_BUTTONS.act).toBe(XBOX.A);
    expect(MACHINE_BUTTONS.back).toBe(XBOX.B);
    expect(MACHINE_BUTTONS.fullscreen).toBe(XBOX.X);
    expect(MACHINE_BUTTONS.mute).toBe(XBOX.Y);
    expect(MACHINE_BUTTONS.close).toBe(XBOX.VIEW);
    expect(MACHINE_BUTTONS.restart).toBe(XBOX.MENU);
    expect(MACHINE_BUTTONS.talk).toBe(XBOX.LT);
  });

  it("reads an action back from a button, and nothing from the rest", () => {
    expect(machineAction(XBOX.Y)).toBe("mute");
    expect(machineAction(XBOX.VIEW)).toBe("close");
    expect(machineAction(XBOX.RT)).toBeNull();
    expect(machineAction(XBOX.UP)).toBeNull();
  });

  it("talks with the same trigger inside and outside the machines", () => {
    expect(HUD_BUTTONS.talk).toBe(MACHINE_BUTTONS.talk);
  });
});

describe("the stick as a d-pad", () => {
  it("is quiet near the centre", () => {
    expect(stickAsDpad([0.3, -0.3])).toEqual({ up: false, down: false, left: false, right: false });
  });

  it("presses the matching direction once pushed far enough", () => {
    expect(stickAsDpad([0, -0.9])).toMatchObject({ up: true, down: false });
    expect(stickAsDpad([0.9, 0])).toMatchObject({ right: true, left: false });
  });

  it("folds into the d-pad slots without losing a real press", () => {
    const held = effectiveButtons(pad([XBOX.LEFT], [0, 0.9]));
    expect(held[XBOX.LEFT]).toBe(true);
    expect(held[XBOX.DOWN]).toBe(true);
    expect(held[XBOX.UP]).toBe(false);
  });

  it("pads a short button list out to the d-pad", () => {
    const held = effectiveButtons({ id: "x", buttons: [true], axes: [0, -1] });
    expect(held[XBOX.A]).toBe(true);
    expect(held[XBOX.UP]).toBe(true);
    expect(held.length).toBe(XBOX.RIGHT + 1);
  });
});

describe("frame to frame", () => {
  it("reports a press on the frame it goes down and a release when let go", () => {
    expect(diffButtons([false, false], [true, false])).toEqual({ down: [0], up: [] });
    expect(diffButtons([true, false], [true, false])).toEqual({ down: [], up: [] });
    expect(diffButtons([true, false], [false, false])).toEqual({ down: [], up: [0] });
  });

  it("treats a pad that vanished as everything released", () => {
    expect(diffButtons([true, true, false, true], [])).toEqual({ down: [], up: [0, 1, 3] });
  });
});

describe("the browser's list", () => {
  it("skips the empty slots and disconnected entries", () => {
    const found = snapshotPad([
      null,
      { id: "gone", connected: false, axes: [], buttons: [{ pressed: false }] },
      { id: "Xbox", connected: true, axes: [0.5, 0], buttons: [{ pressed: true }] },
    ]);
    expect(found).toEqual({ id: "Xbox", buttons: [true], axes: [0.5, 0] });
  });

  it("returns null when nothing is plugged in", () => {
    expect(snapshotPad([null, null])).toBeNull();
  });

  it("names the family from the id", () => {
    expect(detectPadLayout("Xbox Wireless Controller")).toBe("xbox");
    expect(detectPadLayout("DualSense Wireless Controller")).toBe("playstation");
    expect(detectPadLayout("Pro Controller (Nintendo)")).toBe("nintendo");
    expect(detectPadLayout(undefined)).toBe("xbox");
  });
});
