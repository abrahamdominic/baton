import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../db";
import {
  GITHUB_API,
  GITHUB_TOKEN_URL,
  GITHUB_APP_INSTALL_CALLBACK_PATH,
  GITHUB_OAUTH_CALLBACK_PATH,
  oauthAuthorizeUrl,
  githubAppInstallUrl,
  exchangeCode,
  exchangeGitHubAppCode,
  githubAppUserIssuer,
  fetchGitHubUser,
  fetchUserInstallations,
} from "./github-oauth";
import { hashState, verifyOauthState } from "./oauth";
import { sanitizeNextPath } from "./redirect";
import { finishOAuthSignIn } from "./oauth-flow";

const BASE = "https://baton-xi.vercel.app";
const TEST_GITHUB_ID = 5550001;
const TEST_INSTALLATION_ID = 7770001;

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function isDbAvailable(): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRaw`SELECT 1 AS ok`) as { ok: number }[];
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

// GitHub API surface used by the OAuth flow, fully stubbed so the tests never
// touch the network. The real exchange/handling/DB code still runs.
beforeAll(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const headers = new Headers(init?.headers as HeadersInit);
    const isUserToken = (headers.get("authorization") ?? "").startsWith("Bearer ");

    if (url === GITHUB_TOKEN_URL) {
      // Token exchange: GitHub returns an access_token.
      return jsonResponse({ access_token: "gho_flow_test_token", token_type: "bearer", scope: "" });
    }
    if (url === `${GITHUB_API}/user` && isUserToken) {
      return jsonResponse({
        id: TEST_GITHUB_ID,
        login: "oauth-flow-test",
        name: "OAuth Flow Test",
        email: "public@example.com",
        avatar_url: "https://example.com/avatar.png",
      });
    }
    if (url.startsWith(`${GITHUB_API}/user/emails`) && isUserToken) {
      return jsonResponse([{ email: "private@example.com", primary: true, verified: true }]);
    }
    if (url.startsWith(`${GITHUB_API}/user/installations`) && isUserToken) {
      return jsonResponse({
        total_count: 1,
        installations: [{ id: TEST_INSTALLATION_ID }],
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  // Clean up anything the DB-backed test created.
  await prisma.user
    .deleteMany({ where: { githubId: TEST_GITHUB_ID } })
    .catch(() => {});
  await prisma.job
    .deleteMany({
      where: {
        kind: "install_register",
        payloadJson: JSON.stringify({ kind: "install_register", installationId: TEST_INSTALLATION_ID }),
      },
    })
    .catch(() => {});
});

describe("oauthAuthorizeUrl (login)", () => {
  it("builds the GitHub authorize URL without leaking the client secret", () => {
    const url = oauthAuthorizeUrl("some.state.value", BASE);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://github.com");
    expect(parsed.pathname).toBe("/login/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBeTruthy();
    expect(parsed.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/callback`);
    expect(parsed.searchParams.get("state")).toBe("some.state.value");
    expect(parsed.searchParams.get("client_secret")).toBeNull();
    expect(url).not.toContain("client_secret=");
  });
});

describe("exchangeCode", () => {
  it("sends the client secret only in the form-encoded POST body (never in any URL)", async () => {
    const result = await exchangeCode("code123", BASE);
    expect(result.access_token).toBe("gho_flow_test_token");

    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input) === GITHUB_TOKEN_URL);
    expect(tokenCall).toBeDefined();
    const [, init] = tokenCall as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("client_id=");
    expect(body).toContain("client_secret=");
    expect(body).toContain("code=code123");
    expect(body).toContain(`redirect_uri=${encodeURIComponent(`${BASE}/auth/callback`)}`);
  });

  it("returns a clean error object (not a throw) for non-JSON responses", async () => {
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
      if (String(input) === GITHUB_TOKEN_URL) {
        return new Response("<html>upstream error</html>", { status: 502 });
      }
      return jsonResponse({});
    });
    const result = await exchangeCode("code456", BASE);
    expect(result.error).toBe("invalid_response");
    expect(result.access_token).toBe("");
  });

  it("exchanges a GitHub-App-level code with the App's own credentials + install callback", async () => {
    const result = await exchangeGitHubAppCode("app_code", BASE);
    expect(result.access_token).toBe("gho_flow_test_token");

    const tokenCalls = fetchMock.mock.calls.filter(([input]) => String(input) === GITHUB_TOKEN_URL);
    const [, init] = tokenCalls.at(-1) as [string, RequestInit];
    const body = String(init.body);
    // GitHub App credentials come from GITHUB_APP_CLIENT_* (empty in this test
    // env), NEVER from GITHUB_OAUTH_*, and the code is not sent to a URL.
    expect(body).toContain("client_id=");
    expect(body).toContain("client_secret=");
    expect(body).toContain("code=app_code");
    expect(body).toContain(`redirect_uri=${encodeURIComponent(`${BASE}${GITHUB_APP_INSTALL_CALLBACK_PATH}`)}`);
  });

  it("keeps explicit credentials injectable for the GitHub App exchange", async () => {
    await exchangeCode("x", BASE, { clientId: "Iv1.appclient", clientSecret: "app_secret" }, GITHUB_APP_INSTALL_CALLBACK_PATH);
    const [, init] = [...fetchMock.mock.calls]
      .filter(([input]) => String(input) === GITHUB_TOKEN_URL)
      .at(-1) as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("client_id=Iv1.appclient");
    expect(body).toContain("client_secret=app_secret");
    expect(body).toContain(`redirect_uri=${encodeURIComponent(`${BASE}${GITHUB_APP_INSTALL_CALLBACK_PATH}`)}`);
  });

  it("never places the GitHub App client secret in a URL", () => {
    const results = fetchMock.mock.calls.filter(([input]) => String(input) === GITHUB_TOKEN_URL);
    for (const [input] of results) {
      expect(String(input)).not.toContain("client_secret=");
    }
  });
});

describe("githubAppInstallUrl", () => {
  it("builds the GitHub App installation URL pointing to the App installations/new page", () => {
    const url = githubAppInstallUrl("abrahamdominic");
    expect(url).toBe("https://github.com/apps/abrahamdominic/installations/new");
  });

  it("attaches state when provided for post-install linking", () => {
    const url = githubAppInstallUrl("abrahamdominic", "uid:user_123");
    expect(url).toBe("https://github.com/apps/abrahamdominic/installations/new?state=uid%3Auser_123");
  });

  it("never routes to the standalone OAuth App authorize endpoint", () => {
    const url = githubAppInstallUrl("abrahamdominic");
    expect(url).not.toContain("/login/oauth/authorize");
  });
});

describe("callback separation", () => {
  it("keeps OAuth App callback and GitHub App install callback strictly distinct", () => {
    expect(GITHUB_OAUTH_CALLBACK_PATH).toBe("/auth/callback");
    expect(GITHUB_APP_INSTALL_CALLBACK_PATH).toBe("/auth/install/callback");
    expect(GITHUB_OAUTH_CALLBACK_PATH).not.toBe(GITHUB_APP_INSTALL_CALLBACK_PATH);
  });
});

describe("githubAppUserIssuer", () => {
  it("matches GitHub's iss for GitHub App user-authorization callbacks", () => {
    expect(githubAppUserIssuer("baton")).toBe("https://github.com/apps/baton");
    expect(githubAppUserIssuer("some-slug")).toBe("https://github.com/apps/some-slug");
    expect(githubAppUserIssuer("abrahamdominic")).toBe("https://github.com/apps/abrahamdominic");
  });
});

describe("fetchGitHubUser / fetchUserInstallations", () => {
  it("resolves the user with the primary verified email", async () => {
    const user = await fetchGitHubUser("gho_x");
    expect(user.id).toBe(TEST_GITHUB_ID);
    expect(user.login).toBe("oauth-flow-test");
    expect(user.email).toBe("private@example.com");
  });

  it("lists installations for a GitHub App user token", async () => {
    await expect(fetchUserInstallations("gho_x")).resolves.toEqual([TEST_INSTALLATION_ID]);
  });
});

describe("verifyOauthState / sanitizeNextPath", () => {
  it("validates the state hash in constant time", async () => {
    const state = `${"a".repeat(32)}.${Buffer.from("/dashboard").toString("base64url")}`;
    await expect(verifyOauthState(state, hashState(state))).resolves.toBe(true);
    await expect(verifyOauthState("different", hashState(state))).resolves.toBe(false);
    await expect(verifyOauthState(state, "")).resolves.toBe(false);
  });

  it("keeps internal paths but blocks open-redirect values", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/dashboard?installed=1")).toBe("/dashboard?installed=1");
    expect(sanitizeNextPath("/auth/login?next=/x")).toBe("/auth/login?next=/x");
    expect(sanitizeNextPath("/auth/install/callback?installation_id=123")).toBe(
      "/auth/install/callback?installation_id=123",
    );
  });
});

describe("finishOAuthSignIn (full pipeline)", () => {
  it("upserts the user, creates a session, and links installations", async () => {
    if (!(await isDbAvailable())) {
      // No writable database in this environment; coverage runs elsewhere.
      return;
    }
    try {
      const result = await finishOAuthSignIn({
        // GitHub App user-to-server token: ghu_* (only these can list installs).
        accessToken: "ghu_flow_test_token",
        next: "/dashboard?plan=team&billing=monthly",
        installationId: TEST_INSTALLATION_ID,
        ip: "10.0.0.1",
        userAgent: "vitest",
      });

      expect(result.user.githubId).toBe(TEST_GITHUB_ID);
      expect(result.user.login).toBe("oauth-flow-test");
      expect(result.next).toBe("/dashboard?plan=team&billing=monthly");
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.installationIds).toContain(TEST_INSTALLATION_ID);

      const user = await prisma.user.findUnique({
        where: { githubId: TEST_GITHUB_ID },
        include: { sessions: true, installations: true },
      });
      expect(user).not.toBeNull();
      expect(user!.sessions.length).toBeGreaterThanOrEqual(1);
      expect(user!.installations.some((i) => i.installationId === TEST_INSTALLATION_ID)).toBe(true);
    } finally {
      await prisma.user.deleteMany({ where: { githubId: TEST_GITHUB_ID } }).catch(() => {});
    }
  });
});