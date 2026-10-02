import "server-only";
import { getStripe } from "./stripe";
import { getCurrentSubscription } from "./subscriptions";
import { recordSystemEvent } from "./system-events";
import { BillingInputError } from "./errors";

/**
 * Stripe Billing Portal sessions: the upgrade and downgrade path.
 *
 * Plan changes are the one place Baton must not compute money itself. Proration
 * credits, the invoice a mid-cycle upgrade produces, tax, and whether an upgrade
 * bills immediately or at the next renewal are all decided by Stripe's proration
 * behaviour and the account's billing settings, and a hand-rolled version of that
 * calculation is the classic source of customers being charged the wrong amount.
 *
 * So the user changes plan on Stripe and the resulting
 * `customer.subscription.updated` webhook moves the local entitlement (see
 * `syncPlanFromStripe` in stripe-webhooks). What Baton owns is the guard rail:
 * the portal is only opened for a subscription it actually knows about,
 * belonging to the caller.
 *
 * The portal's own landing page is used rather than a deep link into a plan
 * change: it is the one URL that works whether the account is configured for
 * plan changes, payment-method updates, cancellations or invoices, and it is
 * also the documented requirement for upgrading and downgrading. A deep link
 * (`subscription_update_confirm`) fails outright on accounts where no products
 * are allowed in the portal, which would turn the button into a dead end.
 */

export interface BillingPortalInput {
  userId: string;
  /** Where Stripe should send the user when they are done in the portal. */
  returnUrl: string;
}

export interface BillingPortalResult {
  url: string;
}

/**
 * Open a Billing Portal session for the caller's current subscription.
 *
 * Throws when there is nothing to manage rather than opening a portal that shows
 * an empty "no subscription" page: from the user's side that is a dead button,
 * and the UI renders these messages as actionable text.
 */
export async function createBillingPortalSession(input: BillingPortalInput): Promise<BillingPortalResult> {
  const availability = await billingPortalAvailability(input.userId);
  if (!availability.available) {
    throw new BillingInputError(
      availability.reason === "not_stripe"
        ? "This plan is not billed through Stripe, so it has no billing portal."
        : "You do not have a billing account to manage yet.",
    );
  }

  const subscription = await getCurrentSubscription(input.userId);
  const stripe = getStripe();

  let session;
  try {
    // A Stripe subscription always has a customer, but the local column is
    // nullable (USDC and gifted rows share the table), so the id is checked
    // rather than asserted. Without one, Stripe cannot scope the session and the
    // portal would be created for whoever the secret key's default customer is.
    const customerId = subscription?.provider_customer_id;
    if (!customerId) {
      throw new BillingInputError("This subscription is not linked to a Stripe customer yet.");
    }
    session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: input.returnUrl,
    });
  } catch (err) {
    // The most common real failure is the portal not being configured on the
    // Stripe account yet, which is an operator task, not a user error.
    const message = err instanceof Error ? err.message : String(err);
    if (/portal.*(not.*configured|no configuration|configuration)/i.test(message)) {
      throw new BillingInputError(
        "The billing portal is not configured for this Stripe account yet. An administrator has to finish setting it up.",
      );
    }
    throw err;
  }

  await recordSystemEvent({
    eventType: "stripe_billing_portal_opened",
    severity: "info",
    status: "ok",
    message: `Billing portal session opened for subscription ${subscription?.id ?? "unknown"}.`,
    userId: input.userId,
    metadata: { subscriptionId: subscription?.id ?? null },
  });

  return { url: session.url };
}

/**
 * Whether the Billing Portal control should be offered at all.
 *
 * Surfaced by the billing page so the control is absent for the users it cannot
 * serve (USDC and gifted plans) rather than present and failing.
 */
export async function billingPortalAvailability(userId: string): Promise<{
  available: boolean;
  reason: "ok" | "no_subscription" | "not_stripe";
  subscriptionId: string | null;
}> {
  const subscription = await getCurrentSubscription(userId);
  if (!subscription) return { available: false, reason: "no_subscription", subscriptionId: null };
  if (subscription.payment_provider !== "stripe" || !subscription.provider_subscription_id) {
    return { available: false, reason: "not_stripe", subscriptionId: subscription.id };
  }
  return { available: true, reason: "ok", subscriptionId: subscription.id };
}
