/**
 * Mettara Connect client.
 *
 * Wraps the `mettara-lib` SDK in the two calls the bridge actually needs:
 * provision a seat's identity, and take one conversational turn. The SDK is
 * loaded lazily by a computed specifier so the rest of the app builds and runs
 * with the package absent — Mettara is optional, and only rooms configured for
 * it ever reach this module.
 *
 * The SDK ships as a tarball rather than from the public npm registry
 * (vendored under vendor/mettara-lib), so "not installed" is a
 * routine state that has to produce a readable sentence, not a stack trace.
 *
 * Docs: https://connect-a12e4c.gitlab.io/libraries/nodejs/
 */

import { readFile } from "node:fs/promises";
import { createLogger } from "../logger";
import { readMettaraConfig, sourceUserId, type MettaraConfig } from "./config";

const log = createLogger("Mettara");

/** npm package name of the SDK, as published in the tarball's manifest. */
export const SDK_PACKAGE = "mettara-lib";

export const SDK_MISSING_MESSAGE =
  "The Mettara SDK is not installed. Put mettara-lib.cjs in vendor/mettara-lib, " +
  "run pnpm install, then restart the server.";

/**
 * The slice of the SDK we depend on. Kept structural rather than imported so a
 * missing package is a runtime condition, not a compile error.
 */
interface EmbedToken {
  userId: string;
  groupId: string;
}

interface Conversation {
  id: string;
}

interface SentMessage {
  content: string;
}

export interface Sdk {
  EmbedClient: new (
    apiSecret: string,
    baseUrl: string,
    platformId: string,
  ) => {
    getToken(
      sourceUserId: string,
      sourceGroupId: string,
      sourceGroupName: string,
      name: string,
      email: string,
    ): Promise<EmbedToken>;
  };
  /** Takes the same raw platform API key as EmbedClient, then the base URL. */
  MettaraClient: new (
    apiKey: string,
    baseUrl?: string,
  ) => {
    createConversation(
      groupId: string,
      userId: string,
      aiTechnicalName: string,
      name?: string,
    ): Promise<Conversation>;
    sendMessage(
      conversationId: string,
      groupId: string,
      userId: string,
      content: string,
      fileIds?: string[],
    ): Promise<SentMessage>;
    uploadFile(groupId: string, file: Uint8Array, filename: string): Promise<{ id: string }>;
    listAis?(groupId: string): Promise<Array<{ technical_name?: string; display_name?: string }>>;
  };
}

let sdkPromise: Promise<Sdk | null> | null = null;

async function importSdk(): Promise<Sdk | null> {
  try {
    // A computed specifier: TypeScript must not try to resolve a package that
    // is legitimately absent, and Next must not try to bundle it.
    const specifier = SDK_PACKAGE;
    const mod: Record<string, unknown> = await import(/* webpackIgnore: true */ specifier);
    const sdk = ((mod as { default?: unknown }).default ?? mod) as Sdk;
    if (!sdk?.EmbedClient || !sdk?.MettaraClient) {
      log.error(`${SDK_PACKAGE} loaded but does not export EmbedClient/MettaraClient`);
      return null;
    }
    return sdk;
  } catch (err) {
    log.warn(`${SDK_PACKAGE} unavailable: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/**
 * How the SDK is obtained. Swappable so tests can exercise a real turn
 * without the tarball, which is distributed privately and is not on npm.
 */
let sdkLoader: () => Promise<Sdk | null> = importSdk;

/** Loads the SDK once. Resolves to null when the package is not installed. */
export function loadSdk(): Promise<Sdk | null> {
  if (!sdkPromise) sdkPromise = sdkLoader();
  return sdkPromise;
}

/** Test seam: supply a stand-in SDK, or pass nothing to restore the real one. */
export function setSdkLoader(loader?: () => Promise<Sdk | null>) {
  sdkLoader = loader ?? importSdk;
  sdkPromise = null;
}

/** Test seam: forget the cached SDK so a later load re-resolves. */
export function resetSdkCache() {
  sdkPromise = null;
}

export interface MettaraTurn {
  /** Seat name, used as the Mettara display name and identity key. */
  seatLabel?: string;
  /** Bridge session key — one per seat conversation. */
  sessionKey: string;
  /** The task or chat message from the room. */
  message: string;
  /** Rendered seat personality and company briefing. */
  personality: string;
  /** Existing Mettara conversation id, when this seat has spoken before. */
  conversationId?: string;
  /** AI technical name chosen in the HUD, if any. */
  aiName?: string;
  /** Files that came with the task, to upload and hand over with the message. */
  attachments?: { name: string; path: string }[];
}

export interface MettaraReply {
  text: string;
  /** Conversation id to resume on this seat's next turn. */
  conversationId: string;
}

/**
 * Where the gateway mounts what the SDK asks for. The SDK builds
 * `/v1/conversations…` and `/embed/token`; Mettara's API gateway serves them
 * at `/api/v1/conversations…` and `/api/v1/embed/token` (see its
 * /openapi.json). METTARA_BASE_URL stays the plain host; the prefixes are
 * added here, one per client.
 */
export function apiBase(config: Pick<MettaraConfig, "baseUrl">): string {
  return `${config.baseUrl.replace(/\/$/, "")}/api`;
}

export function embedBase(config: Pick<MettaraConfig, "baseUrl">): string {
  return `${apiBase(config)}/v1`;
}

/**
 * Identity is per seat, so each worker holds its own thread of conversation on
 * Mettara's side. Tokens are cheap but not free; cache them for the life of
 * the process.
 */
const tokenCache = new Map<string, Promise<EmbedToken>>();

export function resetIdentityCache() {
  tokenCache.clear();
}

function identityFor(
  sdk: Sdk,
  config: MettaraConfig,
  userId: string,
  displayName: string,
): Promise<EmbedToken> {
  const cached = tokenCache.get(userId);
  if (cached) return cached;
  const embed = new sdk.EmbedClient(config.apiSecret, embedBase(config), config.platformId);
  const pending = embed
    .getToken(userId, config.groupId, config.groupName, displayName, `${userId}@watercooler.local`)
    .catch((err: unknown) => {
      // A failed provisioning must not poison the cache — the next turn should
      // be free to try again once the secret or the network is fixed.
      tokenCache.delete(userId);
      throw err;
    });
  tokenCache.set(userId, pending);
  return pending;
}

/**
 * Runs one turn against Mettara.
 *
 * The first turn for a seat creates a conversation and prepends the seat's
 * personality, mirroring how the Claude CLI takes a system prompt on the run
 * that starts a session and resumes silently thereafter.
 */
export async function runMettaraTurn(turn: MettaraTurn): Promise<MettaraReply> {
  const config = readMettaraConfig();
  if (!config) throw new Error("Mettara is not configured on this server.");

  const sdk = await loadSdk();
  if (!sdk) throw new Error(SDK_MISSING_MESSAGE);

  const userId = sourceUserId(turn.seatLabel, turn.sessionKey);
  const displayName = turn.seatLabel ?? "WaterCooler agent";
  const token = await identityFor(sdk, config, userId, displayName);

  const client = new sdk.MettaraClient(config.apiSecret, apiBase(config));

  let conversationId = turn.conversationId;
  let opening = turn.message;
  if (!conversationId) {
    const created = await client.createConversation(
      token.groupId,
      token.userId,
      turn.aiName ?? config.defaultAiName,
      displayName,
    );
    conversationId = created.id;
    // Mettara has no separate system-prompt field, so the briefing rides in
    // front of the first message of the conversation.
    opening = `${turn.personality}\n\n${turn.message}`;
    log.info(`Opened Mettara conversation ${conversationId} for ${displayName}`);
  }

  // Files ride with the message, uploaded to the group first.
  const fileIds: string[] = [];
  for (const file of turn.attachments ?? []) {
    const bytes = new Uint8Array(await readFile(file.path));
    const uploaded = await client.uploadFile(token.groupId, bytes, file.name);
    fileIds.push(uploaded.id);
  }

  const reply = await client.sendMessage(
    conversationId,
    token.groupId,
    token.userId,
    opening,
    fileIds.length ? fileIds : undefined,
  );
  return { text: reply.content ?? "", conversationId };
}
