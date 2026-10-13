import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import { getPaymentById, patchPayment } from "./payments";
import { getSubscriptionById, expireSubscription, completeCancellation, markSubscriptionPaymentFailed } from "./subscriptions";
import { validateTransition } from "./subscription-machine";
import { recordSystemEvent } from "./system-events";
import { recordSubscriptionEvent } from "./events";
import type { PaymentRecord, SubscriptionStatus } from "./types";

/**
 * Refund handling.
 *
 * Stripe refunds are outside-initiated: an admin issues one from the Stripe
 * dashboard (or a dispute resolves against us) and the only notice we get is the
 * webhook. Two things have to be decided when it arrives: what the payment now
 * is, and whether the user's access survives.
 *
 * The payment side is mechanical (sum the refunds). The access side is a policy
 * decision, so it is a pure function with its reasoning attached rather than
 * something buried in a handler, it is the kind of rule that gets edited by
 * someone who has not thought about the $1 goodwill refund.
 */

export type RefundStatus = "pending" | "succeeded" | "failed" | "cancelled";

export interface RefundInput {
  stripeRefundId: string;
  stripeChargeId: string | null;
  amount: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  /** Total amount Stripe has refunded against the charge so far. */
  cumulativeRefundedAmount: number;
}

export interface RefundLedgerRow {
  id: string;
  stripe_refund_id: string;
  amount: number;
  status: RefundStatus;
  access_revoked: boolean;
}

/**
 * Insert the refund if it is new, or correct its state if Stripe has moved it.
 *
 * The ledger's financial facts are protected by a database trigger, so this only
 * ever writes a new row or touches the two mutable columns. Returns null when
 * nothing changed, which is the common case for a redelivered webhook.
 */
export async function recordRefund(
  payment: PaymentRecord,
  input: RefundInput,
): Promise<{ row: RefundLedgerRow | null; changed: boolean }> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payment_refunds")
    .insert({
      payment_id: payment.id,
      subscription_id: payment.subscription_id,
      user_id: payment.user_id,
      stripe_refund_id: input.stripeRefundId,
      stripe_charge_id: input.stripeChargeId,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      status: input.status,
      reason: input.reason,
    })
    .select("*")
    .single();

  if (!error && data) return { row: toRow(data as Record<string, unknown>), changed: true };

  // A unique violation means this refund is already on file. Re-point the write
  // at the mutable state columns, which is the only correction Stripe can make
  // after the fact (pending -> succeeded, or a cancelled refund).
  if (!/duplicate key|already exists/i.test(error?.message ?? "")) {
    throw new Error(`payment_refunds.insert failed: ${error?.message ?? "unknown"}`);
  }

  const { data: existing, error: findError } = await sb
    .from("payment_refunds")
    .select("*")
    .eq("stripe_refund_id", input.stripeRefundId)
    .maybeSingle();
  if (findError) throw new Error(`payment_refunds.find failed: ${findError.message}`);
  if (!existing) return { row: null, changed: false };

  const row = toRow(existing as Record<string, unknown>);
  if (row.status === input.status) return { row, changed: false };

  const { error: patchError } = await sb
    .from("payment_refunds")
    .update({ status: input.status })
    .eq("id", row.id);
  if (patchError) throw new Error(`payment_refunds.update failed: ${patchError.message}`);

  await recordSystemEvent({
    eventType: "stripe_refund_state_changed",
    severity: "info",
    status: input.status,
    message: `Refund ${input.stripeRefundId} moved to ${input.status}.`,
    userId: payment.user_id,
    metadata: { refundId: input.stripeRefundId, paymentId: payment.id, from: row.status, to: input.status },
  });
  return { row: { ...row, status: input.status }, changed: true };
}

function toRow(raw: Record<string, unknown>): RefundLedgerRow {
  return {
    id: String(raw.id),
    stripe_refund_id: String(raw.stripe_refund_id),
    amount: Number(raw.amount),
    status: String(raw.status) as RefundStatus,
    access_revoked: Boolean(raw.access_revoked),
  };
}

/** Every refund recorded against a payment, oldest first. */
export async function refundsForPayment(paymentId: string): Promise<RefundLedgerRow[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payment_refunds")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`payment_refunds.list failed: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/**
 * What a payment row should become given everything refunded against it.
 *
 * A payment is only `refunded` when the refunds add up to at least what was
 * charged. Marking a partially refunded payment as `refunded` would make the
 * ledger claim money came back that did not.
 */
export function derivePaymentStatus(
  currentStatus: PaymentRecord["status"],
  chargedAmount: number,
  totalSucceededRefunded: number,
): PaymentRecord["status"] {
  if (totalSucceededRefunded > 0 && chargedAmount > 0 && totalSucceededRefunded >= chargedAmount) {
    return "refunded";
  }
  // A partial refund leaves the payment confirmed: the user did pay, and a
  // goodwill adjustment is not a failed charge.
  return currentStatus === "refunded" ? "confirmed" : currentStatus;
}

// 
// Access policy
// 

/**
 * Statuses that already grant no access.
 *
 * A refund arriving after access ended still belongs on the ledger, but it must
 * not transition the row: doing so records a lifecycle event that claims access
 * was taken away by the refund when it had already gone, and can relabel the
 * reason the subscription ended (a failed payment becoming a "cancellation").
 */
const ACCESS_ALREADY_ENDED: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  "none",
  "payment_failed",
  "canceled",
  "expired",
]);

export type RefundAccessAction =
  | { kind: "none"; reason: string }
  | { kind: "revoke"; to: SubscriptionStatus; reason: string };

/**
 * Whether a refund takes the user's paid access away.
 *
 * The rules, and why:
 *
 *  - A refund that is not `succeeded` revokes nothing. A pending refund may
 *    still fail or be cancelled, and a failed dispute is the *customer's* money
 *    being clawed back, revoking on that would be wrong.
 *  - A partial refund never revokes on its own. Most partial refunds are
 *    overcharge corrections and goodwill on a $0.00 overage; cutting a paying
 *    customer's access over a small adjustment is a support incident, not a
 *    policy. The refund is still on the ledger and visible to an admin.
 *  - A full refund does revoke, because the product was paid for and then
 *    un-paid for. That covers both the initial purchase and a renewal.
 *  - A terminal subscription is already gone, so there is nothing to do.
 */
export function refundAccessDecision(input: {
  refundStatus: RefundStatus;
  refundAmount: number;
  totalSucceededRefunded: number;
  chargedAmount: number;
  subscriptionStatus: SubscriptionStatus;
}): RefundAccessAction {
  const { refundStatus, refundAmount, totalSucceededRefunded, chargedAmount, subscriptionStatus } = input;

  if (refundStatus !== "succeeded") {
    return { kind: "none", reason: `refund is ${refundStatus}` };
  }
  // Nothing to take away if access has already ended, whatever the refund does
  // to the ledger.
  if (ACCESS_ALREADY_ENDED.has(subscriptionStatus)) {
    return { kind: "none", reason: `subscription is ${subscriptionStatus}; access already ended` };
  }
  if (chargedAmount <= 0) {
    return { kind: "none", reason: "no charged amount to compare against" };
  }

  const totalRefunded = Math.max(totalSucceededRefunded, refundAmount);
  const partial = totalRefunded < chargedAmount;
  if (partial) {
    return {
      kind: "none",
      reason: `partial refund ${totalRefunded} of ${chargedAmount}; access retained and recorded`,
    };
  }

  // Full refund. Pick the terminal state the subscription can legally reach
  // from where it is now, so this can never throw on an unexpected status.
  //
  // Order matters and encodes which description is accurate. An order that never
  // completed and whose money came back is `payment_failed` (the user can retry);
  // a live subscription that was un-paid for is `expired`; one that was already
  // winding down only gets as far as `canceled`.
  const candidates: { to: SubscriptionStatus; reason: string }[] = [
    { to: "payment_failed", reason: "payment was fully refunded" },
    { to: "expired", reason: "payment was fully refunded" },
    { to: "canceled", reason: "payment was fully refunded" },
  ];
  for (const candidate of candidates) {
    // `validateTransition` treats from === to as legal so callers can express a
    // no-op, and it happily allows `payment_failed to canceled`. Neither is a
    // revocation: both write a lifecycle event claiming access was taken away
    // when it already had been, and the second would label a refund as a
    // user cancellation in the audit trail.
    if (candidate.to === subscriptionStatus) continue;
    if (validateTransition(subscriptionStatus, candidate.to) === null) {
      return { kind: "revoke", ...candidate };
    }
  }
  return { kind: "none", reason: `subscription is ${subscriptionStatus}; access already ended` };
}

export interface RefundOutcome {
  refundId: string;
  paymentStatus: PaymentRecord["status"];
  accessAction: RefundAccessAction["kind"];
  newSubscriptionStatus: SubscriptionStatus | null;
}

/**
 * Apply a refund end to end: ledger row, payment status, and access.
 *
 * Every step is written so a redelivery of the same webhook is a no-op. The
 * access transition is validated against the state machine before it is written,
 * and the refund row is stamped `access_revoked` so a crash between the
 * transition and the stamp cannot cause a second, different transition.
 */
export async function applyRefund(input: {
  paymentId: string;
  refund: RefundInput;
}): Promise<RefundOutcome | null> {
  const payment = await getPaymentById(input.paymentId);
  if (!payment) {
    await recordSystemEvent({
      eventType: "stripe_refund_unknown_payment",
      severity: "warn",
      status: "missing",
      message: `Refund ${input.refund.stripeRefundId} references payment ${input.paymentId}, which does not exist.`,
      metadata: { refundId: input.refund.stripeRefundId, paymentId: input.paymentId },
    });
    return null;
  }

  const { row: ledgerRow, changed } = await recordRefund(payment, input.refund);
  if (!changed && ledgerRow?.access_revoked) {
    // Already fully applied on an earlier delivery. Returning here keeps a
    // redelivered `charge.refunded` from writing a duplicate refund event on
    // every Stripe retry.
    logger.debug("stripe-refund-unchanged", {
      refundId: input.refund.stripeRefundId,
      paymentId: payment.id,
    });
    return {
      refundId: input.refund.stripeRefundId,
      paymentStatus: payment.status,
      accessAction: "revoke",
      newSubscriptionStatus: null,
    };
  }
  if (!changed) {
    logger.debug("stripe-refund-redelivered", {
      refundId: input.refund.stripeRefundId,
      paymentId: payment.id,
    });
  }

  const refunds = await refundsForPayment(payment.id);
  const succeededTotal = refunds
    .filter((r) => r.status === "succeeded")
    .reduce((sum, r) => sum + r.amount, 0);

  const paymentStatus = derivePaymentStatus(payment.status, payment.amount, succeededTotal);
  if (paymentStatus !== payment.status) {
    await patchPayment(payment.id, {
      status: paymentStatus,
      failure_reason:
        paymentStatus === "refunded"
          ? `Stripe refunded ${succeededTotal} of ${payment.amount} ${payment.currency}.`
          : null,
    });
  }

  let accessAction: RefundAccessAction["kind"] = "none";
  let newSubscriptionStatus: SubscriptionStatus | null = null;

  if (payment.subscription_id) {
    const subscription = await getSubscriptionById(payment.subscription_id);
    if (subscription) {
      const decision = refundAccessDecision({
        refundStatus: input.refund.status,
        refundAmount: input.refund.amount,
        totalSucceededRefunded: succeededTotal,
        chargedAmount: payment.amount,
        subscriptionStatus: subscription.status,
      });
      accessAction = decision.kind;

      // A ledger row already stamped as revoking means this refund's access
      // decision was applied on an earlier delivery.
      const alreadyRevoked = ledgerRow?.access_revoked ?? false;
      if (decision.kind === "revoke" && !alreadyRevoked) {
        const applied = await revokeForRefund(subscription.id, subscription.status, decision.to, input.refund);
        if (applied) {
          newSubscriptionStatus = decision.to;
          accessAction = "revoke";
          if (ledgerRow) await markAccessRevoked(ledgerRow.id);
        }
      }
    }
  }

  await recordSubscriptionEvent({
    subscriptionId: payment.subscription_id,
    userId: payment.user_id,
    eventType: "payment_refunded",
    previousStatus: null,
    newStatus: null,
    previousPlanId: null,
    newPlanId: null,
    paymentId: payment.id,
    source: "stripe",
    reason: `Stripe refund ${input.refund.stripeRefundId} of ${input.refund.amount} ${input.refund.currency}`,
    metadata: {
      refundId: input.refund.stripeRefundId,
      refundStatus: input.refund.status,
      succeededRefundTotal: succeededTotal,
      paymentStatus,
      accessAction,
    },
  });

  return {
    refundId: input.refund.stripeRefundId,
    paymentStatus,
    accessAction,
    newSubscriptionStatus,
  };
}

async function revokeForRefund(
  subscriptionId: string,
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  refund: RefundInput,
): Promise<boolean> {
  try {
    if (to === "expired") {
      await expireSubscription(subscriptionId);
    } else if (to === "canceled") {
      await completeCancellation(subscriptionId);
    } else if (to === "payment_failed") {
      await markSubscriptionPaymentFailed(subscriptionId, {
        source: "stripe",
        reason: `Stripe refund ${refund.stripeRefundId}: ${refund.reason ?? "payment refunded"}`,
      });
    } else {
      return false;
    }
    return true;
  } catch (err) {
    // A transition that the state machine refuses must not bubble up and make
    // Stripe retry the webhook forever, but it must not be silent either.
    logger.error("stripe-refund-access-revoke-failed", {
      subscriptionId,
      from,
      to,
      refundId: refund.stripeRefundId,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordSystemEvent({
      eventType: "stripe_refund_revoke_failed",
      severity: "error",
      status: "failed",
      message: `Could not revoke access for subscription ${subscriptionId} after refund ${refund.stripeRefundId}: ${from} to ${to} is not a legal transition.`,
      metadata: { subscriptionId, from, to, refundId: refund.stripeRefundId },
    });
    return false;
  }
}

async function markAccessRevoked(refundLedgerId: string): Promise<void> {
  const sb = getAdminClient();
  const { error } = await sb
    .from("payment_refunds")
    .update({ access_revoked: true })
    .eq("id", refundLedgerId);
  if (error) {
    // Not fatal: the transition already happened. The worst case is that a
    // redelivered webhook attempts the transition again, finds it illegal, and
    // records a system event.
    logger.error("stripe-refund-access-stamp-failed", {
      refundLedgerId,
      error: error.message,
    });
  }
}
