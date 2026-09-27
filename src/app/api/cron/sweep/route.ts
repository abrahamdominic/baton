import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { config } from "@/lib/env-boot";
import { logger } from "@/lib/logger";
import { runSweepOnce } from "@/lib/engine/sweep-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduled sweep (Vercel Cron target: `/api/cron/sweep`).
 *
 * Webhooks only fire for events GitHub sends us. A repo whose PR opened while
 * Baton was down, or one where a webhook was dropped, is never seen again.
 * This endpoint re-scans every enabled repository so state converges instead
 * of drifting. It also runs billing housekeeping.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSweepOnce();
    logger.info("cron-sweep-done", { ...result });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    logger.error("cron-sweep-fatal", {
      error: e instanceof Error ? e.message : String(e),
      intervalMinutes: config.BATON_CRON_INTERVAL_MIN,
    });
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
