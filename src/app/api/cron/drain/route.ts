import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { drainQueue } from "@/lib/engine/job-runner";
import { queueSnapshot } from "@/lib/engine/queue-metrics";
import { config } from "@/lib/env-boot";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled catch-up drain (Vercel Cron target: `/api/cron/drain`).
 *
 * Webhooks drain a small batch inline for latency; this endpoint is the
 * durability half. It is what makes Baton recover after downtime: without a
 * scheduler, a deploy, crash, or freeze leaves every queued job stuck in
 * `pending` forever and no PR is ever classified.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const drain = await drainQueue({
    maxJobs: config.BATON_DRAIN_MAX_JOBS,
    budgetMs: config.BATON_DRAIN_BUDGET_MS,
    concurrency: config.BATON_DRAIN_CONCURRENCY,
    label: "cron-drain",
  });

  const snapshot = await queueSnapshot();
  const stalled = snapshot.stalled;

  if (stalled) {
    logger.error("queue-stalled", {
      pending: snapshot.pending,
      oldestPendingAgeSec: snapshot.oldestPendingAgeSec,
    });
  }

  return NextResponse.json({ ok: true, drain, queue: snapshot }, { status: 200 });
}

/** HEAD gives an operator a cheap authenticated liveness probe for the queue. */
export async function HEAD(req: Request): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return new NextResponse(null, { status: 401 });
  }
  const snapshot = await queueSnapshot();
  return new NextResponse(snapshot.pending > 0 ? "busy" : "idle", {
    status: 200,
    headers: {
      "x-baton-queue-pending": String(snapshot.pending),
      "x-baton-queue-oldest-age": String(snapshot.oldestPendingAgeSec ?? ""),
    },
  });
}
