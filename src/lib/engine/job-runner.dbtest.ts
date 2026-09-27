import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Worker queue integration test — the real thing, not a mock.
 *
 * Every existing test in this repository replaces Prisma with an in-memory
 * fixture, which means the queue had never been executed against a real
 * database. That is precisely the layer that was broken: the worker was never
 * deployed, so nothing proved the queue could claim and complete a job.
 *
 * This suite runs the genuine `enqueueJob` → `claimOne` → `drainQueue` →
 * `queueSnapshot` path against a real database. Only the GitHub-facing
 * processors in `@/lib/engine/runner` are stubbed, because those make live API
 * calls; everything the worker owns (atomic claiming, CAS races, status
 * transitions, payload validation, retry/backoff, dead-lettering, stale-job
 * reclaim, metrics) is real code under test.
 *
 * Requires the SQLite-mirrored schema:
 *   node scripts/gen-sqlite-schema.mjs
 *   npx prisma generate --schema prisma/schema.sqlite.prisma
 */

const processed: Array<{ kind: string; payload: unknown }> = [];
const failOn = new Set<string>();

vi.mock("@/lib/engine/runner", () => ({
  processPrRefresh: async (payload: unknown) => {
    const p = payload as { owner: string; repo: string; number: number };
    const key = `${p.owner}/${p.repo}#${p.number}`;
    if (failOn.has(key)) throw new Error("simulated processor failure");
    processed.push({ kind: "pr_refresh", payload });
  },
  processInstallRegister: async (installationId: number) => {
    processed.push({ kind: "install_register", payload: { installationId } });
  },
}));

vi.mock("@/lib/github/install", () => ({
  handleUninstall: async (installationId: number) => {
    processed.push({ kind: "install_unregister", payload: { installationId } });
  },
}));

const { prisma } = await import("@/lib/db");
const { enqueueJob } = await import("@/lib/engine/jobs");
const { claimOne, drainQueue, recoverStaleJobs, runClaimedJob } = await import(
  "@/lib/engine/job-runner"
);
const { queueSnapshot } = await import("@/lib/engine/queue-metrics");

async function clearJobs(): Promise<void> {
  await prisma.job.deleteMany({});
}

describe("worker queue (real database)", () => {
  beforeEach(async () => {
    await clearJobs();
    processed.length = 0;
    failOn.clear();
  });

  afterAll(async () => {
    await clearJobs();
    await prisma.$disconnect();
  });

  it("processes a real job end to end: enqueue -> claim -> done", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 42, owner: "acme", repo: "api", number: 7 });

    const snapshot = await queueSnapshot();
    expect(snapshot.pending).toBe(1);
    expect(snapshot.runnable).toBe(1);
    expect(snapshot.stalled).toBe(false);

    const outcome = await runClaimedJob();

    expect(outcome).toBe("ok");
    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      kind: "pr_refresh",
      payload: { owner: "acme", repo: "api", number: 7 },
    });

    const row = await prisma.job.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    expect(row.status).toBe("done");
    expect(row.finishedAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(row.startedAt).toBeNull();
  });

  it("returns empty (not a failure) when the queue has no work", async () => {
    expect(await runClaimedJob()).toBe("empty");
  });

  it("drains a batch of queued work and reports accurate metrics", async () => {
    for (let n = 1; n <= 6; n += 1) {
      await enqueueJob({
        kind: "pr_refresh",
        installationId: 1,
        owner: "acme",
        repo: "api",
        number: n,
      });
    }
    // Distinct payloads, so the 15-minute dedup window in enqueueJob keeps all six.
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(6);

    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 3, label: "test" });

    expect(result.processed).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.stopReason).toBe("drained");
    expect(result.remaining).toBe(0);
    expect(processed).toHaveLength(6);
    expect(await prisma.job.count({ where: { status: "done" } })).toBe(6);
  });

  it("respects maxJobs so a drain always terminates", async () => {
    for (let n = 1; n <= 8; n += 1) {
      await enqueueJob({
        kind: "pr_refresh",
        installationId: 1,
        owner: "acme",
        repo: "api",
        number: n,
      });
    }

    const result = await drainQueue({ maxJobs: 3, budgetMs: 15_000, concurrency: 2, label: "test" });

    expect(result.processed).toBe(3);
    expect(result.stopReason).toBe("max_jobs");
    expect(result.remaining).toBe(5);
    expect(await prisma.job.count({ where: { status: "done" } })).toBe(3);
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(5);
  });

  it("stops claiming work it cannot finish when the time budget is spent", async () => {
    for (let n = 1; n <= 5; n += 1) {
      await enqueueJob({
        kind: "pr_refresh",
        installationId: 1,
        owner: "acme",
        repo: "api",
        number: n,
      });
    }

    // A budget below the response reserve means no job may be claimed at all.
    const result = await drainQueue({ maxJobs: 50, budgetMs: 0, concurrency: 2, label: "test" });

    expect(result.processed).toBe(0);
    expect(result.stopReason).toBe("budget_exhausted");
    // Nothing was stranded in `processing` by the aborted drain.
    expect(await prisma.job.count({ where: { status: "processing" } })).toBe(0);
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(5);
  });

  it("claims each job exactly once under concurrent executors", async () => {
    for (let n = 1; n <= 12; n += 1) {
      await enqueueJob({
        kind: "pr_refresh",
        installationId: 1,
        owner: "acme",
        repo: "api",
        number: n,
      });
    }

    await drainQueue({ maxJobs: 50, budgetMs: 15_000, concurrency: 8, label: "test" });

    // The race that matters: no PR may be processed twice, because a duplicate
    // means duplicate GitHub comments and duplicate nudge charges.
    expect(processed).toHaveLength(12);
    expect(new Set(processed.map((p) => JSON.stringify(p.payload))).size).toBe(12);
    expect(await prisma.job.count({ where: { status: "done" } })).toBe(12);
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(0);
  });

  it("retries a transient failure with backoff, then succeeds", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    failOn.add("acme/api#1");

    expect(await runClaimedJob()).toBe("failed");

    let row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
    expect(row.error).toContain("simulated processor failure");

    // A job whose backoff has not elapsed must not be claimed.
    expect(await runClaimedJob()).toBe("empty");

    // Make it runnable again, as the passage of time would.
    await prisma.job.update({ where: { id: row.id }, data: { nextAttemptAt: null } });
    failOn.clear();

    expect(await runClaimedJob()).toBe("ok");
    row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("done");
    expect(processed).toHaveLength(1);
  });

  it("dead-letters a permanent failure without burning retries", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    failOn.add("acme/api#1");

    // Exhaust the retry budget.
    for (let i = 0; i < 6; i += 1) {
      const row = await prisma.job.findFirstOrThrow();
      await prisma.job.update({ where: { id: row.id }, data: { nextAttemptAt: null } });
      expect(await runClaimedJob()).toBe("failed");
    }

    const row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("failed");
    expect(row.attempts).toBeGreaterThanOrEqual(row.maxAttempts);
  });

  it("dead-letters a malformed payload on first sight instead of looping", async () => {
    // Simulates a poison row: valid JSON column, corrupt contents. Previously
    // this threw outside the try block, leaving the job stuck in `processing`
    // and re-failing forever every reclaim cycle.
    await prisma.job.create({
      data: { kind: "pr_refresh", payloadJson: "{not-json", maxAttempts: 6 },
    });

    expect(await runClaimedJob()).toBe("failed");

    const row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("failed");
    expect(row.error).toContain("malformed job payload");
    expect(row.startedAt).toBeNull();

    // And it must not be picked up again.
    expect(await runClaimedJob()).toBe("empty");
  });

  it("rejects payloads whose kind and shape disagree", async () => {
    await prisma.job.create({
      data: {
        kind: "pr_refresh",
        payloadJson: JSON.stringify({ kind: "install_register", installationId: 5 }),
        maxAttempts: 6,
      },
    });

    expect(await runClaimedJob()).toBe("failed");
    const row = await prisma.job.findFirstOrThrow();
    // Disagreeing kinds are unfixable, so no processor may have run.
    expect(processed).toHaveLength(0);
    expect(row.status).toBe("failed");
  });

  it("reclaims a job abandoned mid-flight by a dead executor", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });

    // Claim it, then simulate the executor being killed before finishing.
    const claimed = await claimOne();
    expect(claimed).not.toBeNull();
    let row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("processing");
    expect(row.startedAt).not.toBeNull();

    // A fresh job is not reapplicable yet: the reclaim window is 5 minutes.
    expect(await recoverStaleJobs(5 * 60 * 1000, { force: true })).toBe(0);
    expect(await runClaimedJob()).toBe("empty");

    // Age the claim past the window, as real elapsed time would.
    await prisma.job.update({
      where: { id: claimed!.id },
      data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    expect(await recoverStaleJobs(5 * 60 * 1000, { force: true })).toBe(1);

    row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("pending");

    expect(await runClaimedJob()).toBe("ok");
    expect(processed).toHaveLength(1);
  });

  it("deduplicates overlapping enqueues so a retry storm cannot pile up", async () => {
    const payload = { kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 } as const;
    await enqueueJob(payload);
    await enqueueJob(payload);
    await enqueueJob(payload);

    expect(await prisma.job.count()).toBe(1);
  });

  it("reports a stalled queue when work is waiting and nothing is draining it", async () => {
    expect((await queueSnapshot()).stalled).toBe(false);

    // Age the pending job past the stall threshold without processing it.
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    await prisma.job.updateMany({
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const stalled = await queueSnapshot();
    expect(stalled.pending).toBe(1);
    expect(stalled.processing).toBe(0);
    expect(stalled.stalled).toBe(true);
    expect(stalled.oldestPendingAgeSec).toBeGreaterThan(3000);
  });

  it("processes install lifecycle jobs from the queue", async () => {
    await enqueueJob({ kind: "install_register", installationId: 99 });
    await enqueueJob({ kind: "install_unregister", installationId: 99 });

    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(processed.map((p) => p.kind).sort()).toEqual(["install_register", "install_unregister"]);
  });
});
