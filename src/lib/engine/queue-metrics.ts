import { prisma } from "@/lib/db";

/**
 * Operational view of the job queue.
 *
 * The admin health page previously showed raw status counts, which made a
 * *stuck* queue look identical to a *busy* one: if nothing drains the queue,
 * `pending` climbs, but nothing in the UI says "work is waiting and nobody is
 * picking it up". Queue age is the signal that actually distinguishes the two,
 * so it is computed here and surfaced everywhere queue state is read.
 */
export interface QueueSnapshot {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  /** Pending jobs whose retry backoff has not yet elapsed. */
  deferred: number;
  /** Pending and runnable right now. */
  runnable: number;
  /** Age of the oldest unfinished job, in seconds. Null when idle. */
  oldestPendingAgeSec: number | null;
  completedLast24h: number;
  failedLast24h: number;
  /** True when the queue has work but nothing is progressing it. */
  stalled: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function queueSnapshot(now: Date = new Date()): Promise<QueueSnapshot> {
  const since = new Date(now.getTime() - DAY_MS);
  const nowMs = now.getTime();

  const [byStatus, oldest, deferred, completedLast24h, failedLast24h] =
    await Promise.all([
      prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.job.aggregate({
        _min: { createdAt: true },
        where: { status: { in: ["pending", "processing"] } },
      }),
      prisma.job.count({
        where: { status: "pending", nextAttemptAt: { gt: now } },
      }),
      prisma.job.count({ where: { status: "done", finishedAt: { gte: since } } }),
      prisma.job.count({ where: { status: "failed", updatedAt: { gte: since } } }),
    ]);

  const counts: Record<string, number> = {};
  for (const row of byStatus) counts[row.status] = row._count._all;

  const pending = counts.pending ?? 0;
  const processing = counts.processing ?? 0;
  const oldestCreatedAt = oldest._min.createdAt;
  const oldestPendingAgeSec = oldestCreatedAt
    ? Math.max(0, Math.round((nowMs - oldestCreatedAt.getTime()) / 1000))
    : null;

  return {
    pending,
    processing,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    deferred,
    runnable: Math.max(0, pending - deferred),
    oldestPendingAgeSec,
    completedLast24h,
    failedLast24h,
    // Work is waiting, nothing is in flight, and the oldest item has been
    // sitting long enough that no drain has touched it.
    stalled: pending > 0 && processing === 0 && (oldestPendingAgeSec ?? 0) > 900,
  };
}
