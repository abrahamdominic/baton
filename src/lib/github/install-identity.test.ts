import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `registerInstallation` used to accept `{ accountLogin }` from its caller, and
 * the install callback passed the signed-in user's own login. That mattered
 * because `myInstallations` authorizes repository visibility on
 * `OR: [{ userId }, { accountLogin: user.login }]` — so overwriting
 * `accountLogin` granted the caller read AND write access to the victim
 * installation's repositories while locking the real owner out.
 *
 * GitHub is the only authority for an account's identity, so the override was
 * removed rather than merely stopped being called. These tests pin that.
 */

const prismaMock = {
  appInstallation: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { findFirst: vi.fn() },
  repo: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  repoSetting: { upsert: vi.fn() },
};

const appsMock = {
  getInstallation: vi.fn(),
  listReposAccessibleToInstallation: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/github/app", () => ({
  getAppOctokit: () => ({ rest: { apps: appsMock } }),
  getInstallationOctokit: async () => ({ rest: { apps: appsMock } }),
}));

const VICTIM = "user_victim";
const INSTALL_ID = 4242;

beforeEach(() => {
  vi.clearAllMocks();
  appsMock.getInstallation.mockResolvedValue({
    data: {
      id: INSTALL_ID,
      account: { login: "real-victim-org", type: "Organization" },
      target_type: "organization",
      app_id: 1,
    },
  });
  appsMock.listReposAccessibleToInstallation.mockResolvedValue({
    data: { repositories: [] },
    headers: {},
  });
  prismaMock.appInstallation.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: "row-1", ...create }),
  );
  prismaMock.repo.updateMany.mockResolvedValue({ count: 0 });
});

describe("registerInstallation identity", () => {
  it("uses GitHub's accountLogin, not any caller-supplied value", async () => {
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: VICTIM });
    prismaMock.user.findFirst.mockResolvedValue(null);

    const { registerInstallation } = await import("./install");
    const info = await registerInstallation(INSTALL_ID);

    expect(info.accountLogin).toBe("real-victim-org");
    expect(info.accountType).toBe("Organization");

    const arg = prismaMock.appInstallation.upsert.mock.calls[0][0] as {
      update: { accountLogin: string; accountType: string; userId: string | null };
    };
    expect(arg.update.accountLogin).toBe("real-victim-org");
    expect(arg.update.userId).toBe(VICTIM);
  });

  it("preserves an existing explicit owner link", async () => {
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: VICTIM });
    prismaMock.user.findFirst.mockResolvedValue({ id: "someone-else" });

    const { registerInstallation } = await import("./install");
    await registerInstallation(INSTALL_ID);

    const arg = prismaMock.appInstallation.upsert.mock.calls[0][0] as {
      update: { userId: string | null };
    };
    expect(arg.update.userId).toBe(VICTIM);
  });

  it("does not let a same-named local user hijack an owned installation", async () => {
    // An attacker who signed in with the same GitHub login as the account owner
    // must not gain the installation's repository access.
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: VICTIM });
    prismaMock.user.findFirst.mockResolvedValue({ id: "attacker-same-login" });

    const { registerInstallation } = await import("./install");
    await registerInstallation(INSTALL_ID);

    const arg = prismaMock.appInstallation.upsert.mock.calls[0][0] as {
      update: { userId: string | null };
    };
    expect(arg.update.userId).toBe(VICTIM);
  });

  it("links by account login only when unowned", async () => {
    prismaMock.appInstallation.findUnique.mockResolvedValue({ userId: null });
    prismaMock.user.findFirst.mockResolvedValue({ id: "org-owner" });

    const { registerInstallation } = await import("./install");
    await registerInstallation(INSTALL_ID);

    const arg = prismaMock.appInstallation.upsert.mock.calls[0][0] as {
      update: { userId: string | null };
    };
    expect(arg.update.userId).toBe("org-owner");
  });
});

describe("registerInstallation signature", () => {
  it("accepts no identity overrides", async () => {
    const { registerInstallation } = await import("./install");
    // Compile-time guard: reintroducing an `opts.accountLogin` override is a
    // type error, so it cannot be reintroduced silently.
    // @ts-expect-error accountLogin must never be caller-supplied
    void registerInstallation(INSTALL_ID, { accountLogin: "attacker" });
    expect(registerInstallation.length).toBe(1);
  });
});
