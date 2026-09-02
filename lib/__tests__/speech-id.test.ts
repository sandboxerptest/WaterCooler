import { describe, expect, it } from "vitest";
import { speechId } from "../presence-types";

describe("a remark's id", () => {
  it("is kept when the speaker chose a well-formed one", () => {
    expect(speechId("said-1725000000000-ab12cd34")).toBe("said-1725000000000-ab12cd34");
    expect(speechId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    );
  });

  it("is dropped when it is missing, too short, too long or has odd characters", () => {
    expect(speechId(undefined)).toBeNull();
    expect(speechId(42)).toBeNull();
    expect(speechId("short")).toBeNull();
    expect(speechId("x".repeat(65))).toBeNull();
    expect(speechId("said/../../etc")).toBeNull();
    expect(speechId("has spaces in it")).toBeNull();
  });
});
