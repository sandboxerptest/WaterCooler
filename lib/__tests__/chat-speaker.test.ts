import { describe, expect, it } from "vitest";
import { speakerLabel } from "../chat-speaker";

const me = { id: "me-1", name: "Ann" };

describe("who a bubble is from", () => {
  it("calls this browser's own task message You", () => {
    expect(speakerLabel({ role: "user", actorName: "Ann", authorId: "me-1" }, me)).toBe("You");
  });

  it("names another person's task message after them, not You", () => {
    expect(speakerLabel({ role: "user", actorName: "Bob", authorId: "bob-2" }, me)).toBe("Bob");
    expect(speakerLabel({ role: "user", authorId: "bob-2" }, me)).toBe("Someone");
  });

  it("still says You for an unsigned message from before signing, and for a fresh id under the same name", () => {
    expect(speakerLabel({ role: "user" }, me)).toBe("You");
    expect(speakerLabel({ role: "user", actorName: "Ann", authorId: "old-id" }, me)).toBe("You");
  });

  it("marks a remark in the room as from here, and an agent by its name", () => {
    expect(speakerLabel({ role: "player", actorName: "Bob" }, me)).toBe("Bob · here");
    expect(speakerLabel({ role: "assistant", actorName: "Yoshi" }, me)).toBe("Yoshi");
    expect(speakerLabel({ role: "assistant" }, me, "Desk 3")).toBe("Desk 3");
    expect(speakerLabel({ role: "assistant" }, me)).toBe("Assistant");
  });
});
