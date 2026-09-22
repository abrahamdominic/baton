import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { sweepEnabledRepos } from "../lib/engine/sweep";
import { enqueuePrRefresh } from "../lib/engine/jobs";
import { config } from "../lib/env-boot";
import { runBillingHousekeeping } from "../lib/billing/subscriptions";

/**
 * Hosted-cron entrypoint: performs one full sweep of every enabled repo and
 * enqueues refreshes for all open PRs, plus billing housekeeping (expiring
 * past-due subscriptions, completing cancellations, failing orphaned pending
 * checkouts). Exits when done.
 *
 * Run with:  npm run cron   (expected to be triggered by Vercel Cron / GitHub
 * Actions schedule; this process exits after one pass).
 */
export async function runOnce(): Promise<{
  repos: number;
  prsEnqueued: number;
  billing: Awaited<ReturnType<typeof runBillingHousekeeping>>;
}> {
  logger.info("cron-start", { intervalMinutes: config.BATON_CRON_INTERVAL_MIN });
  const sweep = await sweepEnabledRepos();
  const billing = await runBillingHousekeeping();
  return { ...sweep, billing };
}

if (process.argv[1]?.endsWith("cron.ts")) {
  runOnce()
    .then((res) => {
      logger.info("cron-done", res);
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      logger.error("cron-fatal", { error: String(e) });
      process.exit(1);
    });
}

export { enqueuePrRefresh };