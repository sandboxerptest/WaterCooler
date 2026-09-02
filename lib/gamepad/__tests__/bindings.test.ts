import { describe, expect, it } from "vitest";
import {
  DEFAULT_TALK_BUTTON,
  parseTalkButton,
  resetTalkButton,
  setTalkButton,
  talkButton,
  type TalkStore,
} from "../bindings";
import { XBOX } from "../buttons";

function memoryStore(): TalkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("the talk button", () => {
  it("is the left trigger until somebody says otherwise", () => {
    expect(DEFAULT_TALK_BUTTON).toBe(XBOX.LT);
    expect(talkButton(memoryStore())).toBe(XBOX.LT);
    expect(talkButton(null)).toBe(XBOX.LT);
  });

  it("remembers the button the person pressed", () => {
    const store = memoryStore();
    setTalkButton(XBOX.LB, store);
    expect(talkButton(store)).toBe(XBOX.LB);
    resetTalkButton(store);
    expect(talkButton(store)).toBe(XBOX.LT);
  });

  it("ignores anything in storage that is not a button", () => {
    expect(parseTalkButton("4")).toBe(4);
    expect(parseTalkButton("0")).toBe(0);
    expect(parseTalkButton("banana")).toBeNull();
    expect(parseTalkButton("-1")).toBeNull();
    expect(parseTalkButton("2.5")).toBeNull();
    expect(parseTalkButton("99")).toBeNull();
    const store = memoryStore();
    store.setItem("watercooler:pad-talk", "nope");
    expect(talkButton(store)).toBe(XBOX.LT);
    setTalkButton(99, store);
    expect(talkButton(store)).toBe(XBOX.LT);
  });
});
