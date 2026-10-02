import "server-only";
import type Stripe from "stripe";
import { getAdminClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import { getStripe } from "./stripe";
import {
  loadPriceIndex,
  resolveSubscriptionPlan,
  intervalFromPeriod,
  type PriceBinding,
} from "./stripe-price-map";
import { transitionSubscription } from "./subscriptions";
import { validateTransition } from "./subscription-machine";
import { recordSystemEvent } from "./system-events";
import { subscriptionFromRow, type Row } from "./records";
import type { SubscriptionRecord, SubscriptionStatus } from "./types";

/**
 * Billing reconciliation: prove local subscription state still matches Stripe.
 *
 * Webhooks are the fast path, not the source of truth. They are dropped when an
 * endpoint is unavailable, they can be delivered out of order relative to each
 * other, and a deployment that was down for a day misses every renewal in that
 * window. Stripe is the authority for whether someone is paying; this pass
 * compares the two sides and repairs what diverged, so a missed webhook becomes a
 * self-healing discrepancy instead of a customer who stopped paying and kept
 * their access.
 *
 * Two rules shape everything below:
 *
 *  1. Stripe wins. Local state is derived, not authoritative.
 *  2. Repairs go through the same validated state machine the webhooks use. A
 *     repair that the machine refuses is reported as unrepaired rather than
 *     forced, because a forced write is how a database ends up holding a status
 *     the rest of the product has no way to interpret.
 */

/** Stripe timestamps are second-resolution; allow small drift before calling it a bug. */
const PERIOD_TOLERANCE_MS = 60_000;

export type DiscrepancyKind =
  | "status_mismatch"
  | "period_mismatch"
  | "plan_mismatch"
  | "cancel_flag_mismatch"
  | "missing_on_stripe"
  | "unmapped_price"
  | "provider_pair_violation";

export interface Discrepancy {
  subscriptionId: string;
  userId: string;
  stripeSubscriptionId: string | null;
  kind: DiscrepancyKind;
  local: string | null;
  stripe: string | null;
  repaired: boolean;
  repairError: string | null;
}

/** The subset of Stripe state reconciliation compares. */
export interface StripeSnapshot {
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  planId: string | null;
}

function iso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

export function snapshotFromStripe(
  stripeSub: Stripe.Subscription,
  priceIndex: Map<string, PriceBinding>,
): StripeSnapshot {
  const resolved = resolveSubscriptionPlan(stripeSub, priceIndex);
  return {
    status: String(stripeSub.status),
    currentPeriodStart: iso(stripeSub.current_period_start),
    currentPeriodEnd: iso(stripeSub.current_period_end),
    cancelAtPeriodEnd: Boolean(stripeSub.cancel_at_period_end),
    planId: resolved?.binding.planId ?? null,
  };
}

/**
 * The local status Stripe's status implies.
 *
 * `cancel_at_period_end` wins over `active`: Stripe keeps reporting an active
 * subscription right up to the period end after a cancellation is requested, and
 * the local row has to say `active_until_period_end` from that moment or the UI
 * offers a "reactivate" button for a subscription that is about to disappear.
 *
 * Returns null when Stripe's status is one Baton has no equivalent for (a trial
 * ending, a paused collection) and the local status should be left alone rather
 * than guessed at.
 */
export function expectedLocalStatus(
  stripeStatus: string,
  cancelAtPeriodEnd: boolean,
  current: SubscriptionStatus,
): SubscriptionStatus | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd ? "active_until_period_end" : "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
    case "paused":
      return "expired";
    case "incomplete":
      return "pending";
    case "incomplete_expired":
      return "payment_failed";
    default:
      // `trialing` is handled above; anything else is either unknown to this
      // Stripe version or deliberately non-billing. Keep what we have.
      return current;
  }
}

function periodsDiffer(local: string | null, stripe: string | null): boolean {
  if (local === null || stripe === null) return local !== stripe;
  const a = Date.parse(local);
  const b = Date.parse(stripe);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return local !== stripe;
  return Math.abs(a - b) > PERIOD_TOLERANCE_MS;
}

export interface ComparisonResult {
  discrepancies: Omit<Discrepancy, "repaired" | "repairError">[];
  /** Fields that need writing, keyed by subscription id. */
  repairs: Map<string, { planId?: string; status?: SubscriptionStatus; cancelAtPeriodEnd?: boolean }>;
}

/**
 * Compare one local row against Stripe and work out what should change.
 *
 * Pure: no database, no network. Everything worth asserting about reconciliation
 * lives here precisely so it can be tested without either.
 */
export function compareSubscription(
  local: SubscriptionRecord,
  snapshot: StripeSnapshot,
  localPlanId: string | null,
): ComparisonResult {
  const discrepancies: Omit<Discrepancy, "repaired" | "repairError">[] = [];
  const repairs = new Map<string, { planId?: string; status?: SubscriptionStatus; cancelAtPeriodEnd?: boolean }>();
  const repair = repairs.get(local.id) ?? {};

  const base = {
    subscriptionId: local.id,
    userId: local.user_id,
    stripeSubscriptionId: local.provider_subscription_id,
  };

  // Plan first: an unmapped price is a configuration problem, and changing the
  // plan on a guess is worse than leaving it and saying so.
  if (snapshot.planId === null) {
    discrepancies.push({ ...base, kind: "unmapped_price", local: localPlanId, stripe: null });
  } else if (snapshot.planId !== localPlanId) {
    discrepancies.push({ ...base, kind: "plan_mismatch", local: localPlanId, stripe: snapshot.planId });
    repair.planId = snapshot.planId;
  }

  const expectedStatus = expectedLocalStatus(snapshot.status, snapshot.cancelAtPeriodEnd, local.status);
  if (expectedStatus !== null && expectedStatus !== local.status) {
    discrepancies.push({
      ...base,
      kind: "status_mismatch",
      local: local.status,
      stripe: expectedStatus,
    });
    repair.status = expectedStatus;
  }

  if (snapshot.cancelAtPeriodEnd !== local.cancel_at_period_end) {
    discrepancies.push({
      ...base,
      kind: "cancel_flag_mismatch",
      local: String(local.cancel_at_period_end),
      stripe: String(snapshot.cancelAtPeriodEnd),
    });
    repair.cancelAtPeriodEnd = snapshot.cancelAtPeriodEnd;
  }

  if (
    periodsDiffer(local.current_period_start, snapshot.currentPeriodStart) ||
    periodsDiffer(local.current_period_end, snapshot.currentPeriodEnd)
  ) {
    discrepancies.push({
      ...base,
      kind: "period_mismatch",
      local: `${local.current_period_start ?? "null"}..${local.current_period_end ?? "null"}`,
      stripe: `${snapshot.currentPeriodStart ?? "null"}..${snapshot.currentPeriodEnd ?? "null"}`,
    });
  }

  if (repair.planId !== undefined || repair.status !== undefined) repairs.set(local.id, repair);

  return { discrepancies, repairs };
}

/** The period fields of a repair, which live outside the transition options. */
function periodPatch(snapshot: StripeSnapshot): Record<string, unknown> {
  return {
    current_period_start: snapshot.currentPeriodStart,
    current_period_end: snapshot.currentPeriodEnd,
    cancel_at_period_end: snapshot.cancelAtPeriodEnd,
  };
}

/**
 * Apply one repair plan.
 *
 * The status change goes through `transitionSubscription` so the state machine
 * validates it and a lifecycle event is written; the period and cancel flag are
 * patched directly because they are facts, not lifecycle decisions. An illegal
 * transition is caught and reported: the run continues with the next row.
 */
async function applyRepair(
  local: SubscriptionRecord,
  snapshot: StripeSnapshot,
  repair: { planId?: string; status?: SubscriptionStatus; cancelAtPeriodEnd?: boolean },
): Promise<string | null> {
  const sb = getAdminClient();

  if (repair.status !== undefined && repair.status !== local.status) {
    const error = validateTransition(local.status, repair.status);
    if (error) {
      return `illegal transition ${error.from} → ${error.to}`;
    }
    await transitionSubscription(local.id, {
      to: repair.status,
      eventType: "subscription_reconciled",
      source: "system",
      reason: `Reconciled against Stripe: local ${local.status} did not match Stripe "${snapshot.status}"`,
      planId: repair.planId ?? undefined,
      ...(repair.status === "expired" || repair.status === "canceled"
        ? { endedAt: new Date().toISOString() }
        : {}),
    });
  } else if (repair.planId !== undefined && repair.planId !== local.plan_id) {
    await transitionSubscription(local.id, {
      to: local.status,
      eventType: "subscription_reconciled",
      source: "system",
      reason: `Reconciled against Stripe: plan did not match the subscribed price`,
      planId: repair.planId,
    });
  }

  // The window is written even when only the plan changed: Stripe is the
  // authority on the period, so it is synced opportunistically rather than
  // waiting for the next renewal to overwrite it.
  const { error: patchError } = await sb
    .from("subscriptions")
    .update({ ...periodPatch(snapshot), updated_at: new Date().toISOString() })
    .eq("id", local.id);
  if (patchError) return `period update failed: ${patchError.message}`;

  return null;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  runId: string | null;
  skipped: boolean;
  scanned: number;
  repaired: number;
  failed: number;
  discrepancies: Discrepancy[];
}

/**
 * Run one reconciliation pass.
 *
 * Single-flight: the database holds at most one `running` row (enforced by a
 * partial unique index), so two overlapping cron ticks cannot repair the same
 * subscription concurrently and write conflicting transitions.
 */
export async function reconcileBillingSubscriptions(
  opts: { limit?: number; trigger?: "cron" | "manual" | "admin" } = {},
): Promise<ReconciliationResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
  const sb = getAdminClient();

  const { data: run, error: runError } = await sb
    .from("billing_reconciliation_runs")
    .insert({ trigger: opts.trigger ?? "cron", status: "running" })
    .select("*")
    .single();

  if (runError) {
    // The partial unique index on `status = 'running'` is what rejects this.
    if (/duplicate key|already exists/i.test(runError.message)) {
      logger.info("billing-reconcile-skipped", { reason: "a pass is already running" });
      return {
        runId: null,
        skipped: true,
        scanned: 0,
        repaired: 0,
        failed: 0,
        discrepancies: [],
      };
    }
    // The table missing means the migration has not been applied. Report it
    // loudly instead of silently reconciling nothing.
    logger.error("billing-reconcile-run-insert-failed", { error: runError.message });
    await recordSystemEvent({
      eventType: "billing_reconcile_unavailable",
      severity: "error",
      status: "failed",
      message:
        "Billing reconciliation could not start: billing_reconciliation_runs is unavailable. Apply supabase/migrations/0012_billing_production_completeness.sql.",
      metadata: { error: runError.message },
    });
    return { runId: null, skipped: true, scanned: 0, repaired: 0, failed: 0, discrepancies: [] };
  }

  const runId = String(run.id);
  const result: ReconciliationResult = {
    runId,
    skipped: false,
    scanned: 0,
    repaired: 0,
    failed: 0,
    discrepancies: [],
  };

  try {
    const { index } = await loadPriceIndex();

    const { data, error } = await sb
      .from("subscriptions")
      .select("*")
      .not("provider_subscription_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`subscriptions.reconcile-list failed: ${error.message}`);

    const rows = (data ?? []).map((r) => subscriptionFromRow(r as Row));
    result.scanned = rows.length;
    // Written up front so a pass killed halfway is visibly partial rather than
    // looking like a clean sweep of a smaller number.
    await sb.from("billing_reconciliation_runs").update({ scanned: rows.length }).eq("id", runId);

    const stripe = getStripe();

    for (const local of rows) {
      const base = {
        subscriptionId: local.id,
        userId: local.user_id,
        stripeSubscriptionId: local.provider_subscription_id,
      };

      // A provider subscription id on a row that is not a Stripe subscription
      // is the NOT VALID constraint's legacy residue. Reconciling it would
      // compare the wrong Stripe object, so report and skip.
      if (local.payment_provider !== "stripe") {
        result.discrepancies.push({
          ...base,
          kind: "provider_pair_violation",
          local: local.payment_provider ?? "null",
          stripe: "stripe",
          repaired: false,
          repairError: "row is not a Stripe subscription but carries a provider subscription id",
        });
        continue;
      }

      let stripeSub: Stripe.Subscription;
      try {
        stripeSub = await stripe.subscriptions.retrieve(local.provider_subscription_id as string);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const missing = /resource_missing|No such (customer|subscription)/i.test(message);
        result.failed += 1;
        result.discrepancies.push({
          ...base,
          kind: missing ? "missing_on_stripe" : "status_mismatch",
          local: local.status,
          stripe: null,
          repaired: false,
          repairError: message.slice(0, 200),
        });
        continue;
      }

      const snapshot = snapshotFromStripe(stripeSub, index);
      const { discrepancies, repairs } = compareSubscription(local, snapshot, local.plan_id);

      if (discrepancies.length === 0) continue;

      const repair = repairs.get(local.id);
      let repairError: string | null = null;
      if (repair) {
        try {
          repairError = await applyRepair(local, snapshot, repair);
        } catch (err) {
          repairError = err instanceof Error ? err.message : String(err);
        }
      }

      const repaired = discrepancies.length > 0 && repairError === null;
      if (repaired) result.repaired += 1;
      else result.failed += discrepancies.filter((d) => d.kind !== "unmapped_price").length;

      for (const d of discrepancies) {
        result.discrepancies.push({ ...d, repaired, repairError });
      }
    }

    const status = result.failed > 0 || result.discrepancies.length > 0 ? "discrepancies" : "ok";
    await sb
      .from("billing_reconciliation_runs")
      .update({
        status,
        reconciled: result.scanned,
        repaired: result.repaired,
        failed: result.failed,
        discrepancies: result.discrepancies as unknown as Record<string, unknown>,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (result.discrepancies.length > 0) {
      await recordSystemEvent({
        eventType: "billing_reconcile_discrepancies",
        severity: result.repaired === 0 && result.failed > 0 ? "error" : "warn",
        status,
        message: `Billing reconciliation found ${result.discrepancies.length} discrepanc(y/ies) across ${result.scanned} subscription(s); ${result.repaired} repaired.`,
        metadata: {
          runId,
          scanned: result.scanned,
          repaired: result.repaired,
          failed: result.failed,
          kinds: Array.from(new Set(result.discrepancies.map((d) => d.kind))),
        },
      });
    }

    logger.info("billing-reconcile-done", {
      runId,
      scanned: result.scanned,
      repaired: result.repaired,
      failed: result.failed,
      discrepancies: result.discrepancies.length,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from("billing_reconciliation_runs")
      .update({
        status: "failed",
        failed: result.failed,
        error_message: message.slice(0, 500),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await recordSystemEvent({
      eventType: "billing_reconcile_failed",
      severity: "error",
      status: "failed",
      message: `Billing reconciliation pass failed: ${message}`,
      metadata: { runId },
    });
    throw err;
  }
}

export interface ReconciliationRunSummary {
  id: string;
  status: string;
  trigger: string;
  scanned: number;
  repaired: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  /** True when the last completed pass found something that was not repaired. */
  needsAttention: boolean;
}

/** Recent passes, for the admin health page. */
export async function recentReconciliationRuns(limit = 10): Promise<ReconciliationRunSummary[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("billing_reconciliation_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`billing_reconciliation_runs.list failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const status = String(r.status);
    const finishedAt = r.finished_at ? String(r.finished_at) : null;
    return {
      id: String(r.id),
      status,
      trigger: String(r.trigger),
      scanned: Number(r.scanned ?? 0),
      repaired: Number(r.repaired ?? 0),
      failed: Number(r.failed ?? 0),
      startedAt: String(r.started_at),
      finishedAt,
      // A pass still marked `running` past the cron interval means it died, which
      // is exactly the situation where the operator needs to know billing state
      // has not been verified recently.
      needsAttention:
        status === "failed" ||
        (status === "discrepancies" && Number(r.failed ?? 0) > 0) ||
        status === "running",
    };
  });
}

/** Interval of a stored window, re-exported for the reconciliation tests. */
export { intervalFromPeriod };
