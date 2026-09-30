import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * End-to-end cover for the workspace invitation path (new.md).
 *
 * The reported failure was "An error occurred in the Server Components render"
 * on every invitation, for every user. Two independent defects produced it:
 *
 *  1. The seat check counted the workspace *owner* as a member, so a free
 *     workspace (0 seats) evaluated `1 >= 0` and rejected the invite before
 *     writing anything.
 *  2. The action `throw`ed to report business rules, and Next.js replaces a
 *     thrown server-action message with generic production text -- so the user
 *     could never learn the real reason.
 *
 * These tests drive the real action against a real database, with only the
 * three things that genuinely cannot run in a test stubbed: the session cookie,
 * the Supabase billing ledger, and the GitHub API.
 */

const { prisma } = await import("@/lib/db");
const { normalizeLogin } = await import("@/lib/workspace-utils");

const stamp = `inv${Date.now().toString(36)}`;
const installationId = 9_100_000 + (Date.now() % 800_000);

let owner: { id: string; login: string; githubId: number };
let teamId: string;
let sessionUser: { id: string; login: string };

/** Plan the fake billing ledger will report for the owner. */
let planLimits: { maxMembers: number } | null = null;
/** 404 => "no such GitHub user". Anything else => the account exists. */
let githubStatus = 200;
let githubCalls: string[] = [];

// The app marks server-only modules with the `server-only` package, which
// throws on import outside a React Server Component graph. A vitest module graph
// is neither, so the guard has to be neutralised to import the action at all.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/session", () => ({
  currentUser: async () => sessionUser,
}));

vi.mock("@/lib/billing/subscriptions", () => ({
  getCurrentSubscription: async (userId: string) => {
    if (!planLimits) return null;
    return {
      id: `sub_${userId}`,
      user_id: userId,
      plan_id: "plan_team_default",
      status: "active",
      plan: { id: "plan_team_default", name: "Team", limits: planLimits },
    };
  },
  listSubscriptionsForUser: async (userId: string) => {
    if (!planLimits) return [];
    return [
      {
        id: `sub_${userId}`,
        user_id: userId,
        plan_id: "plan_team_default",
        status: "active",
      },
    ];
  },
}));

vi.mock("@/lib/github/app", () => ({
  getInstallationToken: async () => "ghs_test_token",
}));

vi.mock("@/lib/queries/dashboard", () => ({
  myInstallations: async () => [
    { installationId, accountLogin: "acme", repos: [] },
  ],
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

beforeAll(async () => {
  // Only the GitHub user lookup is intercepted. Everything else still runs for
  // real, so the test exercises the actual Prisma writes.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("api.github.com/users/")) {
      const login = decodeURIComponent(url.split("/users/")[1] ?? "");
      githubCalls.push(login);
      if (githubStatus === 404) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
        });
      }
      if (githubStatus !== 200) {
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: githubStatus,
        });
      }
      return new Response(JSON.stringify({ login, id: 4242 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected network call in test: ${url}`);
  }) as typeof fetch;

  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
  const githubId = Math.floor(Math.random() * 1e9) + 7e8;
  owner = await prisma.user.create({
    data: { githubId, login: `${stamp}-owner` },
  });
  sessionUser = { id: owner.id, login: owner.login };

  const team = await prisma.team.create({
    data: {
      ownerId: owner.id,
      name: "Acme",
      slug: `acme-${stamp.slice(0, 6)}`,
    },
    select: { id: true },
  });
  teamId = team.id;

  // The owner is a member of their own team. This row is what the old cap
  // check was counting against the plan's seat allowance.
  await prisma.teamMember.create({
    data: { teamId, userId: owner.id, role: "owner" },
  });
});

afterAll(async () => {
  await prisma.team.deleteMany({ where: { id: teamId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

/** The handle from the bug report. */
const DCOHCO = "dconco";

describe("inviteTeamMember", () => {
  it("invites a real GitHub user on a workspace whose plan includes seats", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    githubStatus = 200;
    githubCalls = [];

    const res = await inviteTeamMember({
      teamId,
      githubLogin: DCOHCO,
      role: "member",
    });

    expect(res).toEqual({ ok: true, login: DCOHCO });
    const row = await prisma.teamInvite.findFirstOrThrow({
      where: { teamId, githubLogin: DCOHCO },
    });
    expect(row.status).toBe("pending");
    expect(row.role).toBe("member");
    expect(row.invitedById).toBe(owner.id);
    expect(row.token).toBeTruthy();
    // The account was actually looked up, not assumed from the regex.
    expect(githubCalls).toContain(DCOHCO);
  });

  it("does not throw for a failing outcome, so no error can reach the user masked", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    githubStatus = 404;
    // A rejected promise is what Next.js rewrites into "An error occurred in
    // the Server Components render". Every branch must resolve to a value.
    const res = await inviteTeamMember({
      teamId,
      githubLogin: "ghost-account",
      role: "member",
    });
    expect(res).toBeTypeOf("object");
    expect(res.ok).toBe(false);
    githubStatus = 200;
  });

  it("reports a nonexistent GitHub account without writing an invite", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    githubStatus = 404;

    const res = await inviteTeamMember({
      teamId,
      githubLogin: "dconco-nope",
      role: "member",
    });
    expect(res).toEqual({ ok: false, code: "github_user_not_found" });
    expect(
      await prisma.teamInvite.count({
        where: { teamId, githubLogin: "dconco-nope" },
      }),
    ).toBe(0);
    githubStatus = 200;
  });

  it("still invites when GitHub is down, because an outage is not a bad username", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    // 403 here is what a rate limit or expired token looks like: we do not
    // know whether the user exists, so we must not claim they do not.
    githubStatus = 403;

    const res = await inviteTeamMember({
      teamId,
      githubLogin: "octocat",
      role: "member",
    });
    expect(res).toEqual({ ok: true, login: "octocat" });
    githubStatus = 200;
  });

  it("refuses to send a second invite for the same person", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    githubStatus = 200;

    // "dconco" already has a pending invite from the first test.
    const res = await inviteTeamMember({
      teamId,
      githubLogin: DCOHCO,
      role: "admin",
    });
    expect(res).toEqual({ ok: false, code: "already_invited" });
  });

  it("recognises a lowercase, @-prefixed, or padded handle as the same person", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    for (const variant of ["@DConco", "  dconco  ", "DCONCO"]) {
      const res = await inviteTeamMember({
        teamId,
        githubLogin: variant,
        role: "member",
      });
      expect(res).toEqual({ ok: false, code: "already_invited" });
    }
  });

  it("rejects a login that cannot exist", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    for (const bad of [
      "has space",
      "-leading-hyphen",
      "trailing-",
      "a".repeat(40),
    ]) {
      const res = await inviteTeamMember({
        teamId,
        githubLogin: bad,
        role: "member",
      });
      expect(res).toEqual({ ok: false, code: "invalid_login" });
    }
  });

  it("refuses a self-invitation", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    const res = await inviteTeamMember({
      teamId,
      githubLogin: owner.login,
      role: "member",
    });
    expect(res).toEqual({ ok: false, code: "self_invite" });
  });

  it("invites dconco on a FREE workspace, which now includes seats", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    const { FREE_MAX_MEMBERS } = await import("@/lib/billing/entitlement-core");
    // The bug report asked for dconco to be invitable. At 0 free seats that was
    // impossible, and the refusal was indistinguishable from the broken cap
    // check because both arrived as the same opaque server error.
    planLimits = null;
    githubStatus = 200;
    const fresh = await prisma.team.create({
      data: {
        ownerId: owner.id,
        name: "Free Team",
        slug: `ft-${stamp.slice(0, 6)}`,
      },
      select: { id: true },
    });
    const freeTeamId = fresh.id;
    await prisma.teamMember.create({
      data: { teamId: freeTeamId, userId: owner.id, role: "owner" },
    });

    const res = await inviteTeamMember({
      teamId: freeTeamId,
      githubLogin: DCOHCO,
      role: "member",
    });
    expect(res).toEqual({ ok: true, login: DCOHCO });
    const row = await prisma.teamInvite.findFirstOrThrow({
      where: { teamId: freeTeamId, githubLogin: DCOHCO },
    });
    expect(row.status).toBe("pending");

    // And it stops at the free ceiling instead of failing open. dconco already
    // holds one of the seats, so only the remainder fit.
    for (let i = 0; i < FREE_MAX_MEMBERS - 1; i += 1) {
      const r = await inviteTeamMember({
        teamId: freeTeamId,
        githubLogin: `filler-${i}`,
        role: "member",
      });
      expect(r.ok).toBe(true);
    }
    const overflow = await inviteTeamMember({
      teamId: freeTeamId,
      githubLogin: "one-too-many",
      role: "member",
    });
    expect(overflow).toMatchObject({
      ok: false,
      code: "no_seats",
      planName: "Free",
    });

    await prisma.team.deleteMany({ where: { id: freeTeamId } });
  });

  it("refuses rather than guessing when the billing ledger cannot be read", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    const subscriptions = await import("@/lib/billing/subscriptions");
    // Simulate the fail-closed path: the paid lookup returns null while the
    // corroborating list call throws, which is what a Supabase outage looks like.
    const spy = vi
      .spyOn(subscriptions, "listSubscriptionsForUser")
      .mockRejectedValueOnce(
        new Error("subscriptions.list failed: connection reset"),
      );
    const getSpy = vi
      .spyOn(subscriptions, "getCurrentSubscription")
      .mockRejectedValue(
        new Error("subscriptions.list failed: connection reset"),
      );

    const res = await inviteTeamMember({
      teamId,
      githubLogin: "someone-else",
      role: "member",
    });
    // Blaming the customer with "you are on the Free plan" during our own outage
    // is the failure this guards.
    expect(res).toEqual({ ok: false, code: "plan_unavailable" });

    spy.mockRestore();
    getSpy.mockRestore();
  });

  it("refuses a non-member", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    const saved = sessionUser;
    sessionUser = { id: "not-a-real-user-id", login: "stranger" };
    const res = await inviteTeamMember({
      teamId,
      githubLogin: "dconco",
      role: "member",
    });
    expect(res).toEqual({ ok: false, code: "not_a_member" });
    sessionUser = saved;
  });

  it("refuses a plain member who is not an admin", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    const member = await prisma.user.create({
      data: {
        githubId: Math.floor(Math.random() * 1e9) + 7e8,
        login: `${stamp}-member`,
      },
    });
    await prisma.teamMember.create({
      data: { teamId, userId: member.id, role: "member" },
    });

    const saved = sessionUser;
    sessionUser = { id: member.id, login: member.login };
    const res = await inviteTeamMember({
      teamId,
      githubLogin: "dconco",
      role: "member",
    });
    expect(res).toEqual({ ok: false, code: "not_an_admin" });
    sessionUser = saved;
  });

  it("tells a member apart from a pending invite", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    planLimits = { maxMembers: 25 };
    const member = await prisma.user.create({
      data: {
        githubId: Math.floor(Math.random() * 1e9) + 7e8,
        login: `${stamp}-already`,
      },
    });
    await prisma.teamMember.create({
      data: { teamId, userId: member.id, role: "admin" },
    });

    const res = await inviteTeamMember({
      teamId,
      githubLogin: member.login,
      role: "member",
    });
    expect(res).toEqual({ ok: false, code: "already_member" });
  });

  it("normalises the handle the same way the lookup does", async () => {
    // Guards the contract between the action and the stored row.
    expect(normalizeLogin("@DConco ")).toBe("dconco");
    expect(DCOHCO).toBe(normalizeLogin(`@${DCOHCO}`));
  });

  it("seats the full number of members the plan sold, owner not counted", async () => {
    const { inviteTeamMember } = await import("@/app/dashboard/team/actions");
    // A fresh 2-seat team. The owner is a member by construction but is not one
    // of the two seats, so both seats are free.
    const small = await prisma.team.create({
      data: {
        ownerId: owner.id,
        name: "Small",
        slug: `sm-${stamp.slice(0, 5)}`,
      },
      select: { id: true },
    });
    const smallId = small.id;
    await prisma.teamMember.create({
      data: { teamId: smallId, userId: owner.id, role: "owner" },
    });
    planLimits = { maxMembers: 2 };
    githubStatus = 200;

    const seats: string[] = [];
    for (const login of ["seat-one", "seat-two"]) {
      const res = await inviteTeamMember({
        teamId: smallId,
        githubLogin: login,
        role: "member",
      });
      expect(res.ok).toBe(true);
      seats.push(login);
    }
    expect(seats).toHaveLength(2);

    // The third invite is the one the old accounting refused: with the owner
    // counted, 2 + owner already looked like 3 occupied against a 2-seat plan.
    const third = await inviteTeamMember({
      teamId: smallId,
      githubLogin: "seat-three",
      role: "member",
    });
    expect(third).toMatchObject({ ok: false, code: "no_seats" });

    await prisma.team.deleteMany({ where: { id: smallId } });
  });
});
