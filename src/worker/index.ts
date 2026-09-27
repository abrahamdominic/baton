import { config } from "../lib/env-boot";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { drainQueue } from "../lib/engine/job-runner";

/**
 * Baton background worker (long-lived process).
 *
 * Use this when you have a container/VM host — Fly.io, Railway, Render, ECS.
 * On Vercel this CANNOT run: functions are request-scoped and frozen between
 * requests, so a `setInterval` loop makes no progress past its first tick. Vercel
 * deployments execute queued work through bounded drains instead — inline after
 * a webhook (`/api/webhooks`) and on a schedule (`/api/cron/drain`).
 *
 * Both paths use the same atomic job claiming, so running this process next to
 * a Vercel deployment is safe: each job is processed exactly once.
 *
 * Run with:  npm run worker
 */
export async function main(): Promise<void> {
  logger.info("worker-start", {
    concurrency: config.BATON_JOB_CONCURRENCY,
    pollMs: config.BATON_WORKER_POLL_MS,
  });

  let stopping = false;
  const tick = async (): Promise<void> => {
    if (stopping) return;
    try {
      // Bounded per tick: a single iteration drains a limited batch rather than
      // looping forever, so the shutdown handler can actually be honoured and
      // one slow job cannot monopolise the process.
      await drainQueue({
        maxJobs: config.BATON_JOB_CONCURRENCY,
        budgetMs: config.BATON_WORKER_POLL_MS * 2,
        concurrency: config.BATON_JOB_CONCURRENCY,
        label: "worker",
      });
    } catch (e) {
      logger.error("worker-tick-error", { error: String(e) });
    }
  };

  // A tick must never overlap the previous one, otherwise a slow batch causes
  // ticks to pile up and the process spends its time re-entering the queue.
  let ticking = false;
  const safeTick = async (): Promise<void> => {
    if (ticking || stopping) return;
    ticking = true;
    try {
      await tick();
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void safeTick(), config.BATON_WORKER_POLL_MS);
  timer.unref();
  await safeTick();

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      if (stopping) return;
      stopping = true;
      logger.info("worker-shutdown", { signal });
      clearInterval(timer);
      // Release the pool and exit cleanly so a rolling deploy does not report
      // the old instance as crashed, and in-flight DB handles are closed.
      void prisma
        .$disconnect()
        .catch((e) => logger.error("worker-disconnect-failed", { error: String(e) }))
        .finally(() => resolve());
    };

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => shutdown(signal));
    }
  });

  logger.info("worker-stopped");
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((e) => {
    logger.error("worker-fatal", { error: String(e) });
    process.exit(1);
  });
}

export { prisma };
