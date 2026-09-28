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

export interface JobLatency {
  kind: string;
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

/**
 * How long jobs actually take, per kind (aa.md §26 "job latency").
 *
 * Queue depth alone cannot distinguish "GitHub API is slow right now" from
 * "the worker is the bottleneck", because both present as a growing backlog.
 * The duration of finished work is what separates them.
 *
 * Computed in the application rather than with `percentile_cont` so it works on
 * both SQLite (the test harness) and PostgreSQL (production) without a second
 * dialect-specific query. The window is bounded and the row count is capped, so
 * this stays cheap enough for an admin page that polls.
 */
export async function jobLatency(
  windowHours = 24,
  limit = 2000,
): Promise<{ overall: JobLatency | null; byKind: JobLatency[] }> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await prisma.job.findMany({
    where: { status: "done", finishedAt: { gte: since }, startedAt: { not: null } },
    select: { kind: true, startedAt: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
    take: limit,
  });

  const durations = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.startedAt || !r.finishedAt) continue;
    const ms = r.finishedAt.getTime() - r.startedAt.getTime();
    if (ms < 0) continue; // Clock skew or a partially written row; not a latency sample.
    const list = durations.get(r.kind) ?? [];
    list.push(ms);
    durations.set(r.kind, list);
  }

  const summarise = (kind: string, values: number[]): JobLatency => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
    return {
      kind,
      samples: sorted.length,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      maxMs: sorted.length ? sorted[sorted.length - 1]! : null,
    };
  };

  const all = [...durations.values()].flat();
  return {
    overall: all.length ? summarise("all", all) : null,
    byKind: [...durations.entries()]
      .map(([kind, values]) => summarise(kind, values))
      .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)),
  };
}

export interface JobFailure {
  id: string;
  kind: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  updatedAt: Date;
}

/**
 * The most recent terminal failures, with the error that caused them.
 *
 * `queueSnapshot().failed` answers "is anything broken"; this answers "what is
 * broken and why", which is the question an operator actually has at 3am. The
 * error string is truncated because a Prisma error can carry a full statement
 * and the table has to stay readable.
 */
export async function recentJobFailures(limit = 20): Promise<JobFailure[]> {
  const rows = await prisma.job.findMany({
    where: { status: "failed" },
    select: { id: true, kind: true, attempts: true, maxAttempts: true, error: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    ...r,
    error: r.error ? r.error.slice(0, 400) : null,
  }));
}
