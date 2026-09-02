import { describe, expect, it } from "vitest";
import { FAR_PX, NEAR_PX, distanceBetween, offers, volumeAt } from "../proximity";
import { isVoiceSignal } from "../../presence-types";

describe("how loud someone is", () => {
  it("is full up close, silent past earshot, and fades between", () => {
    expect(volumeAt(0)).toBe(1);
    expect(volumeAt(NEAR_PX)).toBe(1);
    expect(volumeAt(FAR_PX)).toBe(0);
    expect(volumeAt(FAR_PX * 2)).toBe(0);
    const mid = volumeAt((NEAR_PX + FAR_PX) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(volumeAt(Number.NaN)).toBe(1);
  });

  it("measures straight across the floor", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("who offers", () => {
  it("is always exactly one of the two", () => {
    expect(offers("a1", "b2")).toBe(true);
    expect(offers("b2", "a1")).toBe(false);
    expect(offers("same", "same")).toBe(false);
  });
});

describe("a voice signal on the wire", () => {
  it("is one of the handshake steps, and nothing heavier", () => {
    expect(isVoiceSignal({ kind: "hello" })).toBe(true);
    expect(isVoiceSignal({ kind: "bye" })).toBe(true);
    expect(isVoiceSignal({ kind: "offer", sdp: "v=0" })).toBe(true);
    expect(isVoiceSignal({ kind: "answer", sdp: "v=0" })).toBe(true);
    expect(isVoiceSignal({ kind: "ice", candidate: { candidate: "x" } })).toBe(true);
    expect(isVoiceSignal({ kind: "offer", sdp: "" })).toBe(false);
    expect(isVoiceSignal({ kind: "offer", sdp: "x".repeat(20_001) })).toBe(false);
    expect(isVoiceSignal({ kind: "ice" })).toBe(false);
    expect(isVoiceSignal({ kind: "shout" })).toBe(false);
    expect(isVoiceSignal(null)).toBe(false);
  });
});
