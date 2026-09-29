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
  completeCancellation,
  expireSubscription,
} from "./subscriptions";
import { validateTransition } from "./subscription-machine";
import {
  getPaymentByCheckoutSessionId,
  getPaymentById,
  confirmPayment,
  createPayment,
  patchPayment,
  periodForInterval,
  rejectPayment,
} from "./payments";
import { getPlanById } from "./plans";
import { recordSystemEvent } from "./system-events";

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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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

  const confirmed = await confirmPayment(payment.id);
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
