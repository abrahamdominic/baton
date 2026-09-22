import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/config";
import { getPlanById } from "./plans";
import { recordSubscriptionEvent } from "./events";
import { recordSystemEvent } from "./system-events";
import { subscriptionFromRow, type Row } from "./records";
import { validateTransition } from "./subscription-machine";
import { BillingInputError } from "./errors";
import type { PaymentProvider, SubscriptionRecord, SubscriptionStatus } from "./types";

/**
 * Subscription service. Entitlement lives here (in Supabase), and every status
 * change goes through an explicitly validated transition + lifecycle event.
 * The client can never set a status — these are server-only operations.
 */

const OPEN_STATUSES: SubscriptionStatus[] = [
  "pending",
  "active",
  "active_until_period_end",
  "past_due",
  "payment_failed",
];

export async function getSubscriptionById(id: string): Promise<SubscriptionRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb.from("subscriptions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`subscriptions.get failed: ${error.message}`);
  if (!data) return null;
  const sub = subscriptionFromRow(data as Row);
  sub.plan = await getPlanById(sub.plan_id);
  return sub;
}

export async function getSubscriptionByProviderSubId(providerSubscriptionId: string): Promise<SubscriptionRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();
  if (error) throw new Error(`subscriptions.get-by-provider failed: ${error.message}`);
  if (!data) return null;
  const sub = subscriptionFromRow(data as Row);
  sub.plan = await getPlanById(sub.plan_id);
  return sub;
}

/**
 * The user's current subscription: the newest still-open lifecycle record,
 * or null when the user has never purchased anything (status = none / free).
 */
export async function getCurrentSubscription(userId: string): Promise<SubscriptionRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`subscriptions.list failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  const sub = subscriptionFromRow(data[0] as Row);
  sub.plan = await getPlanById(sub.plan_id);
  return sub;
}

export async function listSubscriptionsForUser(userId: string) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`subscriptions.list failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const sub = subscriptionFromRow(r as Row);
      sub.plan = await getPlanById(sub.plan_id);
      return sub;
    }),
  );
}

export interface CreateSubscriptionInput {
  userId: string;
  planId: string;
  provider: PaymentProvider;
}

/** Create a fresh subscription in `pending`. Never creates duplicate pending rows. */
export async function createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const existing = await getCurrentSubscription(input.userId);
  if (existing) {
    if (existing.status === "pending" && existing.plan_id === input.planId) return existing;
    if (existing.status === "pending") {
      throw new BillingInputError("A subscription is already pending. Resolve it before starting another.");
    }
  }
  const sb = getAdminClient();
  const plan = await getPlanById(input.planId);
  if (!plan || !plan.is_active) throw new BillingInputError("This plan is not available for purchase.");

  const { data, error } = await sb
    .from("subscriptions")
    .insert({
      user_id: input.userId,
      plan_id: input.planId,
      status: "pending",
      payment_provider: input.provider,
    })
    .select("*")
    .single();
  if (error) throw new Error(`subscriptions.create failed: ${error.message}`);
  const sub = subscriptionFromRow(data as Row);
  await recordSubscriptionEvent({
    subscriptionId: sub.id,
    userId: sub.user_id,
    eventType: "subscription_created",
    previousStatus: null,
    newStatus: "pending",
    newPlanId: input.planId,
    source: input.provider,
    metadata: { planSlug: plan.slug },
  });
  return sub;
}

export interface TransitionOptions {
  to: SubscriptionStatus;
  eventType: string;
  source: "stripe" | "usdc" | "admin" | "system" | "user";
  reason?: string | null;
  paymentId?: string | null;
  planId?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  canceledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

/**
 * Core guarded transition. Validates the subscription state machine before
 * touching the row, then records an immutable lifecycle event.
 */
export async function transitionSubscription(id: string, opts: TransitionOptions): Promise<SubscriptionRecord> {
  const current = await getSubscriptionById(id);
  if (!current) throw new BillingInputError("Subscription not found.");
  const error = validateTransition(current.status, opts.to);
  if (error) {
    throw new BillingInputError(`Illegal subscription transition: ${error.from} → ${error.to}`);
  }

  const patch: Row = { updated_at: new Date().toISOString() };
  if (opts.to !== current.status) patch.status = opts.to;
  if (opts.planId !== undefined && opts.planId !== null) patch.plan_id = opts.planId;
  if (opts.providerCustomerId !== undefined) patch.provider_customer_id = opts.providerCustomerId;
  if (opts.providerSubscriptionId !== undefined) patch.provider_subscription_id = opts.providerSubscriptionId;
  if (opts.currentPeriodStart !== undefined) patch.current_period_start = opts.currentPeriodStart;
  if (opts.currentPeriodEnd !== undefined) patch.current_period_end = opts.currentPeriodEnd;
  if (opts.cancelAtPeriodEnd !== undefined) patch.cancel_at_period_end = opts.cancelAtPeriodEnd;
  if (opts.canceledAt !== undefined) patch.canceled_at = opts.canceledAt;
  if (opts.startedAt !== undefined) patch.started_at = opts.startedAt;
  if (opts.endedAt !== undefined) patch.ended_at = opts.endedAt;

  const sb = getAdminClient();
  const { data, error: updateError } = await sb
    .from("subscriptions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) throw new Error(`subscriptions.update failed: ${updateError.message}`);
  const sub = subscriptionFromRow(data as Row);

  await recordSubscriptionEvent({
    subscriptionId: sub.id,
    userId: sub.user_id,
    eventType: opts.eventType,
    previousStatus: current.status,
    newStatus: opts.to,
    previousPlanId: current.plan_id,
    newPlanId: opts.planId ?? current.plan_id,
    paymentId: opts.paymentId ?? null,
    source: opts.source,
    reason: opts.reason ?? null,
    metadata: { planSlug: current.plan?.slug ?? null },
  });
  return sub;
}

// ---------------------------------------------------------------------------
// Domain operations (small, named wrappers over guarded transitions)
// ---------------------------------------------------------------------------

export async function activateSubscription(
  id: string,
  opts: {
    source: "stripe" | "usdc";
    paymentId?: string;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    planId?: string | null;
  },
): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "active",
    eventType: "subscription_activated",
    source: opts.source,
    paymentId: opts.paymentId,
    providerCustomerId: opts.providerCustomerId ?? null,
    providerSubscriptionId: opts.providerSubscriptionId ?? null,
    currentPeriodStart: opts.currentPeriodStart ?? null,
    currentPeriodEnd: opts.currentPeriodEnd ?? null,
    planId: opts.planId,
    startedAt: new Date().toISOString(),
    cancelAtPeriodEnd: false,
  });
}

export async function markSubscriptionPaymentFailed(
  id: string,
  opts: { source: "stripe" | "usdc"; reason?: string; paymentId?: string },
): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "payment_failed",
    eventType: "subscription_payment_failed",
    source: opts.source,
    reason: opts.reason ?? "payment failed",
    paymentId: opts.paymentId,
  });
}

export async function renewSubscription(
  id: string,
  opts: {
    source: "stripe" | "usdc";
    paymentId?: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  },
): Promise<SubscriptionRecord> {
  const current = await getSubscriptionById(id);
  const wasBad = current?.status === "past_due";
  const eventType = wasBad ? "subscription_reactivated" : "subscription_renewed";
  return transitionSubscription(id, {
    to: "active",
    eventType,
    source: opts.source,
    paymentId: opts.paymentId,
    currentPeriodStart: opts.currentPeriodStart,
    currentPeriodEnd: opts.currentPeriodEnd,
    cancelAtPeriodEnd: false,
  });
}

export async function markPastDue(id: string, reason?: string): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "past_due",
    eventType: "subscription_past_due",
    source: "stripe",
    reason: reason ?? "renewal payment failed",
  });
}

export async function expireSubscription(id: string): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "expired",
    eventType: "subscription_expired",
    source: "system",
    reason: "grace period ended without successful payment",
    endedAt: new Date().toISOString(),
  });
}

/** Cancel at period end: keep access until current_period_end. */
export async function cancelSubscription(
  id: string,
  opts: { reason?: string; currentPeriodEnd?: string | null } = {},
): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "active_until_period_end",
    eventType: "subscription_cancellation_requested",
    source: "user",
    reason: opts.reason ?? "user requested cancellation",
    currentPeriodEnd: opts.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: true,
    canceledAt: new Date().toISOString(),
  });
}

/** Reactivate before the period ends (undoes cancellation). */
export async function reactivateSubscription(id: string): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "active",
    eventType: "subscription_reactivated",
    source: "user",
    cancelAtPeriodEnd: false,
  });
}

/** Period ended with cancel_at_period_end set — final cancellation. */
export async function completeCancellation(id: string): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "canceled",
    eventType: "subscription_canceled",
    source: "system",
    reason: "period ended",
    endedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Checkout preparation (plan changes reuse the row — no duplicate subscriptions)
// ---------------------------------------------------------------------------

export interface PreparedSubscription {
  subscription: SubscriptionRecord;
  /** True when the subscription row was reused for a plan change. */
  planChanged: boolean;
  /** True when the user is already active on this plan (no purchase needed). */
  alreadyOnPlan: boolean;
  /**
   * True when the user is renewing a live USDC subscription (manual renewal —
   * USDC has no automatic recurring billing). The same row is reused and the
   * period is extended after on-chain verification (nk.md §9).
   */
  renewal: boolean;
}

/**
 * Prepare a subscription for checkout. Rules:
 *  - No open subscription           -> create a fresh `pending` row.
 *  - Pending on the same plan       -> reuse it (retries, mid-checkout refresh).
 *  - Pending on a different plan    -> error; the user must resolve it first.
 *  - Open (active/past_due/...) on a different plan -> plan change: reuse the
 *    SAME row, switch the plan, and clear provider/period fields. The payment
 *    then activates it. This never creates a duplicate subscription.
 *  - Open on the same plan          -> already entitled; no new purchase.
 *  - Open on the same plan via USDC -> manual renewal: reuse the SAME live row
 *    so a fresh payment extends it (USDC has no automatic recurring billing).
 */
export async function prepareSubscriptionForCheckout(
  userId: string,
  planId: string,
  provider: PaymentProvider,
): Promise<PreparedSubscription> {
  const existing = await getCurrentSubscription(userId);
  const plan = await getPlanById(planId);
  if (!plan || !plan.is_active) throw new BillingInputError("This plan is not available for purchase.");

  if (!existing) {
    const created = await createSubscription({ userId, planId, provider });
    return { subscription: created, planChanged: false, alreadyOnPlan: false, renewal: false };
  }

  if (existing.status === "pending") {
    if (existing.plan_id === planId) {
      return { subscription: existing, planChanged: false, alreadyOnPlan: false, renewal: false };
    }
    throw new BillingInputError("You already have a pending checkout. Finish it before switching plans.");
  }

  if (existing.plan_id === planId) {
    if (provider === "usdc" && ["active", "active_until_period_end", "past_due"].includes(existing.status)) {
      // Manual USDC renewal: USDC has no automatic recurring billing, so a
      // subscriber can voluntarily pay to extend the same plan (nk.md §9).
      return { subscription: existing, planChanged: false, alreadyOnPlan: false, renewal: true };
    }
    return { subscription: existing, planChanged: false, alreadyOnPlan: true, renewal: false };
  }

  // Plan change on a live subscription — reuse the row.
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .update({
      plan_id: planId,
      status: "pending",
      payment_provider: provider,
      provider_customer_id: null,
      provider_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      started_at: null,
      ended_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`subscriptions.plan-change failed: ${error.message}`);
  const sub = subscriptionFromRow(data as Row);
  sub.plan = plan;

  await recordSubscriptionEvent({
    subscriptionId: sub.id,
    userId: sub.user_id,
    eventType: "subscription_plan_changed",
    previousStatus: existing.status,
    newStatus: "pending",
    previousPlanId: existing.plan_id,
    newPlanId: planId,
    source: provider,
    metadata: { previousPlanSlug: existing.plan?.slug ?? null, newPlanSlug: plan.slug },
  });
  return { subscription: sub, planChanged: true, alreadyOnPlan: false, renewal: false };
}

// ---------------------------------------------------------------------------
// Admin / housekeeping operations
// ---------------------------------------------------------------------------

export async function listAllSubscriptions(limit = 100): Promise<SubscriptionRecord[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`subscriptions.list-all failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const sub = subscriptionFromRow(r as Row);
      sub.plan = await getPlanById(sub.plan_id);
      return sub;
    }),
  );
}

export async function listSubscriptionsByUser(userId: string): Promise<SubscriptionRecord[]> {
  return listSubscriptionsForUser(userId);
}

export interface AdminOverrideInput {
  to: SubscriptionStatus;
  reason: string;
}

/**
 * Admin state correction. Requires a reason (audited), records an
 * `subscription_admin_override` event, and only permits legal transitions.
 */
export async function adminOverrideSubscription(
  id: string,
  input: AdminOverrideInput,
): Promise<SubscriptionRecord> {
  const current = await getSubscriptionById(id);
  if (!current) throw new BillingInputError("Subscription not found.");
  const error = validateTransition(current.status, input.to);
  if (error) {
    throw new BillingInputError(`Illegal subscription transition: ${error.from} → ${error.to}`);
  }
  if (!input.reason?.trim()) throw new BillingInputError("An admin reason is required.");

  return transitionSubscription(id, {
    to: input.to,
    eventType: "subscription_admin_override",
    source: "admin",
    reason: input.reason.trim(),
  });
}

export interface HousekeepingResult {
  expiredPastDue: number;
  completedCancellations: number;
  failedOrphans: number;
}

/**
 * Billing housekeeping (run from cron):
 *  - `past_due` past its period end  -> `expired` (grace period over).
 *  - `active_until_period_end` past its period end -> `canceled` (done).
 *  - `pending` older than the stale horizon -> `payment_failed` (orphaned
 *    checkout; a user can still re-trigger a fresh one from payment_failed).
 */
export async function runBillingHousekeeping(now = new Date()): Promise<HousekeepingResult> {
  const result: HousekeepingResult = { expiredPastDue: 0, completedCancellations: 0, failedOrphans: 0 };
  if (!isSupabaseConfigured()) return result;

  const sb = getAdminClient();
  const stalePendingBefore = new Date(now.getTime() - PENDING_STALE_MS).toISOString();

  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .in("status", ["past_due", "active_until_period_end", "pending"])
    .limit(500);
  if (error) throw new Error(`subscriptions.housekeeping.list failed: ${error.message}`);

  const subs = (data ?? []).map((r) => subscriptionFromRow(r as Row));

  for (const sub of subs) {
    try {
      if (sub.status === "past_due" && sub.current_period_end && new Date(sub.current_period_end) <= now) {
        await expireSubscription(sub.id);
        result.expiredPastDue += 1;
      } else if (
        sub.status === "active_until_period_end" &&
        sub.current_period_end &&
        new Date(sub.current_period_end) <= now
      ) {
        await completeCancellation(sub.id);
        result.completedCancellations += 1;
      } else if (sub.status === "pending" && new Date(sub.created_at) <= new Date(stalePendingBefore)) {
        await transitionSubscription(sub.id, {
          to: "payment_failed",
          eventType: "subscription_orphaned",
          source: "system",
          reason: "checkout was never completed by the user",
        });
        result.failedOrphans += 1;
      }
    } catch (err) {
      await recordSystemEvent({
        eventType: "housekeeping_failed",
        severity: "warn",
        status: "skipped",
        message: `Housekeeping failed for subscription ${sub.id}: ${String(err)}`,
        metadata: { subscriptionId: sub.id },
      });
    }
  }
  return result;
}

const PENDING_STALE_MS = 1000 * 60 * 60 * 72; // 72 hours