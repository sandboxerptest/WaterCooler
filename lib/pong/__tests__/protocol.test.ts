import { describe, it, expect } from "vitest";
import { MAX_MATCH_ID, isPongPayload, makeMatchId } from "../protocol";
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

  it("accepts the ids the game actually makes", () => {
    // The bug this test exists for: player ids are uuids, and two of them
    // with a counter came to 75 characters — so every real challenge was
    // dropped as malformed, while the short ids written by hand in these
    // tests went through and said everything was fine
    const uuid = () => "3f2b8c1e-9d4a-4f77-b0c2-1a5e6d7f8a9b";
    const matchId = makeMatchId(uuid(), uuid(), 1);

    expect(matchId.length).toBeLessThanOrEqual(MAX_MATCH_ID);
    for (const kind of ["invite", "accept", "state", "paddle"]) {
      expect(isPongPayload({ kind, matchId })).toBe(true);
    }
  });

  it("names a different match each time, and each pair of players apart", () => {
    const a = "aaaaaaaa-1111-2222-3333-444444444444";
    const b = "bbbbbbbb-1111-2222-3333-444444444444";
    expect(makeMatchId(a, b, 1)).not.toBe(makeMatchId(a, b, 2));
    expect(makeMatchId(a, b, 1)).not.toBe(makeMatchId(b, a, 1));
  });

  it("is reachable: the socket accepts pong as a client message", () => {
    expect(isClientMessage({ type: "pong", to: "someone", payload: {} })).toBe(true);
    expect(isClientMessage({ type: "nonsense" })).toBe(false);
  });
});
