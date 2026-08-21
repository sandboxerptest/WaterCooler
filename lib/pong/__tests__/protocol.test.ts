import { describe, it, expect } from "vitest";
import { isPongPayload } from "../protocol";
import { isClientMessage } from "../../presence-types";

/**
 * The server relays these without understanding them, so this guard is the
 * only thing between "a move in a game" and "anything at all, forwarded to
 * another player".
 */
describe("what the server will pass on", () => {
  it("accepts the moves of a game", () => {
    for (const kind of ["invite", "accept", "decline", "quit", "paddle", "state"]) {
      expect(isPongPayload({ kind, matchId: "m1" })).toBe(true);
    }
  });

  it("refuses anything without a match to belong to", () => {
    expect(isPongPayload({ kind: "invite" })).toBe(false);
    expect(isPongPayload({ kind: "invite", matchId: 7 })).toBe(false);
  });

  it("refuses a kind it does not know", () => {
    expect(isPongPayload({ kind: "shutdown", matchId: "m1" })).toBe(false);
    expect(isPongPayload({ kind: "__proto__", matchId: "m1" })).toBe(false);
  });

  it("refuses a match id long enough to be a payload of its own", () => {
    expect(isPongPayload({ kind: "invite", matchId: "x".repeat(65) })).toBe(false);
  });

  it("refuses things that are not messages at all", () => {
    for (const value of [null, undefined, 42, "invite", [], () => {}]) {
      expect(isPongPayload(value)).toBe(false);
    }
  });

  it("is reachable: the socket accepts pong as a client message", () => {
    expect(isClientMessage({ type: "pong", to: "someone", payload: {} })).toBe(true);
    expect(isClientMessage({ type: "nonsense" })).toBe(false);
  });
});
