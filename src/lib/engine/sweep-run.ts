import { logger } from "@/lib/logger";
import { sweepEnabledRepos } from "@/lib/engine/sweep";
import { config } from "@/lib/env-boot";
import { runBillingHousekeeping } from "@/lib/billing/subscriptions";

export interface SweepResult {
  repos: number;
  prsEnqueued: number;
  intelEnqueued: number;
  billing: Awaited<ReturnType<typeof runBillingHousekeeping>>;
}

/**
 * One full maintenance pass: rescan every enabled repository (enqueueing a
 * refresh for each open PR) and run billing housekeeping.
 *
 * Webhooks only cover events GitHub actually sends. A repository whose PR was
 * opened while Baton was down, or whose webhook delivery was dropped, is never
 * seen again. This pass makes stored state converge instead of drift.
 *
 * Shared by the scheduled route handler (`/api/cron/sweep`) and the standalone
 * `npm run cron` CLI, so both execute identical logic.
 */
export async function runSweepOnce(): Promise<SweepResult> {
  logger.info("sweep-start", { intervalMinutes: config.BATON_CRON_INTERVAL_MIN });
  const sweep = await sweepEnabledRepos();
  const billing = await runBillingHousekeeping();
  return { ...sweep, billing };
}
