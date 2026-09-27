import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Scheduled-endpoint authorization.
 *
 * `CRON_SECRET` gates the queue drain and the repository sweep. Both are
 * expensive fan-out operations: a sweep enumerates every connected repository
 * and refreshes every open PR, and a drain consumes GitHub API quota belonging
 * to our customers' installations. If these accepted anonymous requests, anyone
 * who learned the URL could drive them at will.
 *
 * The load-bearing case is "unset": the endpoints must refuse rather than fall
 * open, because that is exactly the state a fresh deployment is in.
 */

const CRON_SECRET = "s3cret-cron-value-long-enough";

function req(auth?: string): Request {
  return new Request("https://baton.test/api/cron/drain", {
    headers: auth ? { authorization: auth } : {},
  });
}

const SECRET_15 = "fifteen-char-key";

/** Authorize a candidate of arbitrary length against a fixed 15-byte secret. */
async function mod_isCronAuthorizedSafe(candidate: string): Promise<boolean> {
  const mod = await loadCronAuth(SECRET_15);
  return mod.isCronAuthorized(req(`Bearer ${candidate}`));
}

async function loadCronAuth(secret: string) {
  vi.resetModules();
  vi.doMock("@/lib/env-boot", () => ({
    config: { CRON_SECRET: secret },
    getConfig: () => ({ CRON_SECRET: secret }),
  }));
  return import("@/lib/cron-auth");
}

describe("cron endpoint authorization", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects every request when CRON_SECRET is unset (fails closed)", async () => {
    const mod = await loadCronAuth("");
    expect(mod.isCronConfigured()).toBe(false);
    expect(mod.cronMisconfigurationIssue()).toMatch(/not set/i);
    // The dangerous case: an unset secret must not mean "allow".
    expect(mod.isCronAuthorized(req())).toBe(false);
    expect(mod.isCronAuthorized(req("Bearer anything"))).toBe(false);
    expect(mod.isCronAuthorized(req(`Bearer ${CRON_SECRET}`))).toBe(false);
  });

  it("flags a short CRON_SECRET but still honours it", async () => {
    // Advisory, not enforced: refusing a 12-character secret would silently
    // break scheduling for an operator whose only mistake was picking a short
    // value. The weakness is surfaced in admin instead of failing closed.
    const mod = await loadCronAuth("short-secret");
    expect(mod.isCronConfigured()).toBe(false);
    expect(mod.cronMisconfigurationIssue()).toMatch(/16 characters/i);
    expect(mod.isCronAuthorized(req("Bearer short-secret"))).toBe(true);
    expect(mod.isCronAuthorized(req("Bearer wrong"))).toBe(false);
  });

  it("accepts only the exact bearer token", async () => {
    const mod = await loadCronAuth(CRON_SECRET);
    expect(mod.isCronConfigured()).toBe(true);
    expect(mod.cronMisconfigurationIssue()).toBeNull();

    expect(mod.isCronAuthorized(req(`Bearer ${CRON_SECRET}`))).toBe(true);
    // Scheme is case-insensitive per RFC 7235.
    expect(mod.isCronAuthorized(req(`bearer ${CRON_SECRET}`))).toBe(true);
    expect(mod.isCronAuthorized(req(`Bearer  ${CRON_SECRET}  `))).toBe(true);

    expect(mod.isCronAuthorized(req())).toBe(false);
    expect(mod.isCronAuthorized(req("Bearer "))).toBe(false);
    expect(mod.isCronAuthorized(req(CRON_SECRET))).toBe(false);
    expect(mod.isCronAuthorized(req("Basic abc"))).toBe(false);
    expect(mod.isCronAuthorized(req(`Bearer ${CRON_SECRET}x`))).toBe(false);
    expect(mod.isCronAuthorized(req(`Bearer ${CRON_SECRET.slice(0, -1)}`))).toBe(false);
    expect(mod.isCronAuthorized(req("Bearer " + "x".repeat(CRON_SECRET.length)))).toBe(false);
  });

  it("compares safely when the candidate has a different byte length", async () => {
    // timingSafeEqual throws on a length mismatch, so the guard must come first.
    // Every one of these is a wrong-length candidate against a 15-byte secret.
    for (const candidate of ["a", "ab", "a".repeat(14), "a".repeat(16), "a".repeat(64)]) {
      expect(await mod_isCronAuthorizedSafe(candidate)).toBe(false);
    }
  });
});
