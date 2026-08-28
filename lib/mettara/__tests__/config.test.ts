import { describe, it, expect } from "vitest";
import { DEFAULT_BASE_URL, mettaraPreflight, readMettaraConfig, sourceUserId } from "../config";
import { getCliProvider, isCliProviderId } from "../../cli-providers";
import { getProviderLabel, isCliProvider } from "../../utils";

describe("mettara config", () => {
  it("is unconfigured until both credentials are present", () => {
    expect(readMettaraConfig({})).toBeNull();
    expect(readMettaraConfig({ METTARA_API_SECRET: "s" })).toBeNull();
    expect(readMettaraConfig({ METTARA_PLATFORM_ID: "p" })).toBeNull();
  });

  it("fills in the hosted defaults", () => {
    const config = readMettaraConfig({
      METTARA_API_SECRET: "s",
      METTARA_PLATFORM_ID: "p",
    });
    expect(config).toMatchObject({ apiSecret: "s", platformId: "p", baseUrl: DEFAULT_BASE_URL });
  });

  it("lets a staging deployment override the host", () => {
    const config = readMettaraConfig({
      METTARA_API_SECRET: "s",
      METTARA_PLATFORM_ID: "p",
      METTARA_BASE_URL: "https://staging.mettara.ai",
    });
    expect(config?.baseUrl).toBe("https://staging.mettara.ai");
  });

  it("treats blank credentials as absent", () => {
    expect(
      readMettaraConfig({
        METTARA_API_SECRET: "   ",
        METTARA_PLATFORM_ID: "p",
      }),
    ).toBeNull();
  });

  it("names the missing variable in the preflight message", () => {
    expect(mettaraPreflight({})).toContain("METTARA_API_SECRET");
    expect(mettaraPreflight({ METTARA_API_SECRET: "s" })).toContain("METTARA_PLATFORM_ID");
    expect(mettaraPreflight({ METTARA_API_SECRET: "s", METTARA_PLATFORM_ID: "p" })).toBeNull();
  });

  it("derives a stable identity from a seat label", () => {
    expect(sourceUserId("Sam Rivera", "sess-1")).toBe("sam-rivera");
    expect(sourceUserId("Sam Rivera", "sess-2")).toBe("sam-rivera");
    expect(sourceUserId(undefined, "seat:desk-4")).toBe("seat-desk-4");
    expect(sourceUserId("!!!", "sess-3")).toBe("sess-3");
  });
});

describe("mettara provider registration", () => {
  it("is a recognised provider id", () => {
    expect(isCliProviderId("mettara")).toBe(true);
  });

  it("is a service provider with no binary to find", () => {
    const provider = getCliProvider("mettara");
    expect(provider.kind).toBe("service");
    expect(provider.binName).toBeUndefined();
    expect(provider.run).toBeTypeOf("function");
    expect(provider.usesWorkspaces).toBe(false);
  });

  it("connects through the in-process bridge, not an OpenClaw gateway", () => {
    expect(isCliProvider("mettara")).toBe(true);
    expect(getProviderLabel("mettara")).toBe("Mettara AI");
  });

  it("blocks a run when the server has no credentials", () => {
    const previous = { ...process.env };
    delete process.env.METTARA_API_SECRET;
    delete process.env.METTARA_PLATFORM_ID;
    try {
      expect(getCliProvider("mettara").preflight?.()).toContain("METTARA_API_SECRET");
    } finally {
      Object.assign(process.env, previous);
    }
  });
});
