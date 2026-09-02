import { describe, expect, it } from "vitest";
import { isComplete } from "../profile";

const full = {
  id: "ab12cd34",
  name: "Robert",
  home: "castle-atlantic",
  character: { key: "library-character_02", path: "/characters/x.png" },
  guest: false,
};

describe("a profile is complete when", () => {
  it("has a name, a home and a character", () => {
    expect(isComplete(full)).toBe(true);
  });
  it("is still a Guest", () => {
    expect(isComplete({ ...full, name: "Guest" })).toBe(false);
    expect(isComplete({ ...full, name: "  " })).toBe(false);
  });
  it("has nowhere to go home to", () => {
    expect(isComplete({ ...full, home: null })).toBe(false);
  });
  it("has nothing to wear", () => {
    expect(isComplete({ ...full, character: null })).toBe(false);
  });
});
