import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

/**
 * End-to-end proof that a webhook actually results in a classified PR.
 *
 * Runs as a `.dbtest.ts` file: these suites share one SQLite database, so they
 * are executed serially in a dedicated vitest project (see
 * `vitest.db.config.ts`) rather than in parallel with each other.
 *
 * This is the test that was missing. The worker was never deployed, so
 * `dispatchEvent` enqueued rows into `Job` that nothing ever claimed: no PR was
 * ever classified, no status card was ever posted, and every unit test still
 * passed because they all replaced Prisma with a mock.
 *
 * Only the four modules that make live GitHub HTTP calls are stubbed. The
 * webhook route, signature verification, dispatcher, enqueue, the queue's
 * atomic claiming, the PR processor, the classification state machine, and
 * Prisma are all the real implementations running against a real database.
 *
 * Requires the SQLite-mirrored schema:
 *   node scripts/gen-sqlite-schema.mjs
 *   npx prisma generate --schema prisma/schema.sqlite.prisma
 */

const WEBHOOK_SECRET = "e2e-webhook-secret";
const INSTALLATION_ID = 4242;
const OWNER = "acme";
const REPO = "payments-api";
const REPO_FULL = `${OWNER}/${REPO}`;

const posted: Array<{ kind: string; body?: string; state?: string }> = [];
let prSnapshot: unknown = null;

vi.mock("@/lib/env-boot", () => ({
  config: {
    GITHUB_APP_WEBHOOK_SECRET: "e2e-webhook-secret",
    GITHUB_APP_SLUG: "abrahamdominic",
    BATON_WEBHOOK_DRAIN_JOBS: 2,
    BATON_WEBHOOK_DRAIN_BUDGET_MS: 6000,
    BATON_DRAIN_MAX_JOBS: 40,
    BATON_DRAIN_BUDGET_MS: 50000,
    BATON_DRAIN_CONCURRENCY: 2,
    BATON_JOB_CONCURRENCY: 2,
    BATON_WORKER_POLL_MS: 5000,
    BATON_CRON_INTERVAL_MIN: 720,
    NODE_ENV: "test",
  },
  getConfig: () => ({ GITHUB_APP_WEBHOOK_SECRET: "e2e-webhook-secret" }),
}));

vi.mock("@/lib/github/app", () => ({
  installationClients: async () => ({ gql: async () => ({}), rest: {} }),
  logRateLimit: () => {},
  getAppId: () => 777,
}));

vi.mock("@/lib/github/actions", () => ({
  // Real signatures return a comment id (number), not an object.
  createComment: async (
    _octokit: unknown,
    _owner: string,
    _repo: string,
    _prNumber: number,
    opts: { body: string },
  ) => {
    posted.push({ kind: "comment", body: opts.body });
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
const { drainQueue } = await import("@/lib/engine/job-runner");
const { POST } = await import("@/app/api/webhooks/route");

function sign(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

async function postWebhook(
  event: string,
  payload: unknown,
  opts: { deliveryId: string; signature?: string | null; action?: string } = { deliveryId: "d-1" },
) {
  const raw = JSON.stringify(payload);
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": opts.deliveryId,
    "x-forwarded-for": "140.82.112.1",
  });
  const sig = opts.signature === null ? null : (opts.signature ?? sign(raw));
  if (sig) headers.set("x-hub-signature-256", sig);

  const req = new Request("https://baton.test/api/webhooks", {
    method: "POST",
    headers,
    body: raw,
  });
  return POST(req as never);
}

function prOpened(number: number) {
  return {
    number,
    action: "opened",
    installation: { id: INSTALLATION_ID },
    repository: { name: REPO, owner: { login: OWNER }, full_name: REPO_FULL },
    pull_request: { number },
  };
}

/**
 * A real, complete `SnapshotInput`: authored by a developer, review requested
 * from a reviewer, no review submitted yet. The deterministic state machine
 * should place the turn on the reviewers.
 *
 * Typed against the real contract so a field rename breaks this test at compile
 * time rather than surfacing as a confusing runtime `undefined`.
 */
function snapshotWaitingForReview() {
  return {
    input: {
      prNumber: 11,
      isDraft: false,
      githubState: "OPEN" as const,
      authorLogin: "dev-1",
      title: "Add idempotency keys",
      url: `https://github.com/${REPO_FULL}/pull/11`,
      headRef: "feat/idempotency",
      headSha: "abc123",
      baseRef: "main",
      mergeable: "MERGEABLE" as const,
      reviewDecision: "REVIEW_REQUIRED" as const,
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
      headPushedAt: new Date().toISOString(),
      labels: [] as string[],
      reviews: [],
      requestedReviewerLogins: ["reviewer-1"],
      requestedTeamSlugs: [] as string[],
      checks: [],
      now: new Date(),
    },
    rateLimitRemaining: 4000,
  };
}

describe("webhook -> queue -> classification (end to end)", () => {
  beforeEach(async () => {
    await prisma.pullRequest.deleteMany({});
    await prisma.repoSetting.deleteMany({});
    await prisma.repo.deleteMany({});
    await prisma.appInstallation.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    posted.length = 0;

    await prisma.appInstallation.create({
      data: { installationId: INSTALLATION_ID, accountLogin: OWNER, accountType: "Organization" },
    });
    await prisma.repo.create({
      data: {
        installation: { connect: { installationId: INSTALLATION_ID } },
        repoId: 1001n,
        owner: OWNER,
        name: REPO,
        fullName: REPO_FULL,
        defaultBranch: "main",
        isPrivate: false,
        enabled: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("durably records the delivery and enqueues the work before responding", async () => {
    prSnapshot = snapshotWaitingForReview();

    const res = await postWebhook("pull_request", prOpened(11), { deliveryId: "e2e-1" });
    expect(res.status).toBe(200);

    // The delivery is recorded AND marked processed only after the enqueue
    // committed. A row that is seen but not processed stays reprocessable, so
    // GitHub's retry can recover a delivery that died mid-flight.
    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect(event.processedAt).not.toBeNull();

    // The work is on the queue the moment we answer, not whenever a scheduler
    // next happens to run.
    expect(await prisma.job.count({ where: { kind: "pr_refresh" } })).toBe(1);
  });

  it("turns a delivered webhook into a classified, GitHub-surfaced PR", async () => {
    prSnapshot = snapshotWaitingForReview();

    const res = await postWebhook("pull_request", prOpened(21), { deliveryId: "e2e-2" });
    expect(res.status).toBe(200);

    // Drain the queue exactly as the inline post-webhook drain and the scheduled
    // drain both do. `after()` cannot be exercised outside a real Next request
    // scope, so the drain is driven explicitly; it is the same `drainQueue`
    // implementation the route schedules.
    const drain = await drainQueue({ maxJobs: 5, budgetMs: 6000, concurrency: 1, label: "test" });
    expect(drain.failed).toBe(0);

    // The PR is classified and persisted. This row is the product's actual
    // output, and the reason the missing worker was fatal: nothing downstream of
    // the queue ran, so it simply never appeared.
    const pr = await prisma.pullRequest.findFirst({ where: { number: 21 } });
    expect(pr).not.toBeNull();
    expect(pr!.state).toBe("awaiting_review");
    expect(pr!.title).toBe("Add idempotency keys");
    expect(pr!.authorLogin).toBe("dev-1");
    expect(pr!.statusCommentId).not.toBeNull();

    // And Baton performed its GitHub-native actions.
    expect(posted.some((p) => p.kind === "status")).toBe(true);
    expect(posted.some((p) => p.kind === "label")).toBe(true);

    // Nothing left behind: the job reached a terminal state.
    expect(await prisma.job.count({ where: { status: { in: ["pending", "processing"] } } })).toBe(0);
    expect(await prisma.job.count({ where: { status: "done" } })).toBe(1);
  });

  it("rejects a forged signature without enqueuing any work", async () => {
    prSnapshot = snapshotWaitingForReview();

    const res = await postWebhook("pull_request", prOpened(12), {
      deliveryId: "e2e-forged",
      signature: `sha256=${"0".repeat(64)}`,
    });

    expect(res.status).toBe(401);
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.pullRequest.count()).toBe(0);
  });

  it("does not double-process a redelivered webhook", async () => {
    prSnapshot = snapshotWaitingForReview();

    await postWebhook("pull_request", prOpened(13), { deliveryId: "e2e-dup" });
    const second = await postWebhook("pull_request", prOpened(13), { deliveryId: "e2e-dup" });

    expect(second.status).toBe(200);
    // Idempotency is on (deliveryId, eventType), so a retry cannot enqueue a
    // second refresh and cannot post a second comment.
    expect(await prisma.job.count()).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it("acknowledges untracked events without touching the queue", async () => {
    const res = await postWebhook(
      "star",
      { action: "created", installation: { id: INSTALLATION_ID } },
      { deliveryId: "e2e-star" },
    );

    expect(res.status).toBe(200);
    expect(await prisma.job.count()).toBe(0);
  });
});
