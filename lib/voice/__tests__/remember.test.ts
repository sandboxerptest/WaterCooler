import { describe, expect, it } from "vitest";
import { rememberVoice, voiceWasOn, type VoiceMemory } from "../remember";

function memory(): VoiceMemory & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("remembering that voice was on", () => {
  it("is off until switched on, and forgotten when switched off", () => {
    const store = memory();
    expect(voiceWasOn(store)).toBe(false);
    rememberVoice(true, store);
    expect(voiceWasOn(store)).toBe(true);
    rememberVoice(false, store);
    expect(voiceWasOn(store)).toBe(false);
  });

  it("copes with no storage at all", () => {
    expect(() => rememberVoice(true, null)).not.toThrow();
    expect(voiceWasOn(null)).toBe(false);
  });
});
