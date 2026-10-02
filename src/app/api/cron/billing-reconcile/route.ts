import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { reconcileBillingSubscriptions } from "@/lib/billing/reconcile";
import { isStripeConfigured } from "@/lib/config";
import { config } from "@/lib/env-boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduled billing reconciliation (Vercel Cron target:
 * `/api/cron/billing-reconcile`).
 *
 * Stripe webhooks are the fast path for keeping local subscription state in
 * step, and they are also lossy: events are dropped while an endpoint is
 * unavailable, retried for a limited window, and never replayed after that. A
 * renewal that happens during a bad deploy therefore leaves the local row
 * believing a lapsed customer is still active, indefinitely, until something
 * else happens to overwrite it.
 *
 * This pass closes that hole. It walks Stripe-backed subscriptions oldest-update
 * first, compares each against Stripe, repairs what diverged through the same
 * validated state machine the webhooks use, and records the outcome in
 * `billing_reconciliation_runs` so "billing state matches Stripe" is an
 * auditable claim rather than an assumption.
 *
 * It is a catch-up, not a hot path, so a daily schedule is deliberate: the
 * window it covers is exactly the one where a missed webhook would otherwise be
 * permanent.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isStripeConfigured(config)) {
    // Not an error: a deployment without Stripe credentials has no Stripe state
    // to reconcile against, and failing loudly every day would just be noise in
    // the logs of a self-hosted install.
    logger.info("billing-reconcile-skipped", { reason: "stripe_not_configured" });
    return NextResponse.json({ ok: true, skipped: true, reason: "stripe_not_configured" }, { status: 200 });
  }

  try {
    const result = await reconcileBillingSubscriptions({
      limit: config.BATON_BILLING_RECONCILE_LIMIT,
      trigger: "cron",
    });
    logger.info("cron-billing-reconcile-done", { ...result, discrepancies: result.discrepancies.length });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    logger.error("cron-billing-reconcile-fatal", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "reconciliation_failed" }, { status: 500 });
  }
}
