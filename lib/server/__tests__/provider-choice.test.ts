import { afterEach, describe, expect, it } from "vitest";
import { RoomStore } from "../room-store";
import {
  describeProviders,
  offeredProviders,
  providerBlocked,
  providerSwitch,
  registerProviderSwitch,
  rememberProvider,
  rememberedProvider,
} from "../provider-choice";
import { resetSdkCache, setSdkLoader } from "../../mettara/client";

afterEach(() => {
  setSdkLoader();
  resetSdkCache();
  registerProviderSwitch(null);
  delete process.env.METTARA_API_SECRET;
  delete process.env.METTARA_PLATFORM_ID;
});

describe("what the panel offers", () => {
  it("is the Claude implementation the server booted with, then Mettara", () => {
    expect(offeredProviders("claude")).toEqual(["claude", "mettara"]);
    expect(offeredProviders("claude-api")).toEqual(["claude-api", "mettara"]);
  });

  it("still offers Claude when the server booted on Mettara", () => {
    expect(offeredProviders("mettara")).toEqual(["mettara", "claude"]);
  });
});

describe("the remembered choice", () => {
  it("comes back from the database, but only if it is still offered", () => {
    const store = new RoomStore(":memory:");
    expect(rememberedProvider(store, "claude")).toBeNull();
    rememberProvider(store, "mettara");
    expect(rememberedProvider(store, "claude")).toBe("mettara");
    store.setSetting("agent-provider", "auggie");
    expect(rememberedProvider(store, "claude")).toBeNull();
  });
});

describe("whether Mettara can run", () => {
  it("wants its keys, then its SDK", async () => {
    expect(await providerBlocked("mettara")).toMatch(/METTARA_API_SECRET/);
    process.env.METTARA_API_SECRET = "s";
    process.env.METTARA_PLATFORM_ID = "p";
    setSdkLoader(async () => null);
    expect(await providerBlocked("mettara")).toMatch(/SDK/i);
  });

  it("is described alongside the default, with its reason", async () => {
    setSdkLoader(async () => null);
    const state = await describeProviders("claude", "claude");
    expect(state.choices.map((c) => c.id)).toEqual(["claude", "mettara"]);
    expect(state.choices[1].blocked).not.toBeNull();
    expect(state.active).toBe("claude");
  });
});

describe("the switch across module graphs", () => {
  it("is there only while a bridge registers one", async () => {
    expect(providerSwitch()).toBeNull();
    registerProviderSwitch({
      defaultId: "claude",
      active: () => "claude",
      switchTo: async () => null,
    });
    expect(providerSwitch()?.active()).toBe("claude");
    registerProviderSwitch(null);
    expect(providerSwitch()).toBeNull();
  });
});
