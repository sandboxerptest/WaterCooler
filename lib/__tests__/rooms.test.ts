import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROOM_SLUG,
  normaliseRoomSlug,
  floorRoomSlug,
  parseRoomPath,
  roomFromLocation,
  generateRoomSlug,
} from "../rooms";

describe("normaliseRoomSlug", () => {
  it("keeps a already-clean slug", () => {
    expect(normaliseRoomSlug("design-standup")).toBe("design-standup");
  });

  it("lowercases and joins words", () => {
    expect(normaliseRoomSlug("Design Standup")).toBe("design-standup");
  });

  it("falls back for empty input", () => {
    expect(normaliseRoomSlug("")).toBe(DEFAULT_ROOM_SLUG);
    expect(normaliseRoomSlug(null)).toBe(DEFAULT_ROOM_SLUG);
    expect(normaliseRoomSlug("!!!")).toBe(DEFAULT_ROOM_SLUG);
  });

  it("refuses path traversal, since slugs become directory names", () => {
    expect(normaliseRoomSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(normaliseRoomSlug("..")).toBe(DEFAULT_ROOM_SLUG);
    expect(normaliseRoomSlug("a/b")).toBe("a-b");
  });

  it("caps the length", () => {
    expect(normaliseRoomSlug("x".repeat(200)).length).toBeLessThanOrEqual(40);
  });

  it("collapses runs of separators", () => {
    expect(normaliseRoomSlug("a   b___c")).toBe("a-b-c");
  });
});

describe("roomFromLocation", () => {
  it("reads /r/<slug>", () => {
    expect(roomFromLocation({ pathname: "/r/standup", search: "" })).toBe("standup");
  });

  it("gives a floor its own room, under the building's name", () => {
    expect(roomFromLocation({ pathname: "/r/castle-atlantic/floor/2", search: "" })).toBe(
      floorRoomSlug("castle-atlantic", 2),
    );
    expect(floorRoomSlug("castle-atlantic", 2)).toBe("castle-atlantic-floor-2");
    expect(parseRoomPath("/r/castle-atlantic/floor/1")).toEqual({
      slug: "castle-atlantic",
      floor: 1,
    });
    expect(parseRoomPath("/r/castle-atlantic")).toEqual({ slug: "castle-atlantic", floor: null });
    expect(parseRoomPath("/")).toBeNull();
  });

  it("reads ?room=<slug>", () => {
    expect(roomFromLocation({ pathname: "/", search: "?room=standup" })).toBe("standup");
  });

  it("prefers the path over the query", () => {
    expect(roomFromLocation({ pathname: "/r/one", search: "?room=two" })).toBe("one");
  });

  it("puts everyone on the world map in one room, and each campus in its own", () => {
    expect(roomFromLocation({ pathname: "/world", search: "" })).toBe("world");
    expect(roomFromLocation({ pathname: "/world/", search: "" })).toBe("world");
    expect(roomFromLocation({ pathname: "/campus/homestar", search: "" })).toBe("campus-homestar");
    expect(roomFromLocation({ pathname: "/campus/apeiron-media", search: "" })).toBe(
      "campus-apeiron-media",
    );
    expect(roomFromLocation({ pathname: "/campus/../x", search: "" })).toBe("local");
  });

  it("defaults on the bare app", () => {
    expect(roomFromLocation({ pathname: "/", search: "" })).toBe(DEFAULT_ROOM_SLUG);
  });

  it("decodes and cleans an encoded slug", () => {
    expect(roomFromLocation({ pathname: "/r/Team%20Sync", search: "" })).toBe("team-sync");
  });
});

describe("generateRoomSlug", () => {
  it("is prefixed and carries the random part", () => {
    expect(generateRoomSlug(() => "abc123")).toBe("r-abc123");
  });
});
