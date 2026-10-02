import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Sign-out is a state change, so it is a POST.
 *
 * As a GET it was forgeable from anywhere: `<img src="https://baton/auth/logout">`
 * signs a visitor out. That alone is a nuisance, but the redirect target was also
 * attacker-supplied, which turned it into a phishing primitive — authenticate a
 * victim on github.com, bounce them through a logout into an attacker-shaped URL
 * with the session already gone. `SameSite=Lax` does not help, because a
 * top-level navigation still sends the cookie.
 */

vi.mock("server-only", () => ({}));

const revokeSession = vi.hoisted(() => vi.fn(async () => {}));
const clearSessionCookie = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/auth/session", () => ({
  revokeSession,
  clearSessionCookie,
  readSessionCookie: async () => "session-token",
  SESSION_COOKIE: "baton_session",
  SESSION_COOKIE_BASE_OPTS: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  },
}));

const check = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/rate-limit", () => ({ rateLimiter: { check } }));

const logged = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/logger", () => ({
  logger: {
    info: () => {},
    warn: (_msg: string, fields?: Record<string, unknown>) => void logged.push(fields ?? {}),
    error: () => {},
  },
}));

import { GET, POST } from "./route";

const HOST = "baton-xi.vercel.app";

function post(headers: Record<string, string> = {}) {
  return new NextRequest(`https://${HOST}/auth/logout`, {
    method: "POST",
    headers: { host: HOST, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(true);
  logged.length = 0;
});

describe("GET /auth/logout", () => {
  it("does not sign anyone out", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(revokeSession).not.toHaveBeenCalled();
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session, clears the cookie, and returns to the app", async () => {
    const res = await POST(post());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`https://${HOST}/`);
    expect(revokeSession).toHaveBeenCalledWith("session-token");
    expect(clearSessionCookie).toHaveBeenCalled();
    expect(res.cookies.get("baton_session")?.value).toBe("");
  });

  it("refuses a cross-origin POST", async () => {
    const res = await POST(post({ origin: "https://attacker.test" }));
    expect(res.status).toBe(403);
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it("refuses an origin that merely shares a prefix with the host", async () => {
    // A substring comparison would call this same-origin.
    const res = await POST(post({ origin: `https://${HOST}.attacker.test` }));
    expect(res.status).toBe(403);
  });

  it("refuses an unparseable origin instead of throwing", async () => {
    const res = await POST(post({ origin: "not-a-url" }));
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin POST", async () => {
    const res = await POST(post({ origin: `https://${HOST}` }));
    expect(res.status).toBe(307);
  });

  it("rate limits by client address", async () => {
    check.mockReturnValue(false);
    const res = await POST(post());
    expect(res.status).toBe(429);
    expect(revokeSession).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith(expect.stringContaining("auth:logout:"), 20, 60_000);
  });

  it("does not let `next` become an off-site redirect", async () => {
    // Sanitize's fallback, not the attacker's host.
    const req = new NextRequest(`https://${HOST}/auth/logout?next=https://attacker.test/steal`, {
      method: "POST",
      headers: { host: HOST },
    });
    const res = await POST(req);
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`);
  });

  it("does not let `next` smuggle a protocol-relative URL", async () => {
    const req = new NextRequest(`https://${HOST}/auth/logout?next=//attacker.test/steal`, {
      method: "POST",
      headers: { host: HOST },
    });
    const res = await POST(req);
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`);
  });

  it("does not let `next` inject a second header with a newline", async () => {
    const req = new NextRequest(
      `https://${HOST}/auth/logout?next=%2Fdashboard%0d%0aX-Injected%3A%201`,
      { method: "POST", headers: { host: HOST } },
    );
    const res = await POST(req);
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`);
    expect(res.headers.get("x-injected")).toBeNull();
  });

  it("keeps a same-site `next` path", async () => {
    const req = new NextRequest(`https://${HOST}/auth/logout?next=/dashboard`, {
      method: "POST",
      headers: { host: HOST },
    });
    const res = await POST(req);
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`);
  });
});
