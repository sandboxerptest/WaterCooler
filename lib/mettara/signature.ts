/**
 * Inbound webhook verification for Mettara Connect tool calls.
 *
 * When a Mettara AI invokes a tool we have registered, it POSTs to this server
 * signed with the platform API secret. Verification is three independent
 * checks — body digest, clock skew, nonce replay — and only then the HMAC, so
 * a tampered request fails on the specific thing that is wrong.
 *
 * Docs: https://connect-a12e4c.gitlab.io/inbound-webhooks/
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SIGNATURE_HEADER = "x-mettara-signature";
export const TIMESTAMP_HEADER = "x-mettara-timestamp";
export const NONCE_HEADER = "x-mettara-nonce";
export const CONTENT_SHA256_HEADER = "x-mettara-content-sha256";

/** Mettara's default tolerance for clock drift between the two servers. */
export const DEFAULT_SKEW_SECONDS = 300;

/** How long a nonce stays remembered. Matches the skew window it guards. */
export const DEFAULT_NONCE_TTL_MS = DEFAULT_SKEW_SECONDS * 2 * 1000;

export type VerifyFailure =
  | "missing-headers"
  | "bad-digest"
  | "stale-timestamp"
  | "replayed-nonce"
  | "bad-signature";

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyFailure;
  /** HTTP status to answer with when verification failed. */
  status?: number;
  detail?: string;
}

export interface SignedRequest {
  method: string;
  /** Path including query string, exactly as signed. */
  path: string;
  /** Raw request body, before any JSON parsing. */
  body: string;
  headers: Record<string, string | undefined>;
}

/** base64(SHA256(body)) — the digest Mettara sends and signs over. */
export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("base64");
}

/**
 * The canonical string Mettara signs:
 *
 *     METHOD\n/path?query\ntimestamp\nnonce\nbase64(SHA256(body))
 */
export function canonicalString(parts: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  digest: string;
}): string {
  return [parts.method.toUpperCase(), parts.path, parts.timestamp, parts.nonce, parts.digest].join(
    "\n",
  );
}

export function sign(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("base64");
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Remembers recently seen nonces so a captured request cannot be replayed
 * inside the skew window. Entries expire on read, which is enough for the
 * handful of tool calls a room generates — there is no sweeper to leak.
 */
export class NonceStore {
  private seen = new Map<string, number>();

  constructor(private ttlMs: number = DEFAULT_NONCE_TTL_MS) {}

  /** True when the nonce is fresh; false when it has already been used. */
  accept(nonce: string, now: number): boolean {
    this.prune(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }

  private prune(now: number) {
    for (const [nonce, expires] of this.seen) {
      if (expires <= now) this.seen.delete(nonce);
    }
  }

  get size() {
    return this.seen.size;
  }
}

export interface VerifyOptions {
  secret: string;
  nonces: NonceStore;
  /** Milliseconds since epoch; injected so tests need no clock control. */
  now: number;
  skewSeconds?: number;
}

export function verifySignedRequest(req: SignedRequest, options: VerifyOptions): VerifyResult {
  const signature = req.headers[SIGNATURE_HEADER];
  const timestamp = req.headers[TIMESTAMP_HEADER];
  const nonce = req.headers[NONCE_HEADER];
  if (!signature || !timestamp || !nonce) {
    return {
      ok: false,
      reason: "missing-headers",
      status: 401,
      detail: "Missing signature headers",
    };
  }

  // The digest header is advisory — the signature covers the digest we compute
  // ourselves — but a mismatch means the body was altered in transit and is
  // worth naming separately from a bad signature.
  const digest = bodyDigest(req.body);
  const claimed = req.headers[CONTENT_SHA256_HEADER];
  if (claimed && claimed !== digest) {
    return { ok: false, reason: "bad-digest", status: 400, detail: "Body digest mismatch" };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "stale-timestamp", status: 401, detail: "Unreadable timestamp" };
  }
  const skew = (options.skewSeconds ?? DEFAULT_SKEW_SECONDS) * 1000;
  // Timestamps are seconds since epoch; accept milliseconds too rather than
  // rejecting a signer that sends them.
  const sentMs = Math.abs(sentAt) > 1e11 ? sentAt : sentAt * 1000;
  if (Math.abs(options.now - sentMs) > skew) {
    return {
      ok: false,
      reason: "stale-timestamp",
      status: 401,
      detail: "Timestamp outside window",
    };
  }

  const expected = sign(
    options.secret,
    canonicalString({ method: req.method, path: req.path, timestamp, nonce, digest }),
  );
  if (!signaturesMatch(signature, expected)) {
    return { ok: false, reason: "bad-signature", status: 401, detail: "Signature mismatch" };
  }

  // Replay is checked last so a forged request never consumes a nonce and
  // locks out the genuine one that follows it.
  if (!options.nonces.accept(nonce, options.now)) {
    return { ok: false, reason: "replayed-nonce", status: 401, detail: "Nonce already used" };
  }

  return { ok: true };
}
