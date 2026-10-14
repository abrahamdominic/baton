import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as installRoute } from "@/app/install/route";
import { GET as loginRoute } from "@/app/auth/login/route";
import { GET as authCallbackRoute } from "@/app/auth/callback/route";
import { GET as installCallbackRoute } from "@/app/auth/install/callback/route";
import { config } from "@/lib/env-boot";
import { rateLimiter } from "@/lib/rate-limit";

import type * as SessionModule from "@/lib/auth/session";

// CI checks out the repository without a local `.env` (it is gitignored), so the
// OAuth client credentials are pinned here. `isGitHubConfigured` requires both a
// client id and secret; when they are absent the login route redirects to
// `/?oauth_config=1` instead of GitHub and these tests fail only in CI.
// `vi.hoisted` runs before the route imports above are evaluated, so the config
// module sees these values on first load.
vi.hoisted(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID ||= "test-oauth-client-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET ||= "test-oauth-client-secret";
});

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>();
  return {
    ...actual,
    currentUser: vi.fn(),
  };
});

import { currentUser } from "@/lib/auth/session";

describe("GET /install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users directly to the GitHub App installations page (never to OAuth authorize)", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const req = new NextRequest("https://baton-xi.vercel.app/install");
    const res = await installRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain("https://github.com/apps/");
    expect(location).toContain("/installations/new");
    expect(location).not.toContain("/login/oauth/authorize");
    expect(location).not.toContain("/auth/login");
  });

  /**
   * The install state must be an unguessable nonce bound to this browser, not an
   * identifier. It used to be `uid:<userId>`, which put an internal id in
   * GitHub's query string (and every referrer log downstream) and told the
   * callback nothing it could not already see in the session.
   */
  it("redirects authenticated users to the GitHub App installations page with an opaque state", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: "usr_abc123",
      githubId: 12345,
      login: "testuser",
      name: "Test User",
      email: "test@example.com",
      avatarUrl: null,
      role: "user",
      suspendedAt: null,
      preferredLanguage: null,
    });

    const req = new NextRequest("https://baton-xi.vercel.app/install");
    const res = await installRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain("https://github.com/apps/");
    expect(location).toContain("/installations/new?state=");
    expect(location).not.toContain("usr_abc123");
    expect(location).not.toContain("uid%3A");
    // The nonce is echoed to GitHub in the clear and stored only as a hash.
    const state = new URL(location as string).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state).not.toBe("");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("baton_install_state=");
    expect(setCookie).not.toContain(`${state}=`);
    expect(setCookie).toContain("HttpOnly");
  });
});

describe("GET /auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The limiter is process-wide, so a test that exhausts one IP's budget would
    // otherwise leak into every later test in this file.
    rateLimiter.reset("auth:login:203.0.113.7");
    rateLimiter.reset("auth:login:198.51.100.4");
  });

  it("initiates the GitHub OAuth App flow with client_id, state cookie, and PKCE", async () => {
    const req = new NextRequest("https://baton-xi.vercel.app/auth/login?next=/dashboard");
    const res = await loginRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();

    const parsed = new URL(location!);
    expect(parsed.origin).toBe("https://github.com");
    expect(parsed.pathname).toBe("/login/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe(config.GITHUB_OAUTH_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://baton-xi.vercel.app/auth/callback");
    expect(parsed.searchParams.get("scope")).toBe("read:user user:email");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");

    // Cookies set for CSRF and PKCE
    const cookies = res.cookies.getAll();
    expect(cookies.some((c) => c.name === "baton_oauth_state")).toBe(true);
    expect(cookies.some((c) => c.name === "baton_oauth_verifier")).toBe(true);
  });
});

describe("GET /auth/login rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.reset("auth:login:203.0.113.7");
  });

  it("stops handing out PKCE verifiers once a client exhausts its budget", async () => {
    const url = "https://baton-xi.vercel.app/auth/login";
    let limited: string | null = null;

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const req = new NextRequest(url, { headers: { "x-forwarded-for": "203.0.113.7" } });
      const res = await loginRoute(req);
      const location = res.headers.get("location") ?? "";
      if (location.includes("reason=rate_limited")) {
        limited = location;
        // A limited request must not mint a verifier or a state cookie, or the
        // limit buys nothing.
        expect(res.cookies.getAll()).toHaveLength(0);
        break;
      }
    }

    expect(limited).toBeTruthy();
    expect(limited!).toContain("oauth_error=1");
  });

  it("counts each client address separately", async () => {
    const req = new NextRequest("https://baton-xi.vercel.app/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    for (let i = 0; i < 21; i += 1) await loginRoute(req);

    const exhausted = await loginRoute(req);
    expect(exhausted.headers.get("location")).toContain("reason=rate_limited");

    // A different address behind the same proxy must be unaffected.
    const other = new NextRequest("https://baton-xi.vercel.app/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    const res = await loginRoute(other);
    expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize");
  });
});

describe("GET /auth/callback rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.reset("auth:callback:203.0.113.9");
  });

  it("refuses to exchange codes for a client that floods the callback", async () => {
    const url = "https://baton-xi.vercel.app/auth/callback?code=abc&state=xyz";
    let limited = false;

    for (let attempt = 0; attempt < 70; attempt += 1) {
      const req = new NextRequest(url, { headers: { "x-forwarded-for": "203.0.113.9" } });
      const res = await authCallbackRoute(req);
      if ((res.headers.get("location") ?? "").includes("reason=rate_limited")) {
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
  });
});

describe("GET /auth/callback (forwarding install calls)", () => {
  it("forwards GitHub App installation setup requests to /auth/install/callback", async () => {
    const req = new NextRequest(
      "https://baton-xi.vercel.app/auth/callback?installation_id=98765&setup_action=install",
    );
    const res = await authCallbackRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();

    const parsed = new URL(location!);
    expect(parsed.pathname).toBe("/auth/install/callback");
    expect(parsed.searchParams.get("installation_id")).toBe("98765");
    expect(parsed.searchParams.get("setup_action")).toBe("install");
  });
});

describe("GET /auth/install/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to /auth/login preserving the installation_id", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const req = new NextRequest(
      "https://baton-xi.vercel.app/auth/install/callback?installation_id=98765&setup_action=install",
    );
    const res = await installCallbackRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();

    const parsed = new URL(location!);
    expect(parsed.pathname).toBe("/auth/login");
    const nextParam = parsed.searchParams.get("next");
    expect(nextParam).toContain("/auth/install/callback");
    expect(nextParam).toContain("installation_id=98765");
  });

  it("carries the install state through sign-in so the returning callback can verify it", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const req = new NextRequest(
      "https://baton-xi.vercel.app/auth/install/callback?installation_id=98765&state=nonce-abc",
    );
    const res = await installCallbackRoute(req);
    const nextParam = new URL(res.headers.get("location")!).searchParams.get("next") ?? "";
    expect(nextParam).toContain("state=nonce-abc");
  });

  /**
   * The regression: a signed-in browser hitting the callback with no `state` used
   * to skip CSRF validation entirely (`if (stateParam) { ... }`), so the
   * attribution write ran on an attacker-chosen `installation_id`. It must not
   * reach the database, and the user gets bounced back through /install to pick
   * up a valid state.
   */
  it("refuses a signed-in request that presents no install state", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: "usr_victim",
      githubId: 12345,
      login: "victim",
      name: null,
      email: null,
      avatarUrl: null,
      role: "user",
      suspendedAt: null,
      preferredLanguage: null,
    });

    const req = new NextRequest(
      "https://baton-xi.vercel.app/auth/install/callback?installation_id=1&setup_action=install",
    );
    const res = await installCallbackRoute(req);

    const location = res.headers.get("location")!;
    // No state at all -> restart the flow so the user can get a valid one.
    expect(new URL(location).pathname).toBe("/install");
    expect(location).not.toContain("installed=1");
  });

  it("refuses a signed-in request whose install state does not match the cookie", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: "usr_victim",
      githubId: 12345,
      login: "victim",
      name: null,
      email: null,
      avatarUrl: null,
      role: "user",
      suspendedAt: null,
      preferredLanguage: null,
    });
    cookieJar.set("baton_install_state", "a".repeat(64));

    const req = new NextRequest(
      "https://baton-xi.vercel.app/auth/install/callback?installation_id=1&state=forged",
    );
    const res = await installCallbackRoute(req);

    const parsed = new URL(res.headers.get("location")!);
    expect(parsed.pathname).toBe("/dashboard");
    expect(parsed.searchParams.get("reason")).toBe("state_mismatch");
  });
});
