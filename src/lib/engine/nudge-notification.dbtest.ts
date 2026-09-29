import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * End-to-end proof that a delivered reviewer nudge reaches the notification
 * inbox of the user it @-mentions.
 *
 * The nudge path is the product's headline automation, and until now nothing
 * asserted it could fire at all: the webhook DB test always processes a fresh
 * PR (stateActiveHours = 0), so the threshold gate never opens. This suite ages
 * a real PR row past `firstResponseHours` and drives the real `processPrRefresh`
 * against a real database.
 *
 * Runs as a `.dbtest.ts` file (serial vitest project, see `vitest.db.config.ts`).
 * Only the GitHub-HTTP modules are stubbed; Prisma, classification, the nudge
 * decision, the notification ledger, and the deep-link resolver are real.
 *
 * Requires the SQLite-mirrored schema:
 *   node scripts/gen-sqlite-schema.mjs
 *   npx prisma generate --schema prisma/schema.sqlite.prisma
 */

const INSTALLATION_ID = 5252;
const OWNER = "acme";
const REPO = "payments-api";
const REPO_FULL = `${OWNER}/${REPO}`;
const PR_NUMBER = 31;
const REVIEWER = "reviewer-1";

const posted: Array<{ kind: string; body?: string; state?: string }> = [];
let prSnapshot: unknown = null;

vi.mock("@/lib/env-boot", () => ({
  config: {
    SITE_URL: "https://baton.test",
    GITHUB_APP_WEBHOOK_SECRET: "e2e-webhook-secret",
    GITHUB_APP_SLUG: "abrahamdominic",
  },
  getConfig: () => ({ SITE_URL: "https://baton.test" }),
}));

vi.mock("@/lib/github/app", () => ({
  installationClients: async () => ({ gql: async () => ({}), rest: {} }),
  logRateLimit: () => {},
  getAppId: () => 777,
}));

vi.mock("@/lib/github/actions", () => ({
  createComment: async (
    _octokit: unknown,
    _owner: string,
    _repo: string,
    _prNumber: number,
    body: string,
  ) => {
    posted.push({ kind: "comment", body });
    return 424242;
  },
  upsertStatusComment: async (
    _octokit: unknown,
    _owner: string,
    _repo: string,
    _prNumber: number,
    body: string,
  ) => {
    posted.push({ kind: "status", body });
    return 848484;
  },
  syncStateLabel: async (
    _octokit: unknown,
    _owner: string,
    _repo: string,
    _prNumber: number,
    opts: { state: string },
  ) => {
    posted.push({ kind: "label", state: opts.state });
  },
}));

vi.mock("@/lib/github/queries", () => ({
  fetchPrSnapshot: async () => prSnapshot,
}));

const { prisma } = await import("@/lib/db");
const { processPrRefresh } = await import("./runner");
const { notificationHref } = await import("../notifications");

/** PR opened ten hours ago, review requested from `reviewer-1`, no reply. */
function snapshotAwaitingReviewLong() {
  return {
    input: {
      prNumber: PR_NUMBER,
      isDraft: false,
      githubState: "OPEN" as const,
      authorLogin: "dev-1",
      title: "Add idempotency keys",
      url: `https://github.com/${REPO_FULL}/pull/${PR_NUMBER}`,
      headRef: "feat/idempotency",
      headSha: "abc123",
      baseRef: "main",
      mergeable: "MERGEABLE" as const,
      reviewDecision: "REVIEW_REQUIRED" as const,
      createdAt: new Date(Date.now() - 10 * 3_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
      headPushedAt: new Date().toISOString(),
      labels: [] as string[],
      reviews: [],
      requestedReviewerLogins: [REVIEWER],
      requestedTeamSlugs: [] as string[],
      checks: [],
      now: new Date(),
    },
    rateLimitRemaining: 4000,
  };
}

describe("nudge delivery -> notification inbox (end to end)", () => {
  beforeEach(async () => {
    await prisma.pullRequest.deleteMany({});
    await prisma.action.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.repoSetting.deleteMany({});
    await prisma.repo.deleteMany({});
    await prisma.appInstallation.deleteMany({});
    await prisma.user.deleteMany({});
    posted.length = 0;

    await prisma.user.create({
      data: { githubId: 9101, login: REVIEWER },
    });
    await prisma.appInstallation.create({
      data: { installationId: INSTALLATION_ID, accountLogin: OWNER, accountType: "Organization" },
    });
    const repo = await prisma.repo.create({
      data: {
        installation: { connect: { installationId: INSTALLATION_ID } },
        repoId: 2001n,
        owner: OWNER,
        name: REPO,
        fullName: REPO_FULL,
        defaultBranch: "main",
        isPrivate: false,
        enabled: true,
      },
    });
    await prisma.repoSetting.create({
      data: {
        repoId: repo.id,
        nudgesEnabled: true,
        // Shorter than the ten-hour PR age so the threshold gate actually opens.
        firstResponseHours: 6,
        maxNudgesPerState: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("notifies only the human the nudge actually @-mentions", async () => {
    prSnapshot = snapshotAwaitingReviewLong();

    // First pass classifies the PR. `stateEnteredAt` is now, so activeHours = 0
    // and no nudge fires yet — exactly what happens for a newly opened PR.
    const first = await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    expect(first.state).toBe("awaiting_review");
    expect(first.nudged).toBe(false);
    expect(await prisma.notification.count()).toBe(0);

    // Age the PR past firstResponseHours (as a real ten-hour-old sweep would),
    // then re-run the refresh.
    const pr = await prisma.pullRequest.findFirstOrThrow({ where: { number: PR_NUMBER } });
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { stateEnteredAt: new Date(Date.now() - 10 * 3_600_000) },
    });

    const second = await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    expect(second.nudged).toBe(true);
    expect(second.actions).toContain("nudge");

    const comment = posted.find((p) => p.kind === "comment");
    expect(comment).toBeDefined();
    expect(comment!.body).toContain(`@${REVIEWER}`);

    // The @-mentioned reviewer gets one inbox notification for the PR.
    const notif = await prisma.notification.findFirst({
      where: { user: { login: REVIEWER } },
    });
    expect(notif).not.toBeNull();
    expect(notif!.type).toBe("review");
    expect(notif!.resourceType).toBe("pr");
    expect(notif!.resourceId).toBe(pr.id);
    expect(notif!.actorId).toBeNull();
    const ctx = JSON.parse(notif!.contextJson) as Record<string, unknown>;
    expect(ctx.owner).toBe(OWNER);
    expect(ctx.repo).toBe(REPO);
    expect(ctx.number).toBe(PR_NUMBER);

    // ...and a dev-1 who is not the mention stays silent.
    expect(await prisma.notification.count()).toBe(1);
  });

  it("deep-links a PR notification into the pull request page", () => {
    const href = notificationHref(
      "pr",
      JSON.stringify({ owner: OWNER, repo: REPO, number: PR_NUMBER }),
    );
    expect(href).toBe(
      `/dashboard/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`,
    );
  });

  it("deduplicates repeated nudges and re-arms a read notification", async () => {
    prSnapshot = snapshotAwaitingReviewLong();
    await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    const pr = await prisma.pullRequest.findFirstOrThrow({ where: { number: PR_NUMBER } });
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { stateEnteredAt: new Date(Date.now() - 10 * 3_600_000) },
    });

    await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    expect(await prisma.notification.count()).toBe(1);

    // maxNudgesPerState = 1: a third pass must not nudge or spam again.
    const third = await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    expect(third.nudged).toBe(false);
    expect(await prisma.notification.count()).toBe(1);

    // A prior PR skip must not suppress a nudge earned later: age again after the
    // reader opened (read) the row, and the same resource re-arms rather than
    // duplicating.
    await prisma.notification.updateMany({
      data: { readAt: new Date() },
    });
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: {
        stateEnteredAt: new Date(Date.now() - 10 * 3_600_000),
        nudgeBucketsJson: "[]",
      },
    });
    // restore quota so the re-run nudge is actually allowed
    await prisma.repoSetting.update({
      where: { repoId: pr.repoId },
      data: { maxNudgesPerState: 2 },
    });
    const rearmed = await processPrRefresh({
      installationId: INSTALLATION_ID,
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER,
    });
    expect(rearmed.nudged).toBe(true);
    // still one row; the read one was re-armed (readAt cleared) not duplicated
    expect(await prisma.notification.count()).toBe(1);
    const again = await prisma.notification.findFirstOrThrow({
      where: { user: { login: REVIEWER } },
    });
    expect(again.readAt).toBeNull();
  });
});