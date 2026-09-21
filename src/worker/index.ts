import { config } from "../lib/env-boot";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { processOne } from "../lib/engine/job-runner";

/**
 * Baton background worker: polls the Job queue, runs N processors in parallel.
 * The periodic repo sweep is scheduled externally (hosted cron → cron.ts).
 *
 * Run with:  npm run worker
 */
export async function main(): Promise<never> {
  logger.info("worker-start", {
    concurrency: config.BATON_JOB_CONCURRENCY,
    pollMs: config.BATON_WORKER_POLL_MS,
  });

  const tick = async (): Promise<void> => {
    await Promise.all(
      Array.from({ length: config.BATON_JOB_CONCURRENCY }, () =>
        processOne().catch((e) => {
          logger.error("worker-step-error", { error: String(e) });
          return "failed" as const;
        }),
      ),
    );
  };

  void tick();
  setInterval(tick, config.BATON_WORKER_POLL_MS).unref();

  return await new Promise<never>(() => {});
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((e) => {
    logger.error("worker-fatal", { error: String(e) });
    process.exit(1);
  });
}

export { prisma };