import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GatewayConfig } from "@/types/game";

// ── localStorage mock ────────────────────────────────────

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    get length() {
      return store.size;
    },
    key: vi.fn(() => null),
    _store: store,
  } satisfies Storage & { _store: Map<string, string> };
}

let storage: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  storage = createLocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
});

// We re-import the module for each test group so the module-level
// `typeof window` check inside lsGet sees our mock.
// Because vitest caches modules we use dynamic import after setting up mocks.

async function loadModule() {
  // resetModules is not needed – the module has no top-level side effects
  // and every call re-evaluates `typeof window` at runtime.
  return await import("@/lib/persistence");
}

// ── Tests ────────────────────────────────────────────────

describe("lsGet", () => {
  it("returns fallback when key is missing", async () => {
    const { lsGet } = await loadModule();
    expect(lsGet("nonexistent-key", 42)).toBe(42);
  });

  it("returns parsed value when key has valid JSON", async () => {
    const { lsGet } = await loadModule();
    storage.setItem("test-key", JSON.stringify({ a: 1 }));
    expect(lsGet("test-key", {})).toEqual({ a: 1 });
  });

  it("returns fallback when stored value is corrupted JSON", async () => {
    const { lsGet } = await loadModule();
    storage.setItem("bad-json", "{not valid json!!");
    expect(lsGet("bad-json", "fallback")).toBe("fallback");
  });

  it("returns fallback when window is undefined (server-side)", async () => {
    const { lsGet } = await loadModule();

    const origWindow = globalThis.window;
    // @ts-expect-error -- intentionally removing window to simulate SSR
    delete globalThis.window;

    try {
      expect(lsGet("any-key", "server-fallback")).toBe("server-fallback");
    } finally {
      // restore so other tests are not affected
      Object.defineProperty(globalThis, "window", {
        value: origWindow,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe("lsSet", () => {
  it("writes JSON to localStorage", async () => {
    const { lsSet } = await loadModule();
    lsSet("write-key", { x: 10 });
    expect(storage.setItem).toHaveBeenCalledWith("write-key", JSON.stringify({ x: 10 }));
    expect(JSON.parse(storage._store.get("write-key")!)).toEqual({ x: 10 });
  });

  it("handles quota exceeded error gracefully", async () => {
    const { lsSet } = await loadModule();

    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    // Should not throw even when localStorage quota is exceeded
    expect(() => lsSet("big-key", "x".repeat(100))).not.toThrow();
  });
});

describe("gateway config", () => {
  it("round-trips GatewayConfig", async () => {
    const { saveGatewayConfig, loadGatewayConfig } = await loadModule();
    const config: GatewayConfig = { url: "https://gw.test", token: "tok-123" };
    saveGatewayConfig(config);
    expect(loadGatewayConfig()).toEqual(config);
  });

  it("returns null when nothing is stored", async () => {
    const { loadGatewayConfig } = await loadModule();
    expect(loadGatewayConfig()).toBeNull();
  });
});

describe("rename migration", () => {
  it("adopts a value stored under the old prefix", async () => {
    // The rename must not forget someone's display name or volume
    storage._store.set("agent-town:player-name", JSON.stringify("Robert"));
    const mod = await loadModule();
    expect(mod.lsGet("watercooler:player-name", "Guest")).toBe("Robert");
  });

  it("moves it across, so the old key stops being read", async () => {
    storage._store.set("agent-town:bgm-volume", JSON.stringify(0));
    const mod = await loadModule();
    mod.lsGet("watercooler:bgm-volume", 1);

    expect(storage._store.get("watercooler:bgm-volume")).toBe("0");
    expect(storage._store.has("agent-town:bgm-volume")).toBe(false);
  });

  it("prefers a current value over a stale legacy one", async () => {
    storage._store.set("agent-town:player-name", JSON.stringify("Old"));
    storage._store.set("watercooler:player-name", JSON.stringify("New"));
    const mod = await loadModule();
    expect(mod.lsGet("watercooler:player-name", "Guest")).toBe("New");
  });
});
