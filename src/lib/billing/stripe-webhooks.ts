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
import {
  getPaymentByCheckoutSessionId,
  getPaymentById,
  confirmPayment,
  createPayment,
  patchPayment,
  periodForInterval,
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
  if (session.payment_status !== "paid") return; // abandoned / still open

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
      metadata: { interval: invoiceCycle(invoice) },
    }));

  if (existing) {
    await patchPayment(existing.id, {
      stripe_payment_intent_id: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
      status: "confirmed",
      paid_at: new Date().toISOString(),
    });
  }

  const periodStart = epochSecondsToIso(invoice.period_start);
  const periodEnd = epochSecondsToIso(invoice.period_end);
  if (subscription.status === "pending") {
    await activateSubscription(subscription.id, {
      source: "stripe",
      paymentId: payment.id,
      planId: subscription.plan_id,
      providerCustomerId: toProviderCustomerId(invoice),
      providerSubscriptionId: subscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
  } else {
    await renewSubscription(subscription.id, {
      source: "stripe",
      paymentId: payment.id,
      currentPeriodStart: periodStart ?? new Date().toISOString(),
      currentPeriodEnd: periodEnd ?? new Date().toISOString(),
    });
  }
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subscriptionId) return;
  const subscription = await getSubscriptionByProviderSubId(subscriptionId);
  if (!subscription) return;
  if (subscription.status === "pending") {
    // Initial purchase failed before activation — the pending row goes to
    // payment_failed (pending -> past_due is not a legal transition).
    await markSubscriptionPaymentFailed(subscription.id, {
      source: "stripe",
      reason: `Stripe invoice ${invoice.id} ${invoice.status ?? "unpaid"}`,
    });
    return;
  }
  await markPastDue(subscription.id, `Stripe invoice ${invoice.id} ${invoice.status ?? "unpaid"}`);
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

  if (subscription.status === "past_due") {
    await markPastDue(local.id);
  }
}

async function onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const local = await getSubscriptionByProviderSubId(subscription.id);
  if (!local) return;

  if (local.cancel_at_period_end) {
    await completeCancellation(local.id);
  } else {
    // Unexpected deletion — treat as expiration.
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

function invoiceCycle(invoice: Stripe.Invoice): "monthly" | "annual" {
  const start = invoice.period_start ? invoice.period_start * 1000 : Date.now();
  const end = invoice.period_end ? invoice.period_end * 1000 : Date.now();
  const days = (end - start) / 86_400_000;
  return days >= 330 ? "annual" : "monthly";
}