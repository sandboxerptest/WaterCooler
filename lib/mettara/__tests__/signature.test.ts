import { describe, it, expect } from "vitest";
import {
  bodyDigest,
  canonicalString,
  NonceStore,
  sign,
  verifySignedRequest,
  CONTENT_SHA256_HEADER,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "../signature";

const SECRET = "platform-secret";
const NOW = 1_700_000_000_000;

function signedRequest(overrides: Partial<Record<string, string>> = {}, body = '{"name":"greet"}') {
  const timestamp = overrides.timestamp ?? String(Math.floor(NOW / 1000));
  const nonce = overrides.nonce ?? "nonce-1";
  const path = overrides.path ?? "/api/mettara/tools";
  const method = overrides.method ?? "POST";
  const digest = bodyDigest(body);
  const signature =
    overrides.signature ??
    sign(SECRET, canonicalString({ method, path, timestamp, nonce, digest }));
  return {
    method,
    path,
    body,
    headers: {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
      [NONCE_HEADER]: nonce,
      [CONTENT_SHA256_HEADER]: digest,
    } as Record<string, string | undefined>,
  };
}

describe("mettara signature", () => {
  it("accepts a correctly signed request", () => {
    const result = verifySignedRequest(signedRequest(), {
      secret: SECRET,
      nonces: new NonceStore(),
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("signs the exact canonical string from the docs", () => {
    expect(
      canonicalString({
        method: "POST",
        path: "/mettara?x=1",
        timestamp: "123",
        nonce: "abc",
        digest: "ZGln",
      }),
    ).toBe("POST\n/mettara?x=1\n123\nabc\nZGln");
  });

  it("rejects a wrong secret", () => {
    const result = verifySignedRequest(signedRequest(), {
      secret: "other-secret",
      nonces: new NonceStore(),
      now: NOW,
    });
    expect(result.reason).toBe("bad-signature");
    expect(result.status).toBe(401);
  });

  it("rejects a tampered body", () => {
    const req = signedRequest();
    req.body = '{"name":"drop_everything"}';
    const result = verifySignedRequest(req, {
      secret: SECRET,
      nonces: new NonceStore(),
      now: NOW,
    });
    expect(result.reason).toBe("bad-digest");
  });

  it("rejects a request signed for a different path", () => {
    const req = signedRequest();
    req.path = "/api/mettara/tools?tampered=1";
    const result = verifySignedRequest(req, {
      secret: SECRET,
      nonces: new NonceStore(),
      now: NOW,
    });
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects a stale timestamp outside the five minute window", () => {
    const result = verifySignedRequest(signedRequest(), {
      secret: SECRET,
      nonces: new NonceStore(),
      now: NOW + 6 * 60 * 1000,
    });
    expect(result.reason).toBe("stale-timestamp");
  });

  it("accepts a timestamp inside the window on either side", () => {
    const nonces = new NonceStore();
    expect(
      verifySignedRequest(signedRequest({ nonce: "a" }), {
        secret: SECRET,
        nonces,
        now: NOW - 60_000,
      }).ok,
    ).toBe(true);
    expect(
      verifySignedRequest(signedRequest({ nonce: "b" }), {
        secret: SECRET,
        nonces,
        now: NOW + 60_000,
      }).ok,
    ).toBe(true);
  });

  it("rejects a replayed nonce", () => {
    const nonces = new NonceStore();
    const req = signedRequest();
    expect(verifySignedRequest(req, { secret: SECRET, nonces, now: NOW }).ok).toBe(true);
    const replay = verifySignedRequest(req, { secret: SECRET, nonces, now: NOW });
    expect(replay.reason).toBe("replayed-nonce");
  });

  it("does not let a forged request burn the nonce of the genuine one", () => {
    const nonces = new NonceStore();
    const forged = signedRequest({ signature: "not-a-signature" });
    expect(verifySignedRequest(forged, { secret: SECRET, nonces, now: NOW }).ok).toBe(false);
    // The real request carries the same nonce and must still be accepted.
    expect(verifySignedRequest(signedRequest(), { secret: SECRET, nonces, now: NOW }).ok).toBe(
      true,
    );
  });

  it("forgets nonces once their window has passed", () => {
    const nonces = new NonceStore(1_000);
    expect(nonces.accept("n", NOW)).toBe(true);
    expect(nonces.accept("n", NOW + 500)).toBe(false);
    expect(nonces.accept("n", NOW + 2_000)).toBe(true);
    expect(nonces.size).toBe(1);
  });

  it("rejects a request with no signature headers", () => {
    const req = signedRequest();
    delete req.headers[SIGNATURE_HEADER];
    const result = verifySignedRequest(req, { secret: SECRET, nonces: new NonceStore(), now: NOW });
    expect(result.reason).toBe("missing-headers");
  });

  it("accepts millisecond timestamps as well as seconds", () => {
    const req = signedRequest({ timestamp: String(NOW) });
    expect(
      verifySignedRequest(req, { secret: SECRET, nonces: new NonceStore(), now: NOW }).ok,
    ).toBe(true);
  });
});
