import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { runSweepOnce, type SweepResult } from "../lib/engine/sweep-run";

/**
 * Hosted-cron CLI entrypoint: performs one full sweep of every enabled repo and
 * enqueues refreshes for all open PRs, plus billing housekeeping (expiring
 * past-due subscriptions, completing cancellations, failing orphaned pending
 * checkouts). Exits when done.
 *
 * On Vercel the sweep runs as a scheduled function instead:
 *   GET /api/cron/sweep   (see vercel.json)
 *
 * Run with:  npm run cron
 */
export const runOnce = runSweepOnce;
export type { SweepResult };

if (process.argv[1]?.endsWith("cron.ts")) {
  runOnce()
    .then((res) => {
      logger.info("cron-done", { ...res });
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      logger.error("cron-fatal", { error: String(e) });
      process.exit(1);
    });
}
