import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Regression cover for two dashboard-correctness bugs that a mocked Prisma
 * could not have caught, because both are about which rows actually reach the
 * result set.
 *
 * 1. `yourMove` returned every open, non-draft PR on the user's repositories —
 *    including other people's PRs that are not waiting on the user — while the
 *    UI called it "Your Move". The primary queue was a mislabelled list.
 * 2. `recentActivity` applied `take: limit` to ALL action rows and then filtered
 *    to meaningful ones in JavaScript. The worker writes a `pr_snapshot` row on
 *    every PR refresh, so the newest N rows were almost entirely noise and the
 *    feed came back empty despite real activity further back.
 */

const { prisma } = await import("@/lib/db");
const { yourMove, recentActivity } = await import("@/lib/queries/dashboard");

const stamp = `dash${Date.now().toString(36)}`;
let githubIdSeq = 1_000_000_000 + Math.floor(Math.random() * 300_000_000);
const nextGithubId = () => ++githubIdSeq;

type TestUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  suspendedAt: Date | null;
};

const ME: TestUser = {
  id: "",
  githubId: 0,
  login: `${stamp}-me`,
  name: null,
  email: null,
  avatarUrl: null,
  role: "user",
  suspendedAt: null,
};
const COLLEAGUE: TestUser = { ...ME, githubId: 0, login: `${stamp}-them` };

let repoId = "";
let otherRepoId = "";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

async function makePr(
  repo: string,
  number: number,
  author: string,
  state: string,
  opts: { reviewers?: string[]; inStateHours?: number } = {},
) {
  return prisma.pullRequest.create({
    data: {
      repoId: repo,
      number,
      title: `PR ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      authorLogin: author,
      headRef: `feature/${number}`,
      headSha: "abc123",
      baseRef: "main",
      githubState: "OPEN",
      state,
      stateEnteredAt: hoursAgo(opts.inStateHours ?? 1),
      githubUpdatedAt: hoursAgo(0),
      requestedReviewersJson: JSON.stringify(opts.reviewers ?? []),
    },
  });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { login: { startsWith: "dash" } } });

  const me = await prisma.user.create({
    data: { githubId: nextGithubId(), login: ME.login, role: "user" },
  });
  const them = await prisma.user.create({
    data: { githubId: nextGithubId(), login: COLLEAGUE.login, role: "user" },
  });
  ME.id = me.id;
  ME.githubId = me.githubId;
  COLLEAGUE.id = them.id;
  COLLEAGUE.githubId = them.githubId;

  const install = await prisma.appInstallation.create({
    data: {
      installationId: 7_100_000 + Math.floor(Math.random() * 80_000),
      accountLogin: ME.login,
      accountType: "User",
      userId: ME.id,
    },
    select: { id: true },
  });
  const repo = await prisma.repo.create({
    data: {
      installationId: install.id,
      repoId: BigInt(7_700_000 + Math.floor(Math.random() * 200_000)),
      owner: `${stamp}-owner`,
      name: "alpha",
      fullName: `${stamp}-owner/alpha`,
      defaultBranch: "main",
      isPrivate: false,
      enabled: true,
    },
    select: { id: true },
  });
  repoId = repo.id;

  // A second repo the user can see, used for the cross-repo activity checks.
  const repo2 = await prisma.repo.create({
    data: {
      installationId: install.id,
      repoId: BigInt(7_900_000 + Math.floor(Math.random() * 80_000)),
      owner: `${stamp}-owner`,
      name: "beta",
      fullName: `${stamp}-owner/beta`,
      defaultBranch: "main",
      isPrivate: false,
      enabled: true,
    },
    select: { id: true },
  });
  otherRepoId = repo2.id;
});

afterAll(async () => {
  if (repoId) await prisma.repo.deleteMany({ where: { id: repoId } });
  if (otherRepoId) await prisma.repo.deleteMany({ where: { id: otherRepoId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: "dash" } } });
});

describe("yourMove returns work actually assigned to the viewer", () => {
  it("only returns the viewer's own actionable PRs and reviews requested of them", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });

    // Mine, and I have to act: in each author-act state.
    await makePr(repoId, 1, ME.login, "changes_required", { inStateHours: 30 });
    await makePr(repoId, 2, ME.login, "ci_failing", { inStateHours: 2 });
    await makePr(repoId, 3, ME.login, "conflicts", { inStateHours: 1 });
    // Mine, but nothing is required of me: teammates own these.
    await makePr(repoId, 4, ME.login, "awaiting_review");
    await makePr(repoId, 5, ME.login, "ready_to_merge");
    // Someone else's, and I was asked to review.
    await makePr(repoId, 6, COLLEAGUE.login, "awaiting_review", { reviewers: [ME.login] });
    // Someone else's, and I was NOT asked to review.
    await makePr(repoId, 7, COLLEAGUE.login, "awaiting_review", { reviewers: [COLLEAGUE.login] });
    // Someone else's, not mine to fix.
    await makePr(repoId, 8, COLLEAGUE.login, "changes_requested");

    const mine = await yourMove(ME);
    const numbers = mine.map((i) => i.number).sort((a, b) => a - b);

    expect(numbers).toEqual([1, 2, 3, 6]);
  });

  it("reports whole hours, not fractional floats", async () => {
    const items = await yourMove(ME);
    for (const item of items) {
      expect(Number.isInteger(item.hoursInState)).toBe(true);
      expect(item.hoursInState).toBeGreaterThanOrEqual(0);
    }
  });

  it("orders the most stalled actionable work first within a state", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    await makePr(repoId, 10, ME.login, "changes_required", { inStateHours: 1 });
    await makePr(repoId, 11, ME.login, "changes_required", { inStateHours: 48 });
    await makePr(repoId, 12, ME.login, "changes_required", { inStateHours: 5 });

    const items = await yourMove(ME);
    expect(items.map((i) => i.number)).toEqual([11, 12, 10]);
  });

  it("matches requested reviewers case-insensitively and via objects", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    await makePr(repoId, 20, COLLEAGUE.login, "awaiting_review", {
      reviewers: [ME.login.toUpperCase()],
    });
    const items = await yourMove(ME);
    expect(items.map((i) => i.number)).toEqual([20]);

    // GitHub also returns reviewer objects (`{ login, ... }`) in some payload
    // shapes, so both encodings must be honoured.
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    await prisma.pullRequest.create({
      data: {
        repoId: repoId,
        number: 23,
        title: "object reviewers",
        url: "https://github.com/o/r/pull/23",
        authorLogin: COLLEAGUE.login,
        headRef: "f/23",
        headSha: "sha",
        baseRef: "main",
        githubState: "OPEN",
        state: "awaiting_review",
        stateEnteredAt: hoursAgo(1),
        githubUpdatedAt: hoursAgo(0),
        requestedReviewersJson: JSON.stringify([
          { login: ME.login, type: "User" },
          { login: COLLEAGUE.login, type: "User" },
        ]),
      },
    });
    const withObjects = await yourMove(ME);
    expect(withObjects.map((i) => i.number)).toEqual([23]);
  });

  it("ignores malformed reviewer JSON instead of dropping the PR", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    await prisma.pullRequest.create({
      data: {
        repoId: repoId,
        number: 21,
        title: "bad reviewers",
        url: "https://github.com/o/r/pull/21",
        authorLogin: COLLEAGUE.login,
        headRef: "f/21",
        headSha: "sha",
        baseRef: "main",
        githubState: "OPEN",
        state: "awaiting_review",
        stateEnteredAt: hoursAgo(1),
        githubUpdatedAt: hoursAgo(0),
        requestedReviewersJson: "{not json",
      },
    });
    await makePr(repoId, 22, ME.login, "changes_required");
    const items = await yourMove(ME);
    // The unparseable row is not credited to the viewer, and the real one is.
    expect(items.map((i) => i.number)).toEqual([22]);
  });
});

describe("recentActivity is not starved by snapshot noise", () => {
  it("finds real activity buried under many no-op snapshots", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    const pr = await makePr(repoId, 30, ME.login, "changes_required");

    // One real state change, buried under a large volume of no-op snapshots and
    // a large volume of never-displayable action types.
    await prisma.action.create({
      data: {
        repoId: repoId,
        prId: pr.id,
        type: "pr_snapshot",
        targetJson: JSON.stringify({ state: "awaiting_review", prevState: "changes_required" }),
        createdAt: hoursAgo(30),
      },
    });
    for (let i = 0; i < 120; i++) {
      await prisma.action.create({
        data: {
          repoId: repoId,
          prId: pr.id,
          type: "pr_snapshot",
          targetJson: JSON.stringify({ state: "changes_required", prevState: "changes_required" }),
          createdAt: hoursAgo(i % 20),
        },
      });
    }
    for (let i = 0; i < 120; i++) {
      await prisma.action.create({
        data: {
          repoId: repoId,
          prId: pr.id,
          type: "status_comment",
          targetJson: "{}",
          createdAt: hoursAgo(i % 20),
        },
      });
    }

    const activity = await recentActivity(ME, 50);
    const changes = activity.filter((a) => a.type === "state_change");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]?.prNumber).toBe(30);
    // Nothing from a type that can never be displayed.
    expect(activity.every((a) => a.type === "nudge" || a.type === "state_change")).toBe(true);
  });

  it("respects the limit and returns newest first", async () => {
    await prisma.pullRequest.deleteMany({ where: { repoId: { in: [repoId, otherRepoId] } } });
    const pr = await makePr(repoId, 31, ME.login, "ci_failing");
    for (let i = 0; i < 8; i++) {
      await prisma.action.create({
        data: {
          repoId: repoId,
          prId: pr.id,
          type: "nudge",
          targetJson: "{}",
          createdAt: hoursAgo(i),
        },
      });
    }
    const activity = await recentActivity(ME, 3);
    expect(activity).toHaveLength(3);
    for (let i = 1; i < activity.length; i++) {
      expect(activity[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        activity[i]!.createdAt.getTime(),
      );
    }
  });
});
