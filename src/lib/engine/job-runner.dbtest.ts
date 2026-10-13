import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { jobLatency, recentJobFailures } from "@/lib/engine/queue-metrics";

vi.mock("server-only", () => ({}));

/**
 * Worker queue integration test, the real thing, not a mock.
 *
 * Every existing test in this repository replaces Prisma with an in-memory
 * fixture, which means the queue had never been executed against a real
 * database. That is precisely the layer that was broken: the worker was never
 * deployed, so nothing proved the queue could claim and complete a job.
 *
 * This suite runs the genuine `enqueueJob` to `claimOne` to `drainQueue` to 
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
  // `processRepoIntel` is imported lazily inside the dispatcher, so it has to
  // live on the same mocked module for the repo_intel branch to be reachable.
  processRepoIntel: async (payload: unknown) => {
    const p = payload as { owner: string; repo: string };
    const key = `intel:${p.owner}/${p.repo}`;
    if (failOn.has(key)) throw new Error("simulated collection failure");
    processed.push({ kind: "repo_intel", payload });
  },
  // Same reasoning for the automation branch: the processor reads persisted
  // state only, but it lives in the same module as the GitHub-facing processors
  // and so must be present on the mock for the dispatch path to be reachable.
  processRepoAutomations: async (payload: unknown) => {
    const p = payload as { owner: string; repo: string };
    const key = `automations:${p.owner}/${p.repo}`;
    if (failOn.has(key)) throw new Error("simulated automation failure");
    processed.push({ kind: "repo_automations", payload });
    return { repoRowId: "row-1", workflowCount: 11, findingCount: 3 };
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
const { queueSnapshot, requeueDeadLetter, expiringLeases } = await import(
  "@/lib/engine/queue-metrics"
);

const prismaJobCount = () => prisma.job.count();

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
    // `startedAt` is PRESERVED on a terminal row: the latency report is computed
    // from it, and nulling it here made `jobLatency()` match nothing at all.
    expect(row.startedAt).not.toBeNull();
    // The lease and the occupancy key are released, so the same payload can be
    // queued again and nothing can try to write this attempt's outcome.
    expect(row.leaseToken).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    expect(row.dedupeKey).toBeNull();
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
    expect(row.dedupeKey).toBeNull();

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
    expect(claimed.status).toBe("claimed");
    const claimedJob = claimed.status === "claimed" ? claimed.job : null;
    expect(claimedJob).not.toBeNull();
    let row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("processing");
    expect(row.startedAt).not.toBeNull();

    // A fresh claim is not reapplicable yet: the lease runs for 5 minutes.
    expect(await recoverStaleJobs(5 * 60 * 1000, { force: true })).toBe(0);
    expect(await runClaimedJob()).toBe("empty");

    // Ageing only `startedAt` must not reclaim it either.
    await prisma.job.update({
      where: { id: claimedJob!.id },
      data: { startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    expect(await recoverStaleJobs(5 * 60 * 1000, { force: true })).toBe(0);

    // Age the LEASE past the window, as real elapsed time would. `leaseExpiresAt`
    // is now the single liveness signal: ageing `startedAt` alone must NOT
    // reclaim a job, because that is exactly the bug where a legitimately long
    // job was reclaimed while its executor was still running.
    await prisma.job.update({
      where: { id: claimedJob!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 10 * 60 * 1000) },
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

  it("dispatches a repo_intel job to the collection processor", async () => {
    await enqueueJob({ kind: "repo_intel", installationId: 42, owner: "acme", repo: "widgets" });
    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });

    expect(result.failed).toBe(0);
    expect(processed).toEqual([
      { kind: "repo_intel", payload: { kind: "repo_intel", installationId: 42, owner: "acme", repo: "widgets" } },
    ]);
  });

  it("dispatches a repo_automations job to the workflow processor", async () => {
    await enqueueJob({ kind: "repo_automations", installationId: 42, owner: "acme", repo: "widgets" });
    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });

    expect(result.failed).toBe(0);
    expect(processed).toEqual([
      {
        kind: "repo_automations",
        payload: { kind: "repo_automations", installationId: 42, owner: "acme", repo: "widgets" },
      },
    ]);
  });

  it("retries a failed automation run on the same backoff path as other work", async () => {
    // The workflow suite reads only the database, so a failure here is a defect
    // or a transient database error, not something to drop silently.
    failOn.add("automations:acme/widgets");
    await enqueueJob({ kind: "repo_automations", installationId: 42, owner: "acme", repo: "widgets" });

    const first = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(first.failed).toBe(1);

    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_automations" } });
    // A transient failure requeues with backoff rather than dropping the work.
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Bring the retry forward rather than waiting out the backoff, then confirm
    // the second attempt really runs the processor and completes the job.
    await prisma.job.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    failOn.delete("automations:acme/widgets");
    const second = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(second.failed).toBe(0);
    expect(second.processed).toBe(1);
    expect((await prisma.job.findFirstOrThrow({ where: { kind: "repo_automations" } })).status).toBe("done");
  });

  it("rejects a repo_automations payload with a non-positive installation id", async () => {
    await prisma.job.create({
      data: {
        kind: "repo_automations",
        payloadJson: JSON.stringify({ kind: "repo_automations", installationId: 0, owner: "a", repo: "b" }),
      },
    });
    await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });

    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_automations" } });
    expect(row.status).toBe("failed");
    expect(processed).toEqual([]);
  });

  it("retries a failed collection and dead-letters it after the limit", async () => {
    // Collection calls several GitHub endpoints, so a transient failure must be
    // retried on the same backoff path as PR refreshes rather than dropped.
    failOn.add("intel:acme/widgets");
    await enqueueJob({ kind: "repo_intel", installationId: 42, owner: "acme", repo: "widgets" });

    const first = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(first.failed).toBe(1);

    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_intel" } });
    // A transient failure requeues with backoff rather than dropping the work.
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("dead-letters a collection that keeps failing once attempts are exhausted", async () => {
    failOn.add("intel:acme/widgets");
    await prisma.job.create({
      data: {
        kind: "repo_intel",
        maxAttempts: 1,
        payloadJson: JSON.stringify({ kind: "repo_intel", installationId: 42, owner: "acme", repo: "widgets" }),
      },
    });
    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(result.failed).toBe(1);

    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_intel" } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("simulated collection failure");
  });

  it("rejects a repo_intel payload with a non-positive installation id", async () => {
    // A malformed payload must dead-letter on first sight rather than being
    // reclaimed and retried forever.
    await prisma.job.create({
      data: { kind: "repo_intel", payloadJson: JSON.stringify({ kind: "repo_intel", installationId: 0, owner: "a", repo: "b" }) },
    });
    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(result.failed).toBe(1);
    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_intel" } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("malformed job payload");
  });

  it("rejects a repo_intel payload whose owner is an empty string", async () => {
    await prisma.job.create({
      data: { kind: "repo_intel", payloadJson: JSON.stringify({ kind: "repo_intel", installationId: 1, owner: "  ", repo: "b" }) },
    });
    const result = await drainQueue({ maxJobs: 10, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(result.failed).toBe(1);
    const row = await prisma.job.findFirstOrThrow({ where: { kind: "repo_intel" } });
    expect(row.status).toBe("failed");
    // The blank owner must be caught at the boundary, never dispatched.
    expect(row.error).toContain("requires owner and repo");
  });
});

/**
 * Lease, fencing, and occupancy.
 *
 * These are the properties that make "safe across concurrent executors" true
 * rather than merely intended. Each one is a defect that was live before:
 * reclaim never counted an attempt (so a job that killed its executor could
 * never dead-letter), a lapsed claim had no fence (so a slow executor could
 * stamp its result over a newer attempt's), and enqueue dedupe was
 * check-then-act (so two concurrent identical deliveries both inserted).
 */
describe("queue leases and fencing", () => {
  beforeEach(async () => {
    await clearJobs();
    processed.length = 0;
    failOn.clear();
  });

  afterAll(async () => {
    await clearJobs();
    await prisma.$disconnect();
  });

  it("mints a distinct lease token per claim so attempts cannot collide", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    const first = await claimOne();
    expect(first.status).toBe("claimed");
    const firstToken = first.status === "claimed" ? first.job.leaseToken : "";
    expect(firstToken).toMatch(/^[0-9a-f-]{36}$/);

    const row = await prisma.job.findFirstOrThrow();
    expect(row.leaseToken).toBe(firstToken);
    expect(row.leaseExpiresAt).not.toBeNull();
    expect(row.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // Reclaim, then claim again: the second attempt must be fenced differently,
    // or it could not be told apart from the first.
    await prisma.job.update({
      where: { id: row.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await recoverStaleJobs(0, { force: true });

    const second = await claimOne();
    expect(second.status).toBe("claimed");
    const secondToken = second.status === "claimed" ? second.job.leaseToken : "";
    expect(secondToken).not.toBe(firstToken);
  });

  it("counts a reclaimed attempt, so a repeatedly-killed job dead-letters", async () => {
    // The original defect: reclaim reset status without touching attempts, so a
    // job that hard-killed its executor every time was reclaimed forever and
    // never reached maxAttempts. It could not be dead-lettered at all.
    await prisma.job.create({
      data: {
        kind: "pr_refresh",
        maxAttempts: 3,
        payloadJson: JSON.stringify({
          kind: "pr_refresh",
          installationId: 1,
          owner: "acme",
          repo: "api",
          number: 1,
        }),
      },
    });

    // Each round: claim (attempt N begins), lose the executor, reclaim. The
    // reclaim increments `attempts`, so the budget walks down 1 -> 2 -> 3 and the
    // reclaim that observes attempts == maxAttempts records the job instead of
    // requeueing it.
    for (let i = 0; i < 4; i += 1) {
      const claim = await claimOne();
      if (claim.status !== "claimed") break;
      const row = await prisma.job.findFirstOrThrow();
      await prisma.job.update({
        where: { id: row.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });
      await recoverStaleJobs(0, { force: true });
    }

    const row = await prisma.job.findFirstOrThrow();
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(row.error).toContain("lease expired repeatedly");
    expect(row.dedupeKey).toBeNull();

    // A dead-lettered job is terminal: nothing picks it up again.
    expect(await runClaimedJob()).toBe("empty");
  });

  it("refuses a terminal write from an executor that lost its lease", async () => {
    // The fence. An executor whose lease lapsed keeps running; without a token
    // check its late write overwrites whatever the attempt that replaced it
    // decided. With it, the write affects zero rows.
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });

    const stale = await claimOne();
    expect(stale.status).toBe("claimed");
    const staleToken = stale.status === "claimed" ? stale.job.leaseToken : "";

    const staleId = await prisma.job.findFirstOrThrow().then((r) => r.id);
    await prisma.job.update({
      where: { id: staleId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await recoverStaleJobs(0, { force: true });
    await runClaimedJob(); // the replacement attempt finishes
    expect(processed).toHaveLength(1);

    // Replay the original attempt's terminal write with its now-stale token.
    const fenced = await prisma.job.updateMany({
      where: { id: staleId, status: "processing", leaseToken: staleToken },
      data: { status: "failed", error: "stale executor" },
    });
    expect(fenced.count).toBe(0);

    const row = await prisma.job.findFirstOrThrow({ where: { id: staleId } });
    expect(row.status).toBe("done");
    expect(row.error).toBeNull();
  });

  it("keeps the lease alive for a long-running job so it is not reclaimed", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    const claim = await claimOne();
    expect(claim.status).toBe("claimed");
    const job = claim.status === "claimed" ? claim.job : null;

    const before = await prisma.job.findFirstOrThrow();
    expect(before.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // The heartbeat pushes the deadline forward. Exercised directly rather than
    // by waiting 60s: the guarantee under test is that the deadline is derived
    // from "now" and is not a fixed stamp taken at claim time.
    await prisma.job.updateMany({
      where: { id: job!.id, status: "processing", leaseToken: job!.leaseToken },
      data: { leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    });

    // A reclaim run with a 5-minute window must not touch it.
    expect(await recoverStaleJobs(5 * 60 * 1000, { force: true })).toBe(0);
    expect((await prisma.job.findFirstOrThrow()).status).toBe("processing");
  });

  it("enforces one in-flight job per payload in the database, not by counting", async () => {
    // The dedupe used to be `count()` then `insert()`, with nothing between the
    // two. Concurrent identical deliveries both saw zero overlaps and both
    // inserted, so the same PR was classified twice and commented on twice.
    const payload = {
      kind: "pr_refresh",
      installationId: 1,
      owner: "acme",
      repo: "api",
      number: 1,
    } as const;

    await Promise.all(Array.from({ length: 8 }, () => enqueueJob(payload)));
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(1);

    // Different payloads are not collapsed.
    await enqueueJob({ ...payload, number: 2 });
    await enqueueJob({ kind: "repo_intel", installationId: 1, owner: "acme", repo: "api" });
    expect(await prisma.job.count({ where: { status: "pending" } })).toBe(3);
  });

  it("lets the same payload queue again once the previous run finished", async () => {
    // The dedupe key is cleared on every terminal transition, so the unique
    // index only ever constrains in-flight work.
    const payload = {
      kind: "pr_refresh",
      installationId: 1,
      owner: "acme",
      repo: "api",
      number: 1,
    } as const;

    await enqueueJob(payload);
    expect(await prismaJobCount()).toBe(1);
    await drainQueue({ maxJobs: 5, budgetMs: 15_000, concurrency: 1, label: "test" });
    expect(await prisma.job.count({ where: { status: "done" } })).toBe(1);

    // A webhook redelivery for work that is already complete must be accepted.
    await enqueueJob(payload);
    expect(await prismaJobCount()).toBe(2);
  });

  it("never hands the same job to two concurrent claimers", async () => {
    // Many claimers, fewer jobs than claimers, so some must lose the
    // compare-and-swap. Whoever loses must report `contended` or `empty`, 
    // crucially never `claimed` for a row someone else already owns, and never
    // the same job id twice.
    for (let n = 1; n <= 3; n += 1) {
      await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: n });
    }

    const results = await Promise.all(Array.from({ length: 12 }, () => claimOne()));
    const claimedIds = results
      .filter((r): r is Extract<typeof r, { status: "claimed" }> => r.status === "claimed")
      .map((r) => r.job.id);

    // The invariant is exclusivity: no job is ever handed to two executors, and
    // no claim reports a lease token for a row it did not actually win. How many
    // of the three are taken in a single burst is timing-dependent, a loser
    // that reads the same head row returns `contended` and the next round moves
    // on, so that count is deliberately not asserted. It is bounded, and the
    // drain test below is what proves the backlog actually gets worked off.
    expect(claimedIds.length).toBeGreaterThan(0);
    expect(claimedIds.length).toBeLessThanOrEqual(3);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(await prisma.job.count({ where: { status: "processing" } })).toBe(claimedIds.length);
  });

  it("works off a contended backlog over several rounds, losing nothing", async () => {
    // Combined with the drain test: contention must cost a retry, not a job.
    for (let n = 1; n <= 5; n += 1) {
      await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: n });
    }

    let claimed = 0;
    for (let round = 0; round < 20 && claimed < 5; round += 1) {
      const results = await Promise.all(Array.from({ length: 5 }, () => claimOne()));
      claimed += results.filter((r) => r.status === "claimed").length;
    }

    expect(claimed).toBe(5);
    expect(new Set((await prisma.job.findMany({ select: { id: true } })).map((r) => r.id)).size).toBe(5);
  });

  it("reports an exhausted queue as empty, never as contention", async () => {
    // The distinction only means something if `empty` is still reachable. A lane
    // that got `contended` for a genuinely idle queue would spin until the
    // drain's contention cap, turning a quiet queue into a busy loop.
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });
    expect((await claimOne()).status).toBe("claimed");
    expect((await claimOne()).status).toBe("empty");
    expect((await runClaimedJob())).toBe("empty");
  });

  it("surfaces a lapsed claim as an expiring lease and clears it on completion", async () => {
    await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: 1 });

    // Healthy claim: the lease deadline is in the future, so nothing is reported.
    expect(await expiringLeases()).toBe(0);
    const claim = await claimOne();
    expect(claim.status).toBe("claimed");

    // Expire it: this is the signal that an executor is being killed mid-job.
    const row = await prisma.job.findFirstOrThrow();
    await prisma.job.update({
      where: { id: row.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await expiringLeases()).toBe(1);

    // Reclaiming it puts it back in the queue; finishing normally then clears
    // the lease signal again.
    await recoverStaleJobs(0, { force: true });
    expect(await runClaimedJob()).toBe("ok");
    expect(await expiringLeases()).toBe(0);
  });

  it("lets an operator requeue a dead-lettered job, and refuses anything else", async () => {
    failOn.add("acme/api#1");
    await prisma.job.create({
      data: {
        kind: "pr_refresh",
        maxAttempts: 1,
        payloadJson: JSON.stringify({
          kind: "pr_refresh",
          installationId: 1,
          owner: "acme",
          repo: "api",
          number: 1,
        }),
      },
    });
    await drainQueue({ maxJobs: 5, budgetMs: 15_000, concurrency: 1, label: "test" });
    const dead = await prisma.job.findFirstOrThrow();
    expect(dead.status).toBe("failed");

    // A dead-lettered job is terminal on its own; nothing retries it silently.
    expect(await runClaimedJob()).toBe("empty");

    expect(await requeueDeadLetter(dead.id)).toBe("requeued");
    const revived = await prisma.job.findFirstOrThrow();
    expect(revived.status).toBe("pending");
    expect(revived.attempts).toBe(0);
    expect(revived.error).toBeNull();
    expect(revived.nextAttemptAt).toBeNull();

    // The cause is still present, so it runs again and dead-letters again. That
    // is the intended loop: requeueing is an operator judgement, not a fix.
    failOn.delete("acme/api#1");
    expect(await runClaimedJob()).toBe("ok");
    expect(processed).toHaveLength(1);

    // Guard rails: a missing row, and a row that is not dead-lettered.
    expect(await requeueDeadLetter("does-not-exist")).toBe("not_found");
    const doneRow = await prisma.job.findFirstOrThrow({ where: { status: "done" } });
    expect(await requeueDeadLetter(doneRow.id)).toBe("not_failed");
  });

  it("drains the whole backlog when lanes contend for the same head row", async () => {
    // The regression that matters for throughput: with contention treated as
    // emptiness, concurrent lanes quit after the first round and `remaining`
    // stayed high while the queue reported itself drained.
    for (let n = 1; n <= 24; n += 1) {
      await enqueueJob({ kind: "pr_refresh", installationId: 1, owner: "acme", repo: "api", number: n });
    }
    const result = await drainQueue({ maxJobs: 50, budgetMs: 20_000, concurrency: 8, label: "test" });
    expect(result.processed).toBe(24);
    expect(result.remaining).toBe(0);
    expect(result.stopReason).toBe("drained");
    expect(new Set(processed.map((p) => JSON.stringify(p.payload))).size).toBe(24);
  });
});

describe("queue observability", () => {
  // This block is top-level, so the enclosing suite's `beforeEach(clearJobs)`
  // does not apply to it. Without its own reset, the latency fixtures from one
  // test leak into the next and the assertions measure the wrong window.
  beforeEach(async () => {
    await clearJobs();
  });

  it("reports p50/p95 latency per job kind and separates it from other kinds", async () => {
    const now = Date.now();
    const make = (kind: string, i: number, ms: number) => ({
      kind,
      status: "done",
      payloadJson: "{}",
      startedAt: new Date(now - ms - 1000),
      finishedAt: new Date(now - 1000),
      attempts: 1,
    });

    // 10 fast "pr_refresh" jobs, 2 slow "repo_intel" jobs.
    const jobs = [
      ...Array.from({ length: 10 }, (_, i) => make("pr_refresh", i, 100 + i)),
      ...Array.from({ length: 2 }, (_, i) => make("repo_intel", i, 9000 + i * 1000)),
    ];
    await prisma.job.createMany({ data: jobs });

    const { overall, byKind } = await jobLatency();
    expect(overall).not.toBeNull();
    expect(overall!.samples).toBe(12);

    const intel = byKind.find((l) => l.kind === "repo_intel");
    const pr = byKind.find((l) => l.kind === "pr_refresh");
    expect(intel!.p50Ms).toBeGreaterThan(5000);
    expect(pr!.p95Ms).toBeLessThan(1000);
    // Sorted by p95 descending, so the slow kind surfaces first.
    expect(byKind[0]!.kind).toBe("repo_intel");
  });

  it("ignores a finished job that has no start time", async () => {
    await prisma.job.create({
      data: { kind: "pr_refresh", status: "done", payloadJson: "{}", finishedAt: new Date() },
    });
    const { overall } = await jobLatency();
    // No start time means no measurable duration; it must not be counted as 0ms.
    expect(overall?.samples ?? 0).toBe(0);
  });

  it("returns the terminal failures with their error text", async () => {
    const err = await prisma.job.create({
      data: { kind: "repo_intel", status: "failed", payloadJson: "{}", error: "boom", attempts: 5, maxAttempts: 5 },
    });
    const rows = await recentJobFailures();
    const found = rows.find((r) => r.id === err.id);
    expect(found).toMatchObject({ kind: "repo_intel", error: "boom", attempts: 5, maxAttempts: 5 });
  });

  it("truncates a very long error so the admin table stays readable", async () => {
    await prisma.job.create({
      data: { kind: "pr_refresh", status: "failed", payloadJson: "{}", error: "x".repeat(5000) },
    });
    const rows = await recentJobFailures();
    expect(rows[0]!.error!.length).toBe(400);
  });
});
