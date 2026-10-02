import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/config";
import { getPlanById, getPurchasablePlanById } from "./plans";
import { recordSubscriptionEvent } from "./events";
import { recordSystemEvent } from "./system-events";
import { subscriptionFromRow, type Row } from "./records";
import { validateTransition } from "./subscription-machine";
import { cancelCheckoutPayment, findOpenPaymentForSubscription } from "./payments";
import { getStripe } from "./stripe";
import { BillingInputError, PlanChangeRequiresPortalError, SubscriptionConflictError } from "./errors";
import type { PaymentProvider, PlanRecord, SubscriptionRecord, SubscriptionStatus } from "./types";

/**
 * Subscription service. Entitlement lives here (in Supabase), and every status
 * change goes through an explicitly validated transition + lifecycle event.
 * The client can never set a status: these are server-only operations.
 */

/** Statuses that represent a live, paying subscription. */
const LIVE_STATUSES: SubscriptionStatus[] = ["active", "active_until_period_end", "past_due"];

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

/** Create a fresh subscription in `pending`. Never creates duplicate open rows. */
export async function createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const existing = await getCurrentSubscription(input.userId);
  if (existing) {
    if (existing.status === "pending" && existing.plan_id === input.planId) return existing;
    if (existing.status === "pending") {
      throw new BillingInputError("A subscription is already pending. Resolve it before starting another.");
    }
    if (existing.status === "payment_failed") {
      // Retry of an orphaned/failed checkout: reuse the SAME row instead of
      // inserting a second open `pending` row (see prepareSubscriptionForCheckout).
      const plan = await getPurchasablePlanById(input.planId);
      const retried = await retryFailedSubscription(
        existing,
        input.provider,
        input.planId,
        existing.plan ?? plan!,
      );
      return retried.subscription;
    }
  }
  const sb = getAdminClient();
  const plan = await getPurchasablePlanById(input.planId);
  if (!plan) throw new BillingInputError("This plan is not available for purchase.");

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
  /**
   * Stripe requires the customer to update their payment method. Distinct from
   * `past_due`: a past-due invoice is still being retried, this state is not
   * going to resolve without the user doing something.
   */
  paymentActionRequired?: boolean | null;
  /** Non-sensitive explanation shown in the dashboard (why the card needs updating). */
  paymentActionReason?: string | null;
}

/**
 * Core guarded transition. Validates the subscription state machine before
 * touching the row, then records an immutable lifecycle event.
 *
 * The state machine is enforced twice: once here against the row we read, and
 * once in SQL by the `.eq("status", observed)` compare-and-set. Without the
 * second check, two webhooks that read the same status both validate and both
 * write — a renewal landing on a `pending` row could, for example, be written
 * by a cancel in the same window. When the CAS loses the race the row is
 * re-read and re-validated, so a genuinely newer state is honoured rather than
 * silently overwritten.
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
  if (opts.paymentActionRequired !== undefined) {
    patch.payment_action_required = opts.paymentActionRequired;
    patch.payment_action_reason = opts.paymentActionRequired ? (opts.paymentActionReason ?? null) : null;
  }

  const sb = getAdminClient();
  const { data, error: updateError } = await sb
    .from("subscriptions")
    .update(patch)
    .eq("id", id)
    .eq("status", current.status)
    .select("*")
    .maybeSingle();
  if (updateError) throw new Error(`subscriptions.update failed: ${updateError.message}`);
  if (!data) {
    // Lost the race: the status changed between our read and our write, so the
    // machine has to be re-evaluated against the state that actually won.
    const latest = await getSubscriptionById(id);
    if (!latest) throw new BillingInputError("Subscription not found.");
    const retryError = validateTransition(latest.status, opts.to);
    if (retryError) {
      throw new BillingInputError(`Illegal subscription transition: ${retryError.from} → ${retryError.to}`);
    }
    if (latest.status === opts.to) {
      // A concurrent identical transition already applied this target status;
      // the observable end state is the one the caller asked for.
      return latest;
    }
    throw new SubscriptionConflictError(
      `Subscription changed to ${latest.status} while applying ${opts.to}; retry the operation.`,
    );
  }
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

// ---------------------------------------------------------------------------
// Plan changes (upgrade / downgrade)
// ---------------------------------------------------------------------------

/**
 * Move a subscription to a different plan without touching its lifecycle status.
 *
 * The status transition is a no-op (from === to is always legal), so this is a
 * plan swap: the period, the renewal schedule, and the customer's payment all
 * stay exactly as Stripe has them, and only the entitlement Baton grants changes.
 * Stripe is what created the change — via the Billing Portal — so the caller
 * passes the plan Stripe's price actually maps to.
 *
 * Recording the event with the before/after plan is what makes an upgrade
 * auditable later; without it the subscription history shows renewals but never
 * shows the moment the user's plan changed.
 */
export async function changeSubscriptionPlan(
  id: string,
  planId: string,
  opts: { reason: string; eventType?: string },
): Promise<SubscriptionRecord> {
  return transitionSubscription(id, {
    to: "active",
    eventType: opts.eventType ?? "subscription_plan_changed",
    source: "stripe",
    reason: opts.reason,
    planId,
  });
}

// ---------------------------------------------------------------------------
// Payment action required (the user must update their payment method)
// ---------------------------------------------------------------------------

/**
 * Stripe told us the saved payment method cannot be charged.
 *
 * This is deliberately not `past_due`. A past-due invoice is still being retried
 * by Stripe and usually resolves itself; an action-required invoice will not, no
 * matter how long we wait, because the customer has to supply a working card.
 * Conflating the two makes the dashboard tell a user to wait for something that
 * is never going to happen, and makes housekeeping expire a subscription Stripe
 * would still have collected.
 */
export async function markPaymentActionRequired(id: string, reason: string): Promise<SubscriptionRecord> {
  const current = await getSubscriptionById(id);
  if (!current) throw new BillingInputError("Subscription not found.");

  // An incomplete Stripe subscription has no paid period at all, so the row
  // stays `pending` and only carries the flag. A live subscription keeps its
  // status and gains the flag.
  const to = current.status === "pending" ? "pending" : current.status;
  return transitionSubscription(id, {
    to,
    eventType: "subscription_payment_action_required",
    source: "stripe",
    reason,
    paymentActionRequired: true,
    paymentActionReason: reason,
  });
}

/**
 * Clear the action-required flag.
 *
 * Called when an invoice is paid, so the prompt disappears the moment the user's
 * card starts working again instead of lingering until the next renewal.
 */
export async function clearPaymentActionRequired(id: string, reason?: string): Promise<SubscriptionRecord> {
  const current = await getSubscriptionById(id);
  if (!current) throw new BillingInputError("Subscription not found.");
  if (!current.payment_action_required) return current;

  return transitionSubscription(id, {
    to: current.status,
    eventType: "subscription_payment_action_resolved",
    source: "stripe",
    reason: reason ?? "payment method updated",
    paymentActionRequired: false,
  });
}

/** Period ended with cancel_at_period_end set: final cancellation. */
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
// Checkout preparation (plan changes reuse the row, no duplicate subscriptions)
// ---------------------------------------------------------------------------

export interface PreparedSubscription {
  subscription: SubscriptionRecord;
  /** True when the subscription row was reused for a plan change. */
  planChanged: boolean;
  /** True when the user is already active on this plan (no purchase needed). */
  alreadyOnPlan: boolean;
  /**
   * True when the user is renewing a live USDC subscription (manual renewal,
   * since USDC has no automatic recurring billing). The same row is reused and the
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
  const plan = await getPurchasablePlanById(planId);
  if (!plan) throw new BillingInputError("This plan is not available for purchase.");

  if (!existing) {
    const created = await createSubscription({ userId, planId, provider });
    return { subscription: created, planChanged: false, alreadyOnPlan: false, renewal: false };
  }

  if (existing.status === "pending") {
    if (existing.plan_id === planId) {
      return { subscription: existing, planChanged: false, alreadyOnPlan: false, renewal: false };
    }
    throw new BillingInputError(
      "You already have a pending checkout. Continue it or cancel it from Billing before switching plans.",
    );
  }

  if (existing.plan_id === planId) {
    if (provider === "usdc" && ["active", "active_until_period_end", "past_due"].includes(existing.status)) {
      // Manual USDC renewal: USDC has no automatic recurring billing, so a
      // subscriber can voluntarily pay to extend the same plan (nk.md §9).
      return { subscription: existing, planChanged: false, alreadyOnPlan: false, renewal: true };
    }
    if (existing.status === "payment_failed") {
      // Orphaned/failed checkout on the same plan: the user is NOT entitled
      // (payment_failed is an unpaid status), so allow a retry by resetting the
      // row to pending. Legal transition per the state machine (nk.md §5).
      return retryFailedSubscription(existing, provider, planId, plan);
    }
    return { subscription: existing, planChanged: false, alreadyOnPlan: true, renewal: false };
  }

  // A plan change on a live *recurring Stripe* subscription cannot go through
  // checkout. Checkout always creates a brand-new Stripe subscription, so
  // continuing from here would leave the existing one alive and still billing:
  // the user pays for the old plan every month, the local row only knows about
  // the new one, and every renewal of the abandoned subscription lands as an
  // unmatched "subscription_missing" warning while Stripe keeps taking money.
  //
  // Plan changes mutate the existing subscription in Stripe's Billing Portal
  // instead, which is also the only place proration is calculated correctly. The
  // resulting `customer.subscription.updated` webhook moves the entitlement (see
  // `syncPlanFromStripe`). USDC is unaffected: it has no recurring billing and no
  // portal, so re-purchasing a period is the correct mechanism there.
  if (
    provider === "stripe" &&
    existing.payment_provider === "stripe" &&
    existing.provider_subscription_id &&
    LIVE_STATUSES.includes(existing.status)
  ) {
    throw new PlanChangeRequiresPortalError(
      "You already have an active Stripe subscription. Change your plan from the billing portal so your current subscription is updated instead of duplicated.",
    );
  }

  // Plan change on a live subscription: reuse the row.
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

/**
 * Reset a `payment_failed` subscription row back to `pending` so the user can
 * retry checkout on the same plan without duplicating the subscription. The
 * row keeps its id (and invoice/audit history); provider and period fields are
 * cleared for the retried payment exactly like a plan change.
 */
async function retryFailedSubscription(
  existing: SubscriptionRecord,
  provider: PaymentProvider,
  planId: string,
  plan: PlanRecord,
): Promise<PreparedSubscription> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscriptions")
    .update({
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
  if (error) throw new Error(`subscriptions.checkout-retry failed: ${error.message}`);
  const sub = subscriptionFromRow(data as Row);
  sub.plan = plan;

  await recordSubscriptionEvent({
    subscriptionId: sub.id,
    userId: sub.user_id,
    eventType: "subscription_payment_retried",
    previousStatus: existing.status,
    newStatus: "pending",
    source: provider,
    metadata: { planSlug: plan.slug },
  });
  return { subscription: sub, planChanged: true, alreadyOnPlan: false, renewal: false };
}

// ---------------------------------------------------------------------------
// Checkout cancellation
// ---------------------------------------------------------------------------

export interface CancelCheckoutResult {
  subscription: SubscriptionRecord;
  /** The payment that was cancelled (null when the checkout had none). */
  payment: Awaited<ReturnType<typeof findOpenPaymentForSubscription>>;
}

/**
 * Cancel a user's pending checkout. Server-authoritative; the client only
 * passes the subscription id.
 *
 * Ordering prevents the paid-vs-cancelled race:
 * 1. Atomically cancel the OPEN payment (`cancelCheckoutPayment` only matches
 *    pending/pending_verification). If the Stripe webhook (or USDC auto-verify)
 *    already won, the payment reads back `confirmed` and cancellation ABORTS —
 *    a successful payment is never destroyed by a cancel (Case C).
 * 2. Only when the payment cancel won do we terminate the subscription row
 *    (`pending|payment_failed → canceled`). A concurrent webhook can no longer
 *    activate it, because its `confirmPayment` now matches zero rows and the
 *    activation is skipped.
 */
export async function cancelPendingCheckout(
  userId: string,
  subscriptionId: string,
): Promise<CancelCheckoutResult> {
  const sub = await getSubscriptionById(subscriptionId);
  if (!sub || sub.user_id !== userId) {
    throw new BillingInputError("Checkout not found.");
  }
  if (sub.status !== "pending" && sub.status !== "payment_failed") {
    throw new BillingInputError("This checkout can no longer be cancelled.");
  }

  const payment = await findOpenPaymentForSubscription(sub.id);
  if (payment) {
    // Best-effort: ask Stripe to expire the Checkout Session server-side so the
    // customer can't still hand over a card that will never activate their plan.
    if (payment.payment_provider === "stripe" && payment.stripe_checkout_session_id) {
      try {
        await getStripe().checkout.sessions.expire(payment.stripe_checkout_session_id);
      } catch {
        // The session may already be expired/completed — either way our local
        // cancellation is what matters. Do not surface Stripe noise to the user.
      }
    }
    const result = await cancelCheckoutPayment(payment.id);
    if (result?.status === "confirmed") {
      throw new BillingInputError("Your payment already succeeded and could not be cancelled.");
    }
    if (result?.status === "rejected" || result?.status === "refunded") {
      throw new BillingInputError("This payment is already closed and can no longer be cancelled.");
    }
  }

  const cancelled = await transitionSubscription(sub.id, {
    to: "canceled",
    eventType: "subscription_checkout_cancelled",
    source: "user",
    reason: "user cancelled their pending checkout",
    paymentId: payment?.id ?? null,
    endedAt: new Date().toISOString(),
  });

  await recordSystemEvent({
    eventType: "checkout_cancelled",
    severity: "info",
    status: "cancelled",
    message: `Checkout for ${sub.plan?.slug ?? sub.plan_id} cancelled by user.`,
    userId,
    metadata: { subscriptionId: sub.id, planId: sub.plan_id, paymentId: payment?.id ?? null },
  });

  return { subscription: cancelled, payment };
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
  /** Admin-gifted `active` plans that reached their access end and were closed. */
  expiredGifts: number;
  /** Stripe `incomplete` subscriptions past Stripe's own retry deadline. */
  expiredIncomplete: number;
}

/**
 * Billing housekeeping (run from cron):
 *  - `past_due` past its period end  -> `expired` (grace period over).
 *  - `active_until_period_end` past its period end -> `canceled` (done).
 *  - `pending` older than the stale horizon -> `payment_failed` (orphaned
 *    checkout; a user can still re-trigger a fresh one from payment_failed).
 *  - admin-gifted `active` plans past their access end -> `expired` so the
 *    product shows the true, reverted entitlement state (never auto-renews).
 */
export async function runBillingHousekeeping(now = new Date()): Promise<HousekeepingResult> {
  const result: HousekeepingResult = {
    expiredPastDue: 0,
    completedCancellations: 0,
    failedOrphans: 0,
    expiredGifts: 0,
    expiredIncomplete: 0,
  };
  if (!isSupabaseConfigured()) return result;

  const sb = getAdminClient();
  const stalePendingBefore = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
  const incompletePendingBefore = new Date(now.getTime() - PENDING_INCOMPLETE_STALE_MS).toISOString();

  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .or(
      "status.in.(past_due,active_until_period_end,pending),and(status.eq.active,payment_provider.eq.gift)",
    )
    .limit(500);
  if (error) throw new Error(`subscriptions.housekeeping.list failed: ${error.message}`);

  const subs = (data ?? []).map((r) => subscriptionFromRow(r as Row));

  for (const sub of subs) {
    try {
      if (sub.status === "active" && sub.payment_provider === "gift" && sub.current_period_end) {
        if (new Date(sub.current_period_end) <= now) {
          await transitionSubscription(sub.id, {
            to: "expired",
            eventType: "subscription_expired",
            source: "system",
            reason: "admin-gifted plan period ended",
            endedAt: new Date().toISOString(),
          });
          result.expiredGifts += 1;
        }
      } else if (sub.status === "past_due" && sub.current_period_end && new Date(sub.current_period_end) <= now) {
        await expireSubscription(sub.id);
        result.expiredPastDue += 1;
      } else if (
        sub.status === "active_until_period_end" &&
        sub.current_period_end &&
        new Date(sub.current_period_end) <= now
      ) {
        await completeCancellation(sub.id);
        result.completedCancellations += 1;
      } else if (sub.status === "pending" && new Date(sub.updated_at ?? sub.created_at) <= new Date(stalePendingBefore)) {
        await transitionSubscription(sub.id, {
          to: "payment_failed",
          eventType: "subscription_orphaned",
          source: "system",
          reason: "checkout was never completed by the user",
        });
        result.failedOrphans += 1;
      } else if (
        sub.status === "pending" &&
        sub.payment_action_required &&
        new Date(sub.updated_at ?? sub.created_at) <= new Date(incompletePendingBefore)
      ) {
        // Stripe's own retry window for an incomplete initial payment has closed.
        // Failing it here is what makes a new checkout possible; leaving it
        // pending forever blocks the user from trying again.
        await transitionSubscription(sub.id, {
          to: "payment_failed",
          eventType: "subscription_incomplete_expired",
          source: "system",
          reason: "Stripe could not collect the initial payment and its retry window expired",
          paymentActionRequired: false,
        });
        result.expiredIncomplete += 1;
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

/**
 * Stripe gives a subscription in `incomplete` exactly 23 hours of automatic
 * retries on the initial payment before it expires. Failing the local row before
 * that window closes would cancel an order Stripe is still legitimately retrying
 * (a bank debit that settles on the second attempt, a 3DS challenge the user
 * completes an hour later), so the orphan sweep has to wait it out. 26 hours is
 * the first housekeeping tick that is safely past Stripe's own deadline.
 */
const PENDING_INCOMPLETE_STALE_MS = 1000 * 60 * 60 * 26;