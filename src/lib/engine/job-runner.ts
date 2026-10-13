import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { payloadOf, type JobPayload } from "@/lib/engine/jobs";
import { processPrRefresh, processInstallRegister } from "@/lib/engine/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A job that has been atomically moved to `processing`. `leaseToken` is the
 * fencing token for this attempt: it must be passed back on every write that
 * changes the row's outcome, so an executor that has lost its lease cannot
 * clobber the result of the attempt that replaced it.
 */
export interface ClaimedJob {
  id: string;
  kind: string;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
}

/** A claimed-but-unfinished job is considered abandoned once its lease lapses. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** How often a running job pushes its lease deadline forward. */
const HEARTBEAT_MS = 60_000;

/** Throttle for the standalone worker's reclaim sweep (see `recoverStaleJobs`). */
const RECOVER_INTERVAL_MS = 60_000;
let lastRecoverAt = 0;

/**
 * Requeue (or dead-letter) jobs whose claim lapsed.
 *
 * This exists because a serverless executor can be frozen or terminated
 * mid-job (Vercel recycles instances, a container is killed, an OOM occurs).
 * Without reaping, those rows sit in `processing` forever and their work is
 * silently lost: the queue looks idle while PRs are never classified.
 *
 * Two properties matter for correctness and neither is automatic:
 *
 *  - **The attempt is counted.** A previous version reset `status`/`startedAt`
 *    without touching `attempts`, so a job that reliably killed its executor
 *    (OOM, freeze, SIGKILL) was reclaimed forever: it never reached
 *    `maxAttempts`, so it never dead-lettered, and the queue reported healthy
 *    while doing nothing. `attempts` is now incremented in the same UPDATE, and
 *    a row whose budget is spent is dead-lettered instead of requeued.
 *
 *  - **The reclaim is fenced by the lease.** Only rows whose `leaseExpiresAt`
 *    has passed are touched. `startedAt` is kept as a fallback for rows claimed
 *    before this column existed (`leaseExpiresAt` null) so in-flight work is
 *    never stranded by an upgrade.
 *
 * Called once per drain rather than once per claim. The original code ran this
 * `updateMany` before *every* single claim, which meant draining 50 jobs
 * issued 50 extra writes, pure write amplification on the hot path.
 */
export async function recoverStaleJobs(
  maxAgeMs: number = STALE_AFTER_MS,
  options: { force?: boolean } = {},
): Promise<number> {
  const now = Date.now();
  if (!options.force && now - lastRecoverAt < RECOVER_INTERVAL_MS) return 0;
  lastRecoverAt = now;

  const cutoff = new Date(now - maxAgeMs);

  // Rows whose lease lapsed, bounded so a pathological backlog cannot turn the
  // sweep into an unbounded transaction. The remaining lapsed rows are picked up
  // on the next drain, which runs every few minutes.
  const lapsed = await prisma.job.findMany({
    where: {
      status: "processing",
      OR: [{ leaseExpiresAt: { lt: new Date(now) } }, { leaseExpiresAt: null, startedAt: { lt: cutoff } }],
    },
    select: { id: true, kind: true, attempts: true, maxAttempts: true },
    orderBy: { startedAt: "asc" },
    take: 200,
  });

  if (lapsed.length === 0) return 0;

  // `attempts >= maxAttempts` has to be decided in JS: Prisma cannot compare two
  // columns of the same row, and the budget is per-job (every enqueue writes 6,
  // but an operator can lower it), so a hardcoded threshold would dead-letter
  // early for some rows and requeue forever for others.
  const exhausted = lapsed.filter((j) => j.attempts >= j.maxAttempts);
  const requeued = lapsed.filter((j) => j.attempts < j.maxAttempts);

  for (const job of exhausted) {
    await prisma.job.updateMany({
      where: { id: job.id, status: "processing" },
      data: {
        status: "failed",
        startedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        dedupeKey: null,
        error: "lease expired repeatedly: the executor was terminated before the job could finish",
      },
    });
    logger.warn("job-dead", {
      id: job.id,
      kind: job.kind,
      attempts: job.attempts,
      error: "lease-expired-exhausted",
    });
  }

  // Requeue everything else that has lapsed. `attempts` is incremented here so
  // a repeatedly-killed job walks the budget down and eventually dead-letters
  // instead of being reclaimed forever. Guarded on `status` so a job that
  // finished in the meantime is never dragged back into the queue.
  let requeuedCount = 0;
  for (const job of requeued) {
    const res = await prisma.job.updateMany({
      where: { id: job.id, status: "processing" },
      data: {
        status: "pending",
        startedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: { increment: 1 },
        error: "lease expired: the executor stopped before the job could finish",
      },
    });
    requeuedCount += res.count;
  }

  const total = exhausted.length + requeuedCount;
  if (total > 0) {
    logger.warn("queue-stale-recovered", {
      count: total,
      requeued: requeuedCount,
      deadLettered: exhausted.length,
    });
  }
  return total;
}

/** Outcome of a single attempt to take a job. */
export type ClaimResult =
  | { status: "claimed"; job: ClaimedJob }
  /** Nothing runnable right now. */
  | { status: "empty" }
  /**
   * Another executor won the race for the row this lane was about to take.
   *
   * This is deliberately distinct from `empty`. Collapsing the two made every
   * losing lane in a concurrent drain exit immediately, so a drain configured
   * with four lanes could usually process about one job: all four lanes read the
   * same head row, one won the compare-and-swap, and the other three returned
   * "nothing to do" and quit. A contended lane must retry instead.
   */
  | { status: "contended" };

/**
 * Atomically claim one runnable job (safe across concurrent executors).
 *
 * Uses a conditional `updateMany` as a compare-and-swap: if another executor
 * won the race between `findFirst` and `updateMany`, `count` is 0 and we report
 * `contended` so the caller retries rather than treating the lane as idle.
 *
 * The claim mints a fresh `leaseToken` and sets `leaseExpiresAt`. Together they
 * give every attempt an identity: the token fences terminal writes, and the
 * deadline (refreshed by the heartbeat) tells the reclaim sweep that the work
 * is still alive.
 *
 * Ordering follows the `[status, createdAt]` index, so this stays a single
 * indexed scan instead of sorting the whole pending set.
 */
export async function claimOne(): Promise<ClaimResult> {
  const now = new Date();

  const candidate = await prisma.job.findFirst({
    where: {
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { id: true, kind: true, payloadJson: true, attempts: true, maxAttempts: true },
  });
  if (!candidate) return { status: "empty" };

  const leaseToken = randomUUID();
  const claimed = await prisma.job.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: {
      status: "processing",
      startedAt: now,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + STALE_AFTER_MS),
    },
  });
  // Another executor won the race. The queue is not empty; this lane must retry.
  if (claimed.count !== 1) return { status: "contended" };
  return { status: "claimed", job: { ...candidate, leaseToken } };
}

/** Outcome of a single job execution. */
export type JobOutcome = "empty" | "contended" | "ok" | "failed";

/**
 * Failures that can never succeed on retry. Retrying an uninstalled App or bad
 * credentials five more times only burns GitHub API quota and delays real work.
 */
function isPermanentFailure(message: string): boolean {
  return (
    message.includes("App not installed") ||
    message.includes("Bad credentials") ||
    message.includes("Not Found") ||
    message.includes("unknown job kind") ||
    message.includes("malformed job payload")
  );
}

/**
 * Exponential backoff with equal jitter.
 *
 * Pure exponential backoff makes every job that failed for the same reason
 * retry at the same instant, forever in lockstep, which is exactly how one
 * GitHub rate-limit event turns into a synchronised thundering herd on the
 * next window. Half the delay is fixed and half is random, so retries spread
 * out while the ladder still grows.
 */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1));
  const capped = Math.min(base, 15 * 60_000);
  const half = capped / 2;
  return Math.round(half + random() * half);
}

/**
 * Clear the occupancy key and lease when a job reaches a terminal state.
 *
 * Every terminal write is fenced on `leaseToken`. Without the fence, an executor
 * whose lease lapsed mid-job would keep running and then stamp its own result
 * over the newer attempt's row: the wrong outcome would win purely by arrival
 * order. With it, a fenced-out write affects zero rows and the log says so.
 *
 * `startedAt` is deliberately PRESERVED on terminal rows. It is the timestamp
 * the latency report is computed from, and nulling it here made
 * `jobLatency()` match nothing at all: it filters on `status: "done"` *and*
 * `startedAt != null`, so clearing it here meant the p50/p95 figures on the
 * admin health page were permanently empty and nobody noticed, because an empty
 * latency table renders exactly like a healthy one.
 *
 * Liveness never depended on `startedAt` and still does not: the reclaim sweep
 * matches on `status: "processing"` plus the lease deadline, so a finished row
 * that keeps its start time can never be resurrected.
 */
async function finalize(
  job: ClaimedJob,
  data: {
    status: "pending" | "done" | "failed";
    attempts?: number;
    error?: string | null;
    nextAttemptAt?: Date | null;
    finishedAt?: Date | null;
    /** True when the job is going back to `pending`, where no attempt is live. */
    requeue?: boolean;
  },
): Promise<boolean> {
  // `requeue` is control flow, not a column. Spreading `data` wholesale put it
  // into the Prisma payload, where it is an unknown argument and every retry of
  // a failing job threw instead of being scheduled.
  const { requeue, ...fields } = data;
  const res = await prisma.job.updateMany({
    where: { id: job.id, status: "processing", leaseToken: job.leaseToken },
    data: {
      ...fields,
      startedAt: requeue ? null : undefined,
      leaseToken: null,
      leaseExpiresAt: null,
      dedupeKey: null,
    },
  });
  if (res.count === 1) return true;
  logger.warn("job-fenced", {
    id: job.id,
    kind: job.kind,
    leaseToken: job.leaseToken,
    attemptedStatus: data.status,
  });
  return false;
}

async function deadLetter(job: ClaimedJob, message: string): Promise<"failed"> {
  const fencedOut = !(await finalize(job, {
    status: "failed",
    attempts: job.attempts + 1,
    error: message.slice(0, 2000),
    finishedAt: new Date(),
  }));
  logger.warn("job-dead", {
    id: job.id,
    kind: job.kind,
    attempts: job.attempts + 1,
    fencedOut,
    error: message,
  });
  return "failed";
}

/**
 * Keep the claim's lease alive while a long job runs.
 *
 * Without this, a repository-intelligence collection against a large repo can
 * outlast the stale threshold and be reclaimed while its original executor is
 * still working, so two executors run the same GitHub-heavy job concurrently.
 * The lease is refreshed well inside `STALE_AFTER_MS` so a single slow refresh
 * cannot by itself cause a reclaim.
 */
function startHeartbeat(job: ClaimedJob): () => void {
  const timer = setInterval(() => {
    void prisma.job
      .updateMany({
        where: { id: job.id, status: "processing", leaseToken: job.leaseToken },
        data: { leaseExpiresAt: new Date(Date.now() + STALE_AFTER_MS) },
      })
      .catch((e) => logger.warn("job-heartbeat-failed", { id: job.id, error: String(e) }));
  }, HEARTBEAT_MS);
  // Never hold the process open on the heartbeat's account.
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Claim and execute one job.
 *
 * `empty` means the queue had no runnable work. It does NOT mean the queue is
 * empty overall, a retry scheduled into the future is still pending.
 * `contended` means another executor took the row first and the lane should try
 * again.
 */
export async function runClaimedJob(): Promise<JobOutcome> {
  const claim = await claimOne();
  if (claim.status !== "claimed") return claim.status === "empty" ? "empty" : "contended";

  const job = claim.job;
  const stopHeartbeat = startHeartbeat(job);
  const startedAt = Date.now();
  try {
    // Parsing and validation live INSIDE the try. Previously `payloadOf` ran
    // outside it, so a row with corrupt JSON threw out of `processOne` and left
    // the job stuck in `processing`; it was then reclaimed and thrown on again
    // forever. A poison row now dead-letters on first sight.
    const payload: JobPayload = payloadOf({ payloadJson: job.payloadJson });

    if (job.kind === "pr_refresh" && payload.kind === "pr_refresh") {
      await processPrRefresh(payload);
    } else if (job.kind === "install_register" && payload.kind === "install_register") {
      await processInstallRegister(payload.installationId);
    } else if (job.kind === "install_unregister" && payload.kind === "install_unregister") {
      const { handleUninstall } = await import("@/lib/github/install");
      await handleUninstall(payload.installationId);
    } else if (job.kind === "repo_intel" && payload.kind === "repo_intel") {
      const { processRepoIntel } = await import("@/lib/engine/runner");
      await processRepoIntel(payload);
    } else if (job.kind === "repo_automations" && payload.kind === "repo_automations") {
      // Dynamically imported: the workflow suite pulls in the intelligence
      // profile readers, which nothing on the hot webhook path needs.
      const { processRepoAutomations } = await import("@/lib/engine/runner");
      await processRepoAutomations(payload);
    } else {
      // `kind` on the row and `kind` inside the payload disagree, or neither is
      // recognised. Retrying cannot fix either case.
      throw new Error("unknown job kind");
    }

    // `startedAt` is preserved on terminal rows so the latency report can
    // measure this attempt. See `finalize`.
    // `error` is cleared on success. A job that was reclaimed once carries the
    // reclaim's "lease expired" text, and leaving it on a `done` row makes a
    // successfully completed job report a failure it no longer has.
    const fencedOut = !(await finalize(job, { status: "done", error: null, finishedAt: new Date() }));
    logger.debug("job-done", {
      id: job.id,
      kind: job.kind,
      ms: Date.now() - startedAt,
      fencedOut,
    });
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("malformed job payload")) return deadLetter(job, message);

    const permanent = isPermanentFailure(message);
    const attempts = job.attempts + 1;

    if (permanent || attempts >= job.maxAttempts) {
      await finalize(job, {
        status: "failed",
        attempts,
        error: message.slice(0, 2000),
        finishedAt: new Date(),
      });
      logger.warn("job-dead", { id: job.id, kind: job.kind, attempts, error: message });
      return "failed";
    }

    // Exponential backoff with jitter, then requeue for a later attempt.
    const delayMs = retryDelayMs(attempts);
    await finalize(job, {
      status: "pending",
      attempts,
      nextAttemptAt: new Date(Date.now() + delayMs),
      error: message.slice(0, 2000),
      requeue: true,
    });
    logger.warn("job-retry-scheduled", {
      id: job.id,
      kind: job.kind,
      attempts,
      retryInMs: delayMs,
      error: message,
    });
    return "failed";
  } finally {
    stopHeartbeat();
  }
}

export interface DrainOptions {
  /** Hard cap on jobs executed by this call. */
  maxJobs?: number;
  /**
   * Wall-clock ceiling. The drain stops claiming new work once this is nearly
   * exhausted so the response (and its metrics) always have time to be written
   * inside a serverless function's duration limit.
   */
  budgetMs?: number;
  /** Parallel executors. Capped to 16 to stay within DB connection limits. */
  concurrency?: number;
  /** Correlates drain logs; surfaced in the response and admin health. */
  label?: string;
}

export type DrainStopReason = "drained" | "max_jobs" | "budget_exhausted" | "contended";

export interface DrainResult {
  label: string;
  processed: number;
  failed: number;
  recovered: number;
  durationMs: number;
  stopReason: DrainStopReason;
  /** Unfinished work still queued after this drain. */
  remaining: number;
  /** Compare-and-swap races observed. Non-zero is normal under concurrency. */
  contended: number;
}

/** Headroom reserved for the trailing metrics query and the HTTP response. */
const RESPONSE_RESERVE_MS = 750;

/**
 * Consecutive CAS losses a lane tolerates before giving up.
 *
 * Every lane reads the same head row, so the first round of a concurrent drain
 * always produces one winner and N-1 losers. Those losers must retry or the
 * configured concurrency is decorative. The cap exists only so a pathological
 * workload (a queue whose head row is being rewritten by another process
 * continuously) cannot spin a lane inside the remaining time budget.
 */
const MAX_CONSECUTIVE_CONTENTION = 12;

/**
 * Drain the job queue with a bounded job count *and* a bounded time budget.
 *
 * This is the primitive that makes Baton work on a serverless host. A
 * long-running `setInterval` worker cannot run on Vercel: functions are
 * request-scoped and frozen between requests, so the loop would make no
 * progress after the first tick. Instead, bounded drains are triggered from two
 * places that together cover both latency and durability:
 *
 *  1. inline, right after a webhook enqueues work (near-real-time), and
 *  2. on a schedule (catch-up after downtime, and the periodic repo sweep).
 *
 * Both use the same atomic claiming, so running them concurrently with a
 * long-lived worker process is safe.
 */
export async function drainQueue(options: DrainOptions = {}): Promise<DrainResult> {
  const maxJobs = Math.max(0, options.maxJobs ?? 25);
  const budgetMs = Math.max(0, options.budgetMs ?? 20_000);
  const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), 16);
  const label = options.label ?? "drain";
  const started = Date.now();
  const deadline = started + budgetMs;

  const recovered = await recoverStaleJobs(STALE_AFTER_MS, { force: true });

  let processed = 0;
  let failed = 0;
  let completed = 0;
  let contended = 0;
  let stopReason: DrainStopReason = "drained";

  const runLane = async (): Promise<void> => {
    let consecutiveContention = 0;
    for (;;) {
      // The job slot is reserved BEFORE claiming, not counted afterwards.
      //
      // Counting after execution meant each lane read the counter before the
      // others had incremented it, so every lane in flight simultaneously
      // decided there was room for one more and `maxJobs` was overshot by up to
      // `concurrency - 1`. That is not a rounding detail: the whole reason the
      // counter exists is to keep a drain inside its time budget, and the jobs
      // it overshoots into are claimed work it may have no budget to finish.
      //
      // There is no `await` between the check and the increment, so this
      // reservation is atomic with respect to the other lanes.
      if (completed >= maxJobs) {
        stopReason = stopReason === "drained" ? "max_jobs" : stopReason;
        return;
      }
      completed += 1;

      // Stop *before* claiming when the budget is nearly gone. Claiming work we
      // cannot finish would strand it in `processing` until the reclaim sweep.
      if (Date.now() + RESPONSE_RESERVE_MS >= deadline) {
        stopReason = "budget_exhausted";
        completed -= 1;
        return;
      }

      let outcome: JobOutcome;
      try {
        outcome = await runClaimedJob();
      } catch (e) {
        // A crash in the runner itself must not kill the whole drain. The slot
        // stays spent: work was attempted.
        logger.error("drain-lane-error", { label, error: String(e) });
        failed += 1;
        continue;
      }

      if (outcome === "contended") {
        // Nothing was claimed, so the slot goes back for another attempt.
        completed -= 1;
        contended += 1;
        consecutiveContention += 1;
        if (consecutiveContention >= MAX_CONSECUTIVE_CONTENTION) {
          stopReason = "contended";
          return;
        }
        // Yield the row to the winner. Without a pause, N lanes re-read the same
        // head row in lockstep and one of them keeps losing.
        await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
        continue;
      }

      // A win (or a genuinely empty queue) ends this lane's contention streak.
      consecutiveContention = 0;
      if (outcome === "empty") {
        // Nothing ran, so the reservation is released rather than spent.
        completed -= 1;
        return; // nothing runnable left for this lane
      }
      if (outcome === "ok") processed += 1;
      else failed += 1;
    }
  };

  const lanes = Math.min(concurrency, Math.max(1, maxJobs));
  await Promise.all(Array.from({ length: lanes }, runLane));

  let remaining = 0;
  try {
    remaining = await prisma.job.count({
      where: { status: { in: ["pending", "processing"] } },
    });
  } catch (e) {
    logger.error("drain-metrics-failed", { label, error: String(e) });
  }

  const result: DrainResult = {
    label,
    processed,
    failed,
    recovered,
    durationMs: Date.now() - started,
    stopReason,
    remaining,
    contended,
  };

  logger.info("queue-drain", { ...result });
  return result;
}

/**
 * One-shot claim+execute, used by the standalone long-lived worker process.
 * Kept for operators who run `npm run worker` on a container host.
 */
export async function processOne(): Promise<JobOutcome> {
  await recoverStaleJobs();
  return runClaimedJob();
}
