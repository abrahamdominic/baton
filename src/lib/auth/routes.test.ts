import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as installRoute } from "@/app/install/route";
import { GET as loginRoute } from "@/app/auth/login/route";
import { GET as authCallbackRoute } from "@/app/auth/callback/route";
import { GET as installCallbackRoute } from "@/app/auth/install/callback/route";
import { config } from "@/lib/env-boot";

import type * as SessionModule from "@/lib/auth/session";

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

  it("redirects authenticated users to the GitHub App installations page with user state", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: "usr_abc123",
      githubId: 12345,
      login: "testuser",
      name: "Test User",
      email: "test@example.com",
      avatarUrl: null,
      role: "user",
      suspendedAt: null,
    });

    const req = new NextRequest("https://baton-xi.vercel.app/install");
    const res = await installRoute(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain("https://github.com/apps/");
    expect(location).toContain("/installations/new?state=uid%3Ausr_abc123");
  });
});

describe("GET /auth/login", () => {
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
});
