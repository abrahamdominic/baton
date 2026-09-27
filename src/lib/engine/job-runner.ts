import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { payloadOf, type JobPayload } from "@/lib/engine/jobs";
import { processPrRefresh, processInstallRegister } from "@/lib/engine/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A job that has been atomically moved to `processing`. The row is owned by
 * exactly one executor until it is marked `done`/`failed` or reclaimed by
 * `recoverStaleJobs`.
 */
export interface ClaimedJob {
  id: string;
  kind: string;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
}

/** Jobs claimed but never finished are considered abandoned after this long. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Throttle for the standalone worker's reclaim sweep (see `recoverStaleJobs`). */
const RECOVER_INTERVAL_MS = 60_000;
let lastRecoverAt = 0;

/**
 * Requeue jobs that were claimed but never finished.
 *
 * This exists because a serverless executor can be frozen or terminated
 * mid-job (Vercel recycles instances, a container is killed, an OOM occurs).
 * Without reaping, those rows sit in `processing` forever and their work is
 * silently lost: the queue looks idle while PRs are never classified.
 *
 * Called once per drain rather than once per claim. The original code ran this
 * `updateMany` before *every* single claim, which meant draining 50 jobs
 * issued 50 extra writes — pure write amplification on the hot path.
 */
export async function recoverStaleJobs(
  maxAgeMs: number = STALE_AFTER_MS,
  options: { force?: boolean } = {},
): Promise<number> {
  const now = Date.now();
  if (!options.force && now - lastRecoverAt < RECOVER_INTERVAL_MS) return 0;
  lastRecoverAt = now;

  const res = await prisma.job.updateMany({
    where: { status: "processing", startedAt: { lt: new Date(now - maxAgeMs) } },
    data: { status: "pending", startedAt: null },
  });

  if (res.count > 0) {
    logger.warn("queue-stale-recovered", { count: res.count });
  }
  return res.count;
}

/**
 * Atomically claim one runnable job (safe across concurrent executors).
 *
 * Uses a conditional `updateMany` as a compare-and-swap: if another executor
 * won the race between `findFirst` and `updateMany`, `count` is 0 and we report
 * "nothing claimed" so the caller can retry rather than double-process.
 *
 * Ordering follows the `[status, createdAt]` index, so this stays a single
 * indexed scan instead of sorting the whole pending set.
 */
export async function claimOne(): Promise<ClaimedJob | null> {
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
  if (!candidate) return null;

  const claimed = await prisma.job.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: { status: "processing", startedAt: now },
  });
  if (claimed.count !== 1) return null; // another executor won the race
  return candidate;
}

/** Outcome of a single job execution. */
export type JobOutcome = "empty" | "ok" | "failed";

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

async function deadLetter(job: ClaimedJob, message: string): Promise<"failed"> {
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "failed", startedAt: null, error: message.slice(0, 2000) },
  });
  logger.warn("job-dead", {
    id: job.id,
    kind: job.kind,
    attempts: job.attempts + 1,
    error: message,
  });
  return "failed";
}

/**
 * Claim and execute one job.
 *
 * `empty` means the queue had no runnable work. It does NOT mean the queue is
 * empty overall — a retry scheduled into the future is still pending.
 */
export async function runClaimedJob(): Promise<JobOutcome> {
  const job = await claimOne();
  if (!job) return "empty";

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
    } else {
      // `kind` on the row and `kind` inside the payload disagree, or neither is
      // recognised. Retrying cannot fix either case.
      throw new Error("unknown job kind");
    }

    // `startedAt` is cleared on every terminal transition, matching the failure
    // path. Leaving it set on a `done` row makes the row claim it may still be
    // executing to any query that does not also filter on status.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "done", finishedAt: new Date(), startedAt: null },
    });
    logger.debug("job-done", {
      id: job.id,
      kind: job.kind,
      ms: Date.now() - startedAt,
    });
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("malformed job payload")) return deadLetter(job, message);

    const permanent = isPermanentFailure(message);
    const attempts = job.attempts + 1;

    if (permanent || attempts >= job.maxAttempts) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts,
          error: message.slice(0, 2000),
          startedAt: null,
        },
      });
      logger.warn("job-dead", { id: job.id, kind: job.kind, attempts, error: message });
      return "failed";
    }

    // Exponential backoff, then requeue for a later attempt.
    const delayMs = 30_000 * Math.pow(2, attempts - 1);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "pending",
        attempts,
        nextAttemptAt: new Date(Date.now() + delayMs),
        startedAt: null,
        error: message.slice(0, 2000),
      },
    });
    logger.warn("job-retry-scheduled", {
      id: job.id,
      kind: job.kind,
      attempts,
      retryInMs: delayMs,
      error: message,
    });
    return "failed";
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

export type DrainStopReason = "drained" | "max_jobs" | "budget_exhausted";

export interface DrainResult {
  label: string;
  processed: number;
  failed: number;
  recovered: number;
  durationMs: number;
  stopReason: DrainStopReason;
  /** Unfinished work still queued after this drain. */
  remaining: number;
}

/** Headroom reserved for the trailing metrics query and the HTTP response. */
const RESPONSE_RESERVE_MS = 750;

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
  let stopReason: DrainStopReason = "drained";

  const runLane = async (): Promise<void> => {
    for (;;) {
      if (completed >= maxJobs) {
        stopReason = stopReason === "drained" ? "max_jobs" : stopReason;
        return;
      }
      // Stop *before* claiming when the budget is nearly gone. Claiming work we
      // cannot finish would strand it in `processing` until the reclaim sweep.
      if (Date.now() + RESPONSE_RESERVE_MS >= deadline) {
        stopReason = "budget_exhausted";
        return;
      }

      let outcome: JobOutcome;
      try {
        outcome = await runClaimedJob();
      } catch (e) {
        // A crash in the runner itself must not kill the whole drain.
        logger.error("drain-lane-error", { label, error: String(e) });
        completed += 1;
        failed += 1;
        continue;
      }

      if (outcome === "empty") return; // nothing runnable left for this lane
      completed += 1;
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
