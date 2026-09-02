import { describe, expect, it } from "vitest";
import { normaliseEmail, parseProfileUpdate } from "./accounts";

const good = {
  name: "  Robert   Chambers ",
  home: "castle-atlantic",
  character: { key: "character_02", path: "/characters/Premade_Character_48x48_02.png" },
};

describe("a profile update", () => {
  it("is tidied and kept when it is whole", () => {
    expect(parseProfileUpdate(good)).toEqual({
      ...good,
      name: "Robert Chambers",
    });
  });

  it("is cut to the name limit", () => {
    expect(parseProfileUpdate({ ...good, name: "A".repeat(40) })?.name).toHaveLength(16);
  });

  it("is refused without a real name, a known home, or a character", () => {
    expect(parseProfileUpdate({ ...good, name: "Guest" })).toBeNull();
    expect(parseProfileUpdate({ ...good, name: "   " })).toBeNull();
    expect(parseProfileUpdate({ ...good, home: "nowhere" })).toBeNull();
    expect(parseProfileUpdate({ ...good, character: null })).toBeNull();
    expect(parseProfileUpdate({ ...good, character: { key: "x" } })).toBeNull();
  });

  it("is refused when the character path could wander", () => {
    expect(parseProfileUpdate({ ...good, character: { key: "k", path: "../etc" } })).toBeNull();
    expect(
      parseProfileUpdate({ ...good, character: { key: "k", path: "/a/../b.png" } }),
    ).toBeNull();
    expect(parseProfileUpdate({ ...good, character: { key: "k", path: "http://x/y" } })).toBeNull();
  });

  it("is refused when it is not an object at all", () => {
    expect(parseProfileUpdate(null)).toBeNull();
    expect(parseProfileUpdate("name")).toBeNull();
  });
});

describe("an email", () => {
  it("is one address however it is written", () => {
    expect(normaliseEmail("  Robert.Chambers@Example.COM ")).toBe("robert.chambers@example.com");
  });
});
