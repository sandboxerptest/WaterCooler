import { describe, expect, it } from "vitest";
import { PadMonitor, type PadButtonEvent } from "../monitor";
import { XBOX, type PadSnapshot } from "../buttons";
import { gameEvents } from "@/lib/events";

function snapshot(buttons: number[], axes: number[] = [0, 0]): PadSnapshot {
  return {
    id: "Xbox Wireless Controller",
    buttons: Array.from({ length: 17 }, (_, i) => buttons.includes(i)),
    axes,
  };
}

/** A monitor fed by hand, frame by frame. */
function rig() {
  let current: PadSnapshot | null = null;
  const monitor = new PadMonitor(() => current);
  const events: PadButtonEvent[] = [];
  monitor.subscribe((event) => events.push(event));
  return {
    monitor,
    events,
    frame(next: PadSnapshot | null) {
      current = next;
      monitor.poll();
    },
  };
}

describe("the controller monitor", () => {
  it("announces a controller when it appears and when it goes", () => {
    const seen: (string | null)[] = [];
    const off = gameEvents.on("gamepad-state", (id) => seen.push(id));
    const { frame, monitor } = rig();

    frame(null);
    expect(monitor.connected()).toBe(false);
    frame(snapshot([]));
    expect(monitor.connected()).toBe(true);
    expect(monitor.layout).toBe("xbox");
    frame(snapshot([]));
    frame(null);

    off();
    expect(seen).toEqual(["Xbox Wireless Controller", null]);
  });

  it("turns held buttons into one press and one release", () => {
    const { frame, events } = rig();
    frame(snapshot([XBOX.Y]));
    frame(snapshot([XBOX.Y]));
    frame(snapshot([]));
    expect(events.map((e) => [e.button, e.phase])).toEqual([
      [XBOX.Y, "down"],
      [XBOX.Y, "up"],
    ]);
  });

  it("hears the stick as the d-pad, once per push", () => {
    const { frame, events, monitor } = rig();
    frame(snapshot([], [0, -1]));
    expect(monitor.isHeld(XBOX.UP)).toBe(true);
    frame(snapshot([], [0, -0.8]));
    frame(snapshot([], [0, 0]));
    expect(events.map((e) => [e.button, e.phase])).toEqual([
      [XBOX.UP, "down"],
      [XBOX.UP, "up"],
    ]);
  });

  it("lets go of everything when the controller is unplugged mid-press", () => {
    const { frame, events } = rig();
    frame(snapshot([XBOX.LT]));
    frame(null);
    expect(events.map((e) => [e.button, e.phase])).toEqual([
      [XBOX.LT, "down"],
      [XBOX.LT, "up"],
    ]);
  });

  it("stops telling a listener that has unsubscribed", () => {
    let current: PadSnapshot | null = null;
    const monitor = new PadMonitor(() => current);
    const heard: number[] = [];
    const off = monitor.subscribe((event) => heard.push(event.button));
    current = snapshot([XBOX.A]);
    monitor.poll();
    off();
    current = snapshot([XBOX.A, XBOX.B]);
    monitor.poll();
    expect(heard).toEqual([XBOX.A]);
  });
});
