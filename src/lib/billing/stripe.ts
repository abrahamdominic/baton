import "server-only";
import Stripe from "stripe";
import { getConfig, isStripeConfigured } from "@/lib/config";
import { BackendNotConfiguredError, BillingInputError } from "./errors";
import { planPriceCents } from "./pricing";
import type { PlanRecord } from "./types";

/**
 * Stripe SDK bootstrapping + Checkout session creation.
 * Everything here fails loudly (server-side only) when Stripe is unconfigured,
 * so misconfig shows up instantly instead of as a silent broken checkout.
 */

let cachedStripe: Stripe | null = null;

export function getStripe(): Stripe {
  const env = getConfig();
  if (!isStripeConfigured(env)) {
    throw new BackendNotConfiguredError("Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).");
  }
  if (!cachedStripe) {
    cachedStripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return cachedStripe;
}

export interface CreateCheckoutSessionInput {
  userId: string;
  plan: PlanRecord;
  interval: "monthly" | "annual";
  subscriptionId: string;
  paymentId: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createStripeCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<{ url: string; sessionId: string }> {
  const priceId =
    input.interval === "annual" ? input.plan.stripe_annual_price_id : input.plan.stripe_monthly_price_id;
  if (!priceId) {
    throw new BillingInputError(
      `Plan "${input.plan.slug}" has no Stripe ${input.interval} price configured. Ask an administrator to add it before offering card checkout.`,
    );
  }

  const stripe = getStripe();
  // Stripe Prices are immutable but their IDs can be changed outside Baton.
  // Validate the configured ID before sending a customer to checkout so a
  // stale/mislinked price cannot undercharge and still grant an entitlement.
  const stripePrice = await stripe.prices.retrieve(priceId);
  const expectedAmount = planPriceCents(input.plan, input.interval);
  const expectedInterval = input.interval === "annual" ? "year" : "month";
  if (
    !stripePrice.active ||
    stripePrice.currency !== "usd" ||
    stripePrice.unit_amount !== expectedAmount ||
    stripePrice.recurring?.interval !== expectedInterval ||
    (input.plan.stripe_product_id !== null && stripePrice.product !== input.plan.stripe_product_id)
  ) {
    throw new BillingInputError(
      `Plan "${input.plan.slug}" has a Stripe ${input.interval} price that does not match its configured amount. Ask an administrator to sync Stripe prices.`,
    );
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      userId: input.userId,
      planId: input.plan.id,
      subscriptionId: input.subscriptionId,
      paymentId: input.paymentId,
      interval: input.interval,
    },
    client_reference_id: input.userId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Subscription starts at the period boundary Stripe assigns; we trust the
    // webhook lifecycle to keep our local state in sync afterwards.
  });

  return { url: session.url ?? "", sessionId: session.id };
}

export function constructStripeWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  const env = getConfig();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new BackendNotConfiguredError("Stripe webhook secret is not configured.");
  }
  if (!signature) throw new BillingInputError("Missing Stripe signature.");
  return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}
