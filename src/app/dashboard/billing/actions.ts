"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import {
  getSubscriptionById,
  cancelSubscription,
  reactivateSubscription,
  cancelPendingCheckout,
} from "@/lib/billing/subscriptions";
import { findOpenPaymentForSubscription } from "@/lib/billing/payments";
import { getStripe } from "@/lib/billing/stripe";
import { BillingInputError } from "@/lib/billing/errors";
import { resolveResumeRoute } from "@/lib/billing/resume-route";

export interface BillingActionState {
  ok: boolean;
  error?: string;
}

export interface ResumeCheckoutResult {
  ok: boolean;
  url?: string;
  error?: string;
}

async function ownedSubscriptionOrThrow(subscriptionId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required.");
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription || subscription.user_id !== user.id) throw new Error("Subscription not found.");
  return subscription;
}

export interface CancelCheckoutActionState {
  ok: boolean;
  error?: string;
}

/**
 * Cancel a pending checkout (deliberate: requires an explicit checkbox).
 * Server-authoritative: a payment that already succeeded is never cancelled,
 * and the pending subscription is only closed after the payment cancel wins.
 */
export async function cancelPendingCheckoutAction(
  _prev: CancelCheckoutActionState,
  formData: FormData,
): Promise<CancelCheckoutActionState> {
  try {
    if (formData.get("confirm") !== "on") {
      return { ok: false, error: "Please confirm that you want to cancel this checkout." };
    }
    const user = await currentUser();
    if (!user) throw new Error("Authentication required.");
    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    if (!subscriptionId) return { ok: false, error: "Missing checkout." };

    await cancelPendingCheckout(user.id, subscriptionId);
    logger.info("billing-checkout-cancelled", { userId: user.id, subscriptionId });
    revalidatePath("/dashboard/billing");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not cancel the checkout. Try again.",
    };
  }
}

/**
 * User-initiated cancellation: access continues until current_period_end.
 * The confirmation happens in a dialog; the server still re-validates
 * ownership and cancellability and returns useful errors instead of crashing.
 */
export async function cancelCurrentSubscriptionAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  try {
    if (formData.get("confirm") !== "on") {
      return { ok: false, error: "Please confirm that you want to cancel your plan." };
    }
    const subscription = await ownedSubscriptionOrThrow(
      String(formData.get("subscriptionId") ?? ""),
    );
    if (subscription.payment_provider === "gift") {
      return { ok: false, error: "Gifted access cannot be cancelled — it ends automatically." };
    }
    if (subscription.status !== "active") {
      return {
        ok: false,
        error: "Only an active subscription can be cancelled at the end of its period.",
      };
    }
    await cancelSubscription(subscription.id, {
      reason: "user requested cancellation from billing page",
    });
    logger.info("billing-subscription-cancellation-requested", { userId: subscription.user_id });
    revalidatePath("/dashboard/billing");
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingInputError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not cancel your plan. Try again or contact support." };
  }
}

/** Reactivate a subscription canceled at period end. */
export async function reactivateCurrentSubscriptionAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  try {
    const subscription = await ownedSubscriptionOrThrow(
      String(formData.get("subscriptionId") ?? ""),
    );
    if (subscription.status !== "active_until_period_end") {
      return { ok: false, error: "Only subscriptions canceled at period end can be reactivated." };
    }
    await reactivateSubscription(subscription.id);
    logger.info("billing-subscription-reactivated", { userId: subscription.user_id });
    revalidatePath("/dashboard/billing");
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingInputError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not reactivate your plan. Try again or contact support." };
  }
}

/**
 * Resume a pending checkout without creating a new one. The routing decision is
 * a pure function (`resolveResumeRoute`) over server-authoritative state:
 *  - Stripe with a still-open Checkout Session  -> its live URL (no duplicate).
 *  - Money already moved (session complete)     -> the result page.
 *  - USDC awaiting verification                 -> the result page.
 *  - Otherwise                                 -> the checkout page, which
 *    reuses the SAME pending subscription row (never a duplicate).
 */
export async function resumeCheckoutAction(
  subscriptionId: string,
): Promise<ResumeCheckoutResult> {
  try {
    const subscription = await ownedSubscriptionOrThrow(subscriptionId);
    if (subscription.status !== "pending" && subscription.status !== "payment_failed") {
      return { ok: false, error: "This checkout can no longer be continued." };
    }
    const plan = subscription.plan;
    if (!plan) return { ok: false, error: "This checkout's plan is no longer available." };

    const payment = await findOpenPaymentForSubscription(subscription.id);
    const interval =
      (payment?.metadata as { interval?: string } | null)?.interval === "annual" ? "annual" : "monthly";

    let stripeSession: { status: "open" | "complete" | "expired" | "missing"; url?: string | null } | null = null;
    if (payment?.payment_provider === "stripe" && payment.stripe_checkout_session_id) {
      try {
        const session = await getStripe().checkout.sessions.retrieve(
          payment.stripe_checkout_session_id,
        );
        if (session.status === "open" || session.status === "complete") {
          stripeSession = { status: session.status, url: session.url };
        } else {
          stripeSession = { status: "expired", url: null };
        }
      } catch {
        stripeSession = { status: "missing" };
      }
    }

    const route = resolveResumeRoute({
      subscriptionStatus: subscription.status,
      planId: subscription.plan_id,
      planSlug: plan.slug,
      interval,
      paymentProvider: payment?.payment_provider ?? null,
      paymentStatus: payment?.status ?? null,
      hasCryptoTxHash: Boolean(payment?.crypto_transaction_hash),
      paymentId: payment?.id ?? null,
      stripeSession,
    });

    if (route.kind === "closed") {
      return { ok: false, error: "This checkout can no longer be continued. Refresh your billing page." };
    }
    return { ok: true, url: route.url };
  } catch (err) {
    if (err instanceof BillingInputError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not resume this checkout. Try again or contact support." };
  }
}