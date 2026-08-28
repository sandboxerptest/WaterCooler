import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSdk,
  resetIdentityCache,
  resetSdkCache,
  runMettaraTurn,
  setSdkLoader,
  type Sdk,
} from "../client";

const ENV = { ...process.env };

function configure() {
  process.env.METTARA_API_SECRET = "secret";
  process.env.METTARA_PLATFORM_ID = "platform";
}

/**
 * Stands in for the tarball SDK, which is distributed privately and is not
 * installed in CI. It records what the client actually sends to Mettara.
 */
function fakeSdk() {
  const sent: Array<{ conversationId: string; content: string }> = [];
  const created: string[] = [];
  const tokensFor: string[] = [];

  const sdk = {
    EmbedClient: class {
      constructor(
        public secret: string,
        public baseUrl: string,
        public platformId: string,
      ) {}
      async getToken(userId: string) {
        tokensFor.push(userId);
        return { userId, groupId: "g1" };
      }
    },
    MettaraClient: class {
      constructor(public options: { apiKey: string }) {}
      async createConversation(_group: string, _user: string, ai: string) {
        created.push(ai);
        return { id: `conv-${created.length}` };
      }
      async sendMessage(conversationId: string, _g: string, _u: string, content: string) {
        sent.push({ conversationId, content });
        return { content: `reply to ${content.length} chars` };
      }
    },
  } as unknown as Sdk;

  setSdkLoader(async () => sdk);
  return { sent, created, tokensFor };
}

beforeEach(() => {
  resetSdkCache();
  resetIdentityCache();
});

afterEach(() => {
  setSdkLoader();
  resetIdentityCache();
  process.env = { ...ENV };
});

describe("mettara client", () => {
  it("resolves to null rather than throwing when the SDK is absent", async () => {
    await expect(loadSdk()).resolves.toBeNull();
  });

  it("explains how to install the SDK instead of failing opaquely", async () => {
    configure();
    await expect(
      runMettaraTurn({ sessionKey: "s", message: "hi", personality: "You are Sam." }),
    ).rejects.toThrow(/npm install \.\/mettara-nodejs/);
  });

  it("refuses to run when the server has no credentials", async () => {
    delete process.env.METTARA_API_SECRET;
    delete process.env.METTARA_PLATFORM_ID;
    await expect(
      runMettaraTurn({ sessionKey: "s", message: "hi", personality: "You are Sam." }),
    ).rejects.toThrow(/not configured/);
  });

  it("opens a conversation on the first turn and carries the briefing with it", async () => {
    configure();
    const { sent, created } = fakeSdk();

    const reply = await runMettaraTurn({
      seatLabel: "Sam",
      sessionKey: "seat:1",
      message: "Chase the invoice",
      personality: "You are Sam, an accountant.",
      aiName: "analyst",
    });

    expect(created).toEqual(["analyst"]);
    expect(reply.conversationId).toBe("conv-1");
    // Mettara has no system-prompt field, so the briefing rides in front of
    // the first message rather than being silently dropped.
    expect(sent[0].content).toBe("You are Sam, an accountant.\n\nChase the invoice");
    expect(sent[0].conversationId).toBe("conv-1");
  });

  it("resumes an existing conversation without repeating the briefing", async () => {
    configure();
    const { sent, created } = fakeSdk();

    const reply = await runMettaraTurn({
      seatLabel: "Sam",
      sessionKey: "seat:1",
      message: "Any update?",
      personality: "You are Sam, an accountant.",
      conversationId: "conv-existing",
    });

    expect(created).toEqual([]);
    expect(reply.conversationId).toBe("conv-existing");
    expect(sent[0].content).toBe("Any update?");
  });

  it("provisions each seat once and keeps them apart", async () => {
    configure();
    const { tokensFor } = fakeSdk();

    await runMettaraTurn({ seatLabel: "Sam", sessionKey: "a", message: "x", personality: "p" });
    await runMettaraTurn({ seatLabel: "Sam", sessionKey: "a", message: "y", personality: "p" });
    await runMettaraTurn({ seatLabel: "Ada", sessionKey: "b", message: "z", personality: "p" });

    expect(tokensFor).toEqual(["sam", "ada"]);
  });

  it("does not cache a failed provisioning", async () => {
    configure();
    let attempts = 0;
    const sdk = {
      EmbedClient: class {
        async getToken(userId: string) {
          attempts += 1;
          if (attempts === 1) throw new Error("network down");
          return { userId, groupId: "g1" };
        }
      },
      MettaraClient: class {
        async createConversation() {
          return { id: "conv-1" };
        }
        async sendMessage() {
          return { content: "ok" };
        }
      },
    } as unknown as Sdk;
    setSdkLoader(async () => sdk);

    const turn = { seatLabel: "Sam", sessionKey: "a", message: "x", personality: "p" };
    await expect(runMettaraTurn(turn)).rejects.toThrow("network down");
    // A blip must not lock the seat out for the life of the process.
    await expect(runMettaraTurn(turn)).resolves.toMatchObject({ conversationId: "conv-1" });
    expect(attempts).toBe(2);
  });

  it("falls back to the default AI when the HUD picks no model", async () => {
    configure();
    const { created } = fakeSdk();
    await runMettaraTurn({ seatLabel: "Sam", sessionKey: "a", message: "x", personality: "p" });
    expect(created).toEqual(["assistant"]);
  });
});
