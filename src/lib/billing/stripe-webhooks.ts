import "server-only";
import type Stripe from "stripe";
import { getAdminClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import {
  getSubscriptionByProviderSubId,
  getSubscriptionById,
  activateSubscription,
  renewSubscription,
  markPastDue,
  markSubscriptionPaymentFailed,
  markPaymentActionRequired,
  clearPaymentActionRequired,
  changeSubscriptionPlan,
  transitionSubscription,
  completeCancellation,
  expireSubscription,
} from "./subscriptions";
import { validateTransition } from "./subscription-machine";
import {
  getPaymentByCheckoutSessionId,
  getPaymentById,
  getPaymentByStripeCharge,
  confirmPayment,
  createPayment,
  patchPayment,
  periodForInterval,
  rejectPayment,
} from "./payments";
import { applyRefund } from "./refunds";
import { hasSubscriptionEventForPayment } from "./events";
import {
  loadPriceIndex,
  resolveSubscriptionPlan,
  subscriptionPriceIds,
  classifyPlanChange,
  intervalFromPeriod,
} from "./stripe-price-map";
import type { RefundStatus } from "./refunds";
import { getPlanById } from "./plans";
import { recordSystemEvent } from "./system-events";
import type { SubscriptionRecord } from "./types";

/**
 * Stripe webhook event processing. All business rules run server-side; the
 * webhook route is a thin authenticated wrapper around this module.
 *
 * Order of arrival is not guaranteed, so every handler is written to converge
 * on the correct state regardless of which event lands first.
 */

const EVENT_TYPES = new Set([
  "checkout.session.completed",
  // Delayed payment methods (bank debits, some wallets, cash vouchers) settle
  // after the customer has already left the Checkout page. Without these two
  // events such an order is never activated, or a failed one is never revoked.
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  // The saved card cannot be charged (expired, failed 3DS, insufficient funds
  // after the issuer declined). Stripe stops retrying, so this is the only
  // notice that the user has to act before access is lost.
  "invoice.payment_action_required",
  // Refunds are initiated on Stripe, not in Baton, so these are the only way a
  // returned payment is ever learned about.
  "charge.refunded",
  "refund.updated",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.created",
]);

export function stripeEventTypeSupported(type: string): boolean {
  return EVENT_TYPES.has(type);
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_succeeded":
      await onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_failed":
      await onCheckoutSessionAsyncFailed(event.data.object as Stripe.Checkout.Session);
      break;
    case "invoice.paid":
      await onInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_action_required":
      await onInvoicePaymentActionRequired(event.data.object as Stripe.Invoice);
      break;
    case "charge.refunded":
      await onChargeRefunded(event.data.object as Stripe.Charge);
      break;
    case "refund.updated":
      await onRefundUpdated(event.data.object as Stripe.Refund);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.created":
      await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

// 
// Handlers
// 

function epochSecondsToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

async function onCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // `unpaid` covers both an abandoned session and a delayed payment method
  // that has not settled yet; the latter is handled by the
  // `async_payment_succeeded` event, so returning here is correct in both cases.
  if (session.payment_status !== "paid") return;

  const packageUrl = session.metadata?.planId ? await getPlanById(session.metadata.planId) : null;
  const planId = packageUrl?.id ?? null;

  let payment = await getPaymentByCheckoutSessionId(session.id);
  if (!payment) {
    if (!session.metadata?.paymentId) {
      logger.warn("stripe-checkout-no-payment-meta", { session: session.id });
      return;
    }
    payment = await getPaymentById(session.metadata.paymentId);
  }
  if (!payment) {
    await recordSystemEvent({
      eventType: "stripe_checkout_missing_payment",
      severity: "warn",
      status: "missing",
      message: `Checkout session ${session.id} completed but no matching payment row was found.`,
      metadata: { sessionId: session.id },
    });
    return;
  }

  const { payment: confirmed, claimed } = await confirmPayment(payment.id);
  if (confirmed.status !== "confirmed") {
    // The user cancelled the checkout while the payment was in flight (or the
    // payment was already terminal). Money may have moved at Stripe, but access
    // is never granted from a cancelled payment. The webhook event still counts
    // as processed so Stripe does not retry it forever.
    await recordSystemEvent({
      eventType: "stripe_checkout_payment_not_confirmed",
      severity: "warn",
      status: "ignored",
      message: `Checkout session ${session.id} reported paid but the recorded payment is ${confirmed.status}; access not granted.`,
      metadata: { sessionId: session.id, paymentId: payment.id, paymentStatus: confirmed.status },
    });
    return;
  }

  await patchPayment(payment.id, {
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    stripe_invoice_id: typeof session.invoice === "string" ? session.invoice : null,
    paid_at: confirmed.paid_at ?? new Date().toISOString(),
  });

  const subId = session.metadata?.subscriptionId ?? payment.subscription_id;
  if (!subId) {
    // Subscription intent wasn't created before checkout; leave the confirmed
    // payment as the source of truth and let the subscription.bound events
    // activate the row when Stripe reports it.
    return;
  }
  // Idempotency: the confirm-race loser must not re-apply the activation, and a
  // re-delivered webhook must not either. The event ledger records that this
  // payment already activated the subscription.
  if (!claimed && (await hasSubscriptionEventForPayment(payment.id))) {
    return;
  }
  const subscription = await getSubscriptionById(subId);
  if (!subscription) {
    await recordSystemEvent({
      eventType: "stripe_checkout_subscription_missing",
      severity: "warn",
      status: "missing",
      message: `Checkout ${session.id} referenced subscription ${subId} which does not exist.`,
      metadata: { sessionId: session.id, subscriptionId: subId },
    });
    return;
  }

  const now = new Date();
  const asideFromInterval =
    (payment.metadata as { interval?: string } | null)?.interval === "annual" ? "annual" : "monthly";
  const period = periodForInterval(asideFromInterval, now);

  await activateSubscription(subscription.id, {
    source: "stripe",
    paymentId: payment.id,
    planId,
    providerCustomerId: toProviderCustomerId(session),
    providerSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
  });
}

/**
 * A delayed payment method was declined. The order must never activate, and any
 * subscription left pending by it must not be revived later by a stale
 * `invoice.paid` for an invoice that was never collected.
 */
async function onCheckoutSessionAsyncFailed(session: Stripe.Checkout.Session): Promise<void> {
  const paymentId = session.metadata?.paymentId ?? null;
  if (paymentId) {
    const payment = await getPaymentById(paymentId);
    if (payment) await rejectPayment(payment.id, "Stripe reported the delayed payment method failed.");
  }
  const subscriptionId = session.metadata?.subscriptionId ?? null;
  if (subscriptionId) {
    const subscription = await getSubscriptionById(subscriptionId);
    if (subscription && subscription.status === "pending") {
      await markSubscriptionPaymentFailed(subscription.id, {
        source: "stripe",
        reason: `Stripe delayed payment failed for Checkout session ${session.id}`,
      });
    }
  }
  await recordSystemEvent({
    eventType: "stripe_async_payment_failed",
    severity: "warn",
    status: "failed",
    message: `Delayed payment for Checkout session ${session.id} failed; access was not granted.`,
    metadata: { sessionId: session.id, paymentId, subscriptionId },
  });
}

async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subscriptionId) return;

  const subscription = await getSubscriptionByProviderSubId(subscriptionId);
  if (!subscription) {
    await recordSystemEvent({
      eventType: "stripe_invoice_no_subscription",
      severity: "info",
      status: "pending",
      message: `Invoice ${invoice.id} paid for unknown subscription ${subscriptionId}`,
      metadata: { invoiceId: invoice.id, subscriptionId },
    });
    return;
  }

  // Find or create the renewal payment keyed on the Stripe invoice id.
  const sb = getAdminClient();
  const { data: existing, error: findError } = await sb
    .from("payments")
    .select("*")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();
  if (findError) throw new Error(`payments.find-by-invoice failed: ${findError.message}`);

  // Stripe moved `period_start`/`period_end` off the invoice object onto its
  // line items in API version 2025-03-31, so the top-level fields are `null`
  // for every invoice on a modern account. Falling back to `new Date()` for
  // both ends produced a window that expires the instant it is written, or, if
  // the nulls were written through, one that never expires at all. The
  // interval is recovered from whatever Stripe did send, and the missing bound
  // is reconstructed from it so the stored window is always one full period.
  const interval: "monthly" | "annual" = invoiceCycle(invoice);
  const { start, end } = paidWindow(
    epochSecondsToIso(invoice.period_start),
    epochSecondsToIso(invoice.period_end),
    interval,
  );

  const payment =
    existing ?? (await createPayment({
      userId: subscription.user_id,
      subscriptionId: subscription.id,
      planId: subscription.plan_id,
      provider: "stripe",
      paymentType: "renewal",
      status: "confirmed",
      amount: invoice.amount_paid ?? 0,
      currency: (invoice.currency ?? "usd").toUpperCase(),
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
      metadata: { interval },
    }));

  if (existing) {
    await patchPayment(existing.id, {
      stripe_payment_intent_id: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
      status: "confirmed",
      paid_at: new Date().toISOString(),
    });
  }

  if (subscription.payment_action_required) {
    // The invoice settled, so whatever made the card unusable is resolved. The
    // flag is cleared before the transition so the dashboard stops prompting even
    // if the transition below is refused.
    await clearPaymentActionRequired(subscription.id, "invoice paid");
  }

  if (subscription.status === "pending") {
    await activateSubscription(subscription.id, {
      source: "stripe",
      paymentId: payment.id,
      planId: subscription.plan_id,
      providerCustomerId: toProviderCustomerId(invoice),
      providerSubscriptionId: subscriptionId,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
  } else if (validateTransition(subscription.status, "active") === null) {
    await renewSubscription(subscription.id, {
      source: "stripe",
      paymentId: payment.id,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
  } else {
    // A canceled/expired row cannot be revived by a stray invoice; the payment
    // is recorded but the subscription lifecycle is not forced.
    await recordSystemEvent({
      eventType: "stripe_invoice_ignored",
      severity: "warn",
      status: "ignored",
      message: `Invoice ${invoice.id} paid but local subscription is ${subscription.status}; not transitioning.`,
      metadata: { invoiceId: invoice.id, subscriptionId: subscription.id, localStatus: subscription.status },
    });
  }
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subscriptionId) return;
  const subscription = await getSubscriptionByProviderSubId(subscriptionId);
  if (!subscription) return;
  if (subscription.status === "pending") {
    await markSubscriptionPaymentFailed(subscription.id, {
      source: "stripe",
      reason: `Stripe invoice ${invoice.id} ${invoice.status ?? "unpaid"}`,
    });
    return;
  }
  // Only a receivable state can move to past_due; a canceled/expired/payment_failed
  // row has no paid window left, so the invoice merely confirms what is true.
  if (validateTransition(subscription.status, "past_due") === null) {
    await markPastDue(subscription.id, `Stripe invoice ${invoice.id} ${invoice.status ?? "unpaid"}`);
  }
}

/**
 * Stripe stopped retrying and is waiting on the customer.
 *
 * Unlike `invoice.payment_failed`, this will never resolve on its own: the saved
 * card is unusable (expired, or a 3DS challenge was not completed). Marking it
 * past_due would be wrong twice over, housekeeping would expire a subscription
 * Stripe is still willing to collect once the card is fixed, and the dashboard
 * would tell the user to wait. The row gets a durable flag instead, which the
 * billing page renders as "update your card".
 */
async function onInvoicePaymentActionRequired(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subscriptionId) return;
  const subscription = await getSubscriptionByProviderSubId(subscriptionId);
  if (!subscription) {
    await recordSystemEvent({
      eventType: "stripe_action_required_no_subscription",
      severity: "warn",
      status: "missing",
      message: `Invoice ${invoice.id} requires a payment action but subscription ${subscriptionId} is unknown locally.`,
      metadata: { invoiceId: invoice.id, subscriptionId },
    });
    return;
  }

  const reason = actionRequiredReason(invoice);
  await markPaymentActionRequired(subscription.id, reason);

  await recordSystemEvent({
    eventType: "stripe_payment_action_required",
    severity: "warn",
    status: "action_required",
    message: `Subscription ${subscription.id} requires the customer to update their payment method: ${reason}`,
    userId: subscription.user_id,
    metadata: { invoiceId: invoice.id, subscriptionId, reason },
  });
}

/**
 * Turn Stripe's machine reason into something a user can act on.
 *
 * Only a short, fixed vocabulary is produced. `invoice.last_finalization_error`
 * can carry gateway detail (issuer response codes, AVS/CVV outcomes) which is
 * neither safe to store nor useful to show, so the raw code is deliberately
 * dropped in favour of a human sentence.
 */
function actionRequiredReason(invoice: Stripe.Invoice): string {
  const code = invoice.last_finalization_error?.code ?? null;
  switch (code) {
    case "expired_card":
      return "Your card has expired. Update your payment method to keep your plan.";
    case "incorrect_cvc":
      return "The security code on your card was declined. Update your payment method.";
    case "incorrect_number":
      return "Your card number was declined. Update your payment method.";
    case "invalid_number":
      return "That card number is not valid. Update your payment method.";
    case "card_declined":
      return "Your bank declined the card. Update your payment method.";
    case "authentication_required":
      return "Your bank needs you to verify this payment. Update your payment method.";
    case "processing_error":
      return "Your bank could not process this card. Update your payment method.";
    default:
      return "Your payment method could not be charged. Update it to keep your plan.";
  }
}

/**
 * A charge was refunded (fully or partially).
 *
 * `charge.refunds` is the complete list of refunds against the charge, not just
 * the one that triggered the event, so every entry is applied. `recordRefund`
 * ignores ones already on the ledger, which makes redelivery cheap and correct.
 */
async function onChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : null;

  const refunds = charge.refunds?.data ?? [];
  if (refunds.length === 0) {
    // Stripe can report a charge as refunded with no refund objects on this
    // payload version. Nothing can be attributed, so record it rather than
    // silently treating the payment as still paid.
    await recordSystemEvent({
      eventType: "stripe_refund_without_refunds",
      severity: "warn",
      status: "missing",
      message: `Charge ${charge.id} was reported refunded but carried no refund objects; ${charge.amount_refunded} of ${charge.amount} ${charge.currency.toUpperCase()} returned.`,
      metadata: {
        chargeId: charge.id,
        amountRefunded: charge.amount_refunded,
        amount: charge.amount,
      },
    });
    return;
  }

  for (const refund of refunds) {
    const payment = await getPaymentByStripeCharge(paymentIntentId, invoiceId);
    if (!payment) {
      await recordSystemEvent({
        eventType: "stripe_refund_unmatched",
        severity: "warn",
        status: "missing",
        message: `Refund ${refund.id} on charge ${charge.id} could not be matched to a Baton payment.`,
        metadata: { refundId: refund.id, chargeId: charge.id, paymentIntentId, invoiceId },
      });
      continue;
    }
    const outcome = await applyRefund({
      paymentId: payment.id,
      refund: {
        stripeRefundId: refund.id,
        stripeChargeId: typeof charge.id === "string" ? charge.id : null,
        amount: refund.amount,
        currency: refund.currency,
        status: refundStatus(refund),
        reason: refundFailureReason(refund),
        cumulativeRefundedAmount: charge.amount_refunded,
      },
    });
    logger.info("stripe-refund-applied", {
      refundId: refund.id,
      paymentId: payment.id,
      outcome: outcome ?? "unmatched",
    });
  }
}

/**
 * A refund's state changed after it was created (a pending refund that later
 * settled, failed, or was cancelled).
 *
 * `charge.refunded` fires on every refund, so this handler exists for the case
 * where the refund settles *after* the charge event: without it a refund that
 * was pending when first seen would stay pending in the ledger forever.
 */
async function onRefundUpdated(refund: Stripe.Refund): Promise<void> {
  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;
  const paymentIntentId =
    typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;

  // This Stripe version's `Refund` type has no invoice field, so a refund is
  // resolved by payment intent only. A refund with neither is unmatched rather
  // than guessed at.
  const payment = await getPaymentByStripeCharge(paymentIntentId, null);
  if (!payment) {
    logger.debug("stripe-refund-update-unmatched", { refundId: refund.id, chargeId });
    return;
  }

  const outcome = await applyRefund({
    paymentId: payment.id,
    refund: {
      stripeRefundId: refund.id,
      stripeChargeId: chargeId,
      amount: refund.amount,
      currency: refund.currency,
      status: refundStatus(refund),
      reason: refundFailureReason(refund),
      cumulativeRefundedAmount: refund.amount,
    },
  });
  logger.info("stripe-refund-state-updated", {
    refundId: refund.id,
    paymentId: payment.id,
    outcome: outcome ?? "unmatched",
  });
}

/** Only Stripe's own fixed reason enum; `failure_reason` can hold gateway detail. */
function refundFailureReason(refund: Stripe.Refund): string | null {
  return refund.reason ? String(refund.reason) : null;
}

/**
 * Map Stripe's refund status onto the ledger vocabulary.
 *
 * Stripe's enum is open-ended in the API surface (`string` plus a union of known
 * values), so an unrecognised value is mapped by meaning rather than passed
 * through: anything that is not an explicit failure or cancellation is treated as
 * a settled refund, because `charge.refunded` only fires for refunds Stripe has
 * actually applied.
 */
function refundStatus(refund: Stripe.Refund): RefundStatus {
  const status = String(refund.status ?? "succeeded");
  switch (status) {
    case "pending":
    case "succeeded":
    case "failed":
    case "cancelled":
    case "canceled":
      return status === "canceled" ? "cancelled" : (status as RefundStatus);
    default:
      return "succeeded";
  }
}

async function onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const local = await getSubscriptionByProviderSubId(subscription.id);
  if (!local) {
    await recordSystemEvent({
      eventType: "stripe_subscription_missing",
      severity: "warn",
      status: "missing",
      message: `Stripe subscription ${subscription.id} updated but no local row exists.`,
      metadata: { stripeSubscriptionId: subscription.id },
    });
    return;
  }

  await patchSubscriptionFields(local.id, {
    current_period_start: epochSecondsToIso(subscription.current_period_start),
    current_period_end: epochSecondsToIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    provider_customer_id: toProviderCustomerId(subscription),
  });

  if (subscription.status === "past_due" && validateTransition(local.status, "past_due") === null) {
    await markPastDue(local.id);
  }

  // Upgrades and downgrades are made on Stripe (through the Billing Portal), so
  // this is the only place the new plan becomes visible. Without it the user pays
  // for a different plan and keeps the old entitlement until a renewal happens
  // to overwrite the period.
  await syncPlanFromStripe(local, subscription);

  await syncIncompleteState(local, subscription);
}

/**
 * Align the local plan with the price Stripe is actually charging.
 *
 * Skipped when the price does not map to a configured plan: that is a
 * configuration gap, and guessing would either grant or revoke access on a
 * technicality. It is recorded instead so an operator can fix the plan row.
 */
async function syncPlanFromStripe(
  local: SubscriptionRecord,
  stripeSub: Stripe.Subscription,
): Promise<void> {
  const { index, duplicatePriceIds } = await loadPriceIndex();
  if (duplicatePriceIds.length > 0) {
    await recordSystemEvent({
      eventType: "stripe_plan_price_duplicate",
      severity: "error",
      status: "config_error",
      message: `Stripe price id(s) ${duplicatePriceIds.join(", ")} are mapped to more than one plan; plan resolution for upgrades/downgrades is ambiguous.`,
      metadata: { duplicatePriceIds },
    });
  }

  const resolved = resolveSubscriptionPlan(stripeSub, index);
  if (!resolved) {
    await recordSystemEvent({
      eventType: "stripe_plan_unmapped_price",
      severity: "warn",
      status: "config_error",
      message: `Subscription ${local.id} is billed for a price that no plan maps to; local plan left unchanged.`,
      metadata: {
        subscriptionId: local.id,
        stripeSubscriptionId: stripeSub.id,
        priceIds: subscriptionPriceIds(stripeSub),
      },
    });
    return;
  }

  const { binding, ambiguous } = resolved;
  if (ambiguous) {
    await recordSystemEvent({
      eventType: "stripe_plan_multiple_prices",
      severity: "info",
      status: "ambiguous",
      message: `Subscription ${local.id} has several billable prices; the highest (${binding.planSlug}) was used.`,
      metadata: { subscriptionId: local.id, priceIds: subscriptionPriceIds(stripeSub) },
    });
  }

  if (binding.planId === local.plan_id) return;

  const currentPlan = local.plan;
  const direction = currentPlan
    ? classifyPlanChange(
        {
          monthlyCents: currentPlan.monthly_price_cents,
          annualCents: currentPlan.annual_price_cents,
        },
        { monthlyCents: binding.monthlyCents, annualCents: binding.annualCents },
        intervalOfPeriod(local),
        binding.interval,
      )
    : "lateral";

  await changeSubscriptionPlan(local.id, binding.planId, {
    reason: `Stripe subscription changed to ${binding.planName} (${binding.interval})`,
    eventType:
      direction === "upgrade"
        ? "subscription_upgraded"
        : direction === "downgrade"
          ? "subscription_downgraded"
          : "subscription_plan_changed",
  });

  logger.info("stripe-plan-synced", {
    subscriptionId: local.id,
    from: local.plan_id,
    to: binding.planId,
    direction,
  });
}

/**
 * The interval the local subscription is on, read from its own paid window.
 *
 * There is no interval column on the subscription: it is only recorded on the
 * payment that opened it. Reconstructing it from the length of the window that
 * was actually charged avoids a second query per plan change and cannot drift
 * from the period the user is really on.
 */
function intervalOfPeriod(subscription: SubscriptionRecord): "monthly" | "annual" {
  return intervalFromPeriod(subscription.current_period_start, subscription.current_period_end);
}

/**
 * Reconcile Stripe's non-billing subscription statuses.
 *
 *  - `incomplete`: the first payment never settled. Stripe retries for 23 hours,
 *    so the row stays pending but is flagged so the user is told to act. A
 *    scheduled housekeeping pass fails it once Stripe's own window closes.
 *  - `incomplete_expired` / `unpaid`: Stripe has given up. Fail or expire the row
 *    so access stops, rather than leaving a customer on a plan that is unpaid.
 *  - `active` / `trialing`: clear the action-required flag, since the card
 *    clearly works now.
 *  - `paused`: access is already suspended at Stripe; the row is closed.
 */
async function syncIncompleteState(
  local: SubscriptionRecord,
  stripeSub: Stripe.Subscription,
): Promise<void> {
  switch (stripeSub.status) {
    case "incomplete": {
      if (!local.payment_action_required) {
        await markPaymentActionRequired(
          local.id,
          "Your first payment has not completed. Finish it to activate your plan.",
        );
      }
      return;
    }
    case "incomplete_expired": {
      if (validateTransition(local.status, "payment_failed") === null) {
        await markSubscriptionPaymentFailed(local.id, {
          source: "stripe",
          reason: "Stripe could not collect the initial payment and the subscription expired",
        });
      }
      return;
    }
    case "unpaid": {
      // Stripe stops retrying entirely here; the paid window is over.
      if (validateTransition(local.status, "expired") === null) {
        await transitionSubscription(local.id, {
          to: "expired",
          eventType: "subscription_expired",
          source: "system",
          reason: "Stripe marked the subscription unpaid and stopped retrying",
          endedAt: new Date().toISOString(),
        });
      }
      return;
    }
    case "active":
    case "trialing": {
      if (local.payment_action_required) {
        await clearPaymentActionRequired(local.id, "payment method is working again");
      }
      return;
    }
    case "paused": {
      if (validateTransition(local.status, "expired") === null) {
        await transitionSubscription(local.id, {
          to: "expired",
          eventType: "subscription_expired",
          source: "system",
          reason: "Stripe paused the subscription (no payment method on file)",
          endedAt: new Date().toISOString(),
        });
      }
      return;
    }
    default:
      return;
  }
}

async function onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const local = await getSubscriptionByProviderSubId(subscription.id);
  if (!local) return;

  if (local.cancel_at_period_end) {
    await completeCancellation(local.id);
  } else {
    // Unexpected deletion: treat as expiration.
    await expireSubscription(local.id);
  }
}

// 
// Small helpers
// 

function patchSubscriptionFields(id: string, patch: Record<string, unknown>) {
  const sb = getAdminClient();
  return sb
    .from("subscriptions")
    .update({ updated_at: new Date().toISOString(), ...patch })
    .eq("id", id);
}

type WithCustomer = { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null };

function toProviderCustomerId(obj: WithCustomer): string | null {
  if (typeof obj.customer === "string") return obj.customer;
  if (obj.customer && typeof obj.customer === "object" && "id" in obj.customer) return obj.customer.id;
  return null;
}

/** Annual invoices land near 365 days; anything at or above 330 counts as one. */
const ANNUAL_WINDOW_MS = 330 * 86_400_000;

/**
 * Build a paid window that is always exactly one full billing period.
 *
 * The two bounds must not be mixed independently. `periodForInterval` derives
 * both ends from `now`, so combining a real start with a derived end would
 * produce a window that is longer or shorter than the interval that was
 * actually charged. Whichever bound Stripe supplied is kept, and the other is
 * reconstructed from it.
 */
function paidWindow(
  start: string | null,
  end: string | null,
  interval: "monthly" | "annual",
): { start: string; end: string } {
  if (start && end) return { start, end };
  if (start) return { start, end: shiftPeriod(new Date(start), interval) };
  if (end) return { start: shiftPeriod(new Date(end), interval, -1), end };
  return periodForInterval(interval);
}

function shiftPeriod(from: Date, interval: "monthly" | "annual", direction: 1 | -1 = 1): string {
  const out = new Date(from.getTime());
  if (interval === "annual") out.setUTCFullYear(out.getUTCFullYear() + direction);
  else out.setUTCMonth(out.getUTCMonth() + direction);
  return out.toISOString();
}

/**
 * Decide which billing interval an invoice represents.
 *
 * Stripe 2025-03-31 removed `period_start`/`period_end` from the invoice and
 * moved them onto the subscription's line items, so the top-level fields are
 * frequently null. Every shape is consulted in order and the interval is never
 * guessed from "no data": when nothing can be determined the shorter (monthly)
 * window is used, because over-granting a year of access from a missing field is
 * far more expensive than under-granting 30 days, and Stripe re-sends the
 * subscription state on the next event either way.
 */
function invoiceCycle(invoice: Stripe.Invoice): "monthly" | "annual" {
  const topStart = epochSecondsToIso(invoice.period_start);
  const topEnd = epochSecondsToIso(invoice.period_end);
  if (topStart && topEnd) {
    const span = Date.parse(topEnd) - Date.parse(topStart);
    if (span > 0) return span >= ANNUAL_WINDOW_MS ? "annual" : "monthly";
  }

  const lines = Array.isArray(invoice.lines?.data) ? invoice.lines.data : [];
  for (const line of lines) {
    const lineStart = line.period?.start;
    const lineEnd = line.period?.end;
    if (typeof lineStart === "number" && typeof lineEnd === "number" && lineEnd > lineStart) {
      return (lineEnd - lineStart) * 1000 >= ANNUAL_WINDOW_MS ? "annual" : "monthly";
    }
  }
  return "monthly";
}
