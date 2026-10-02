import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

/**
 * Regression cover for the cross-tenant installation takeover class of bugs.
 *
 * `installation_id` reaches these routes as a query parameter and installation
 * ids are sequential integers, so it is never proof of authority. Each test
 * below failed before the corresponding fix.
 */

const prismaMock = {
  appInstallation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  repo: { upsert: vi.fn() },
  delivery: { findUnique: vi.fn() },
  job: { findFirst: vi.fn() },
};

const sessionMock = {
  currentUser: vi.fn(),
  createSession: vi.fn(),
  defaultRoleForLogin: vi.fn(() => "user"),
  SESSION_COOKIE: "baton_session",
  SESSION_COOKIE_BASE_OPTS: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
  SESSION_TTL_MS: 1000,
};

const enqueueMock = vi.fn();
const registerMock = vi.fn();
const fetchUserInstallationsMock = vi.fn();
const exchangeAppCodeMock = vi.fn();
const fetchGitHubUserMock = vi.fn();
const exchangeUserCodeMock = vi.fn();

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => sessionMock);
vi.mock("@/lib/engine/jobs", () => ({ enqueueInstallRegister: enqueueMock }));
vi.mock("@/lib/github/install", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/github/install");
  return { ...actual, registerInstallation: registerMock };
});
vi.mock("@/lib/auth/github-oauth", () => ({
  exchangeGitHubAppCode: exchangeAppCodeMock,
  fetchGitHubUser: fetchGitHubUserMock,
  fetchUserInstallations: fetchUserInstallationsMock,
  githubAppUserIssuer: () => "https://github.com/apps/baton",
  isAppUserOAuthConfigured: () => true,
  exchangeGitHubCode: exchangeUserCodeMock,
}));

const VICTIM = "user_victim";
const ATTACKER = "user_attacker";
const VICTIM_INSTALL = 4242;

function makeRequest(query: Record<string, string>) {
  const url = new URL("https://baton-xi.vercel.app/auth/install/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { host: "baton-xi.vercel.app" } });
}

async function loadCallback() {
  return import("@/app/auth/install/callback/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.currentUser.mockResolvedValue({
    id: ATTACKER,
    login: "attacker",
    role: "user",
  });
  prismaMock.appInstallation.create.mockResolvedValue({});
  prismaMock.user.upsert.mockResolvedValue({
    id: ATTACKER,
    login: "attacker",
    githubId: 7,
    role: "user",
    name: null,
    email: null,
    avatarUrl: null,
  });
  prismaMock.appInstallation.update.mockResolvedValue({});
  enqueueMock.mockResolvedValue({ id: "job-1" });
  // GitHub reports which account the installation is really on. For a personal
  // installation that login must match the caller; the callback uses it as an
  // ownership proof independent of the App user token.
  registerMock.mockResolvedValue({
    installationId: VICTIM_INSTALL,
    accountLogin: "attacker",
    accountType: "User",
    repositories: [],
  });
  fetchUserInstallationsMock.mockResolvedValue([]);
});

const INSTALL_STATE = "s3cret-install-nonce";
const STATE_HASH = createHash("sha256").update(INSTALL_STATE).digest("hex");

describe("install callback CSRF (state)", () => {
  /**
   * The state is now an opaque nonce hashed into a cookie rather than
   * `uid:<userId>`. Two things change: the internal id stops travelling through
   * GitHub's query string, and a *missing* state is now a failure rather than a
   * skipped check — the old `if (stateParam) { ... }` meant an attacker could
   * omit it entirely and the attribution write ran anyway.
   */
  it("rejects a state that does not match this browser's cookie", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: VICTIM });

    const res = await GET(
      makeRequest({
        installation_id: String(VICTIM_INSTALL),
        setup_action: "install",
        state: "forged-state",
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("reason=state_mismatch");
    expect(prismaMock.appInstallation.create).not.toHaveBeenCalled();
    expect(prismaMock.appInstallation.update).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no state at all and no App user token", async () => {
    const { GET } = await loadCallback();
    cookieJar.delete("baton_install_state");
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });

    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), setup_action: "install" }),
    );

    // A direct install from GitHub's own app page has no state; bounce the user
    // back through /install so they pick up a valid one.
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/install");
    expect(prismaMock.appInstallation.create).not.toHaveBeenCalled();
    expect(prismaMock.appInstallation.update).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("accepts a state matching this browser's cookie", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });

    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), state: INSTALL_STATE }),
    );

    expect(res.headers.get("location")).toBe(
      "https://baton-xi.vercel.app/dashboard?installed=1",
    );
    expect(prismaMock.appInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: ATTACKER } }),
    );
  });

  it("consumes the state so a replayed callback cannot reuse it", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });

    await GET(makeRequest({ installation_id: String(VICTIM_INSTALL), state: INSTALL_STATE }));
    const second = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL + 1), state: INSTALL_STATE }),
    );

    expect(second.headers.get("location")).toContain("reason=state_mismatch");
  });
});

describe("install callback ownership", () => {
  it("never re-attributes an installation owned by someone else", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: VICTIM });

    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), state: INSTALL_STATE }),
    );

    expect(res.headers.get("location")).toContain("reason=already_claimed");
    expect(prismaMock.appInstallation.update).not.toHaveBeenCalled();
    // Previously it logged a warning and then went on to enqueue + register on
    // the victim's behalf anyway.
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("requires GitHub to confirm the user administers the installation", async () => {
    sessionMock.currentUser.mockResolvedValue(null);
    exchangeAppCodeMock.mockResolvedValue({ access_token: "ghu_attacker" });
    fetchGitHubUserMock.mockResolvedValue({ id: 7, login: "attacker", name: null, email: null, avatar_url: null });
    sessionMock.createSession.mockResolvedValue({ token: "tok", expiresAt: new Date(Date.now() + 1000) });
    // GitHub says the user administers some OTHER installation only.
    fetchUserInstallationsMock.mockResolvedValue([9999]);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });

    const { GET } = await loadCallback();
    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), code: "app-code", iss: "https://github.com/apps/baton" }),
    );

    expect(res.headers.get("location")).toContain("reason=not_admin");
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("only registers installations GitHub reported as administered", async () => {
    sessionMock.currentUser.mockResolvedValue(null);
    exchangeAppCodeMock.mockResolvedValue({ access_token: "ghu_attacker" });
    fetchGitHubUserMock.mockResolvedValue({ id: 7, login: "attacker", name: null, email: null, avatar_url: null });
    sessionMock.createSession.mockResolvedValue({ token: "tok", expiresAt: new Date(Date.now() + 1000) });
    fetchUserInstallationsMock.mockResolvedValue([VICTIM_INSTALL, 8888]);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });

    const { GET } = await loadCallback();
    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), code: "app-code", iss: "https://github.com/apps/baton" }),
    );

    expect(res.headers.get("location")).toContain("installed=1");
    // The callback's own installation plus the one extra GitHub vouched for.
    expect(registerMock.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([
      VICTIM_INSTALL,
      8888,
    ]);
  });
});

/**
 * A second ownership proof that works with no App user token: GitHub reports
 * which account the installation lives on, and a *user* installation lives on
 * exactly one person's account. If it is not the caller's, the caller is trying
 * to claim somebody else's installation — the state cookie only proves the
 * browser started an install flow, not which installation it may attribute.
 */
describe("install callback account proof", () => {
  it("releases the attribution when GitHub says the installation belongs to another login", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });
    registerMock.mockResolvedValue({
      installationId: VICTIM_INSTALL,
      accountLogin: "victim",
      accountType: "User",
      repositories: [],
    });

    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), state: INSTALL_STATE }),
    );

    expect(res.headers.get("location")).toContain("reason=account_mismatch");
    expect(prismaMock.appInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: null } }),
    );
  });

  it("accepts an organization installation, which has no personal login to compare", async () => {
    const { GET } = await loadCallback();
    cookieJar.set("baton_install_state", STATE_HASH);
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });
    registerMock.mockResolvedValue({
      installationId: VICTIM_INSTALL,
      accountLogin: "acme-inc",
      accountType: "Organization",
      repositories: [],
    });

    const res = await GET(
      makeRequest({ installation_id: String(VICTIM_INSTALL), state: INSTALL_STATE }),
    );

    expect(res.headers.get("location")).toBe(
      "https://baton-xi.vercel.app/dashboard?installed=1",
    );
  });
});
