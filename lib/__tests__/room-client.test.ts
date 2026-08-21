import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchRoomSnapshot,
  saveRoomPatch,
  flushRoomWrites,
  resetRoomWrites,
  WRITE_DEBOUNCE_MS,
} from "../room-client";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetRoomWrites();
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

function lastWriteBody() {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("saveRoomPatch", () => {
  it("waits for the debounce before writing", () => {
    saveRoomPatch({ tasks: [] });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into a single request", () => {
    // The store persists on every reducer change; a streaming reply must not
    // become a request per token.
    for (let i = 0; i < 20; i++) saveRoomPatch({ messages: [{ id: `m${i}` }] as never });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastWriteBody().messages).toEqual([{ id: "m19" }]);
  });

  it("merges different slices queued together", () => {
    saveRoomPatch({ tasks: [{ taskId: "t1" }] as never });
    saveRoomPatch({ seats: [{ seatId: "seat-0" }] as never });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);

    const body = lastWriteBody();
    expect(body.tasks).toEqual([{ taskId: "t1" }]);
    expect(body.seats).toEqual([{ seatId: "seat-0" }]);
  });

  it("sends a cleared active session key rather than dropping it", () => {
    saveRoomPatch({ activeSessionKey: null });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(lastWriteBody()).toEqual({ activeSessionKey: null });
  });

  it("starts a fresh batch after a write goes out", () => {
    saveRoomPatch({ tasks: [{ taskId: "t1" }] as never });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    saveRoomPatch({ seats: [{ seatId: "seat-1" }] as never });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastWriteBody()).toEqual({ seats: [{ seatId: "seat-1" }] });
  });

  it("survives a failing request without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    saveRoomPatch({ tasks: [] });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    await expect(flushRoomWrites()).resolves.toBeUndefined();
  });
});

describe("flushRoomWrites", () => {
  it("writes immediately instead of waiting out the debounce", async () => {
    saveRoomPatch({ tasks: [{ taskId: "t1" }] as never });
    await flushRoomWrites();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing queued", async () => {
    await flushRoomWrites();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchRoomSnapshot", () => {
  it("anchors rows with no session key to the active session", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tasks: [{ taskId: "t1" }],
        messages: [{ id: "m1" }],
        sessions: [],
        seats: [],
        activeSessionKey: "agent:carol:main",
      }),
    );

    const snapshot = await fetchRoomSnapshot("main");
    expect(snapshot.tasks[0].sessionKey).toBe("agent:carol:main");
    expect(snapshot.messages[0].sessionKey).toBe("agent:carol:main");
  });

  it("falls back to the main session when the room has no active one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tasks: [{ taskId: "t1" }] }));

    const snapshot = await fetchRoomSnapshot("main");
    expect(snapshot.tasks[0].sessionKey).toBe("main");
    expect(snapshot.activeSessionKey).toBeNull();
  });

  it("opens an empty room rather than throwing when the server is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(fetchRoomSnapshot("main")).resolves.toEqual({
      tasks: [],
      messages: [],
      sessions: [],
      seats: [],
      activeSessionKey: null,
    });
  });

  it("opens an empty room on a server error response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));
    const snapshot = await fetchRoomSnapshot("main");
    expect(snapshot.tasks).toEqual([]);
  });
});
