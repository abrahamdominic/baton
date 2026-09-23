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
import { BillingInputError } from "@/lib/billing/errors";

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

/** User-initiated cancellation: access continues until current_period_end. */
export async function cancelCurrentSubscription(subscriptionId: string): Promise<void> {
  const subscription = await ownedSubscriptionOrThrow(subscriptionId);
  await cancelSubscription(subscription.id, {
    reason: "user requested cancellation from billing page",
  });
  logger.info("billing-subscription-cancellation-requested", { userId: subscription.user_id });
  revalidatePath("/dashboard/billing");
}

/** Reactivate a subscription canceled at period end. */
export async function reactivateCurrentSubscription(subscriptionId: string): Promise<void> {
  const subscription = await ownedSubscriptionOrThrow(subscriptionId);
  if (subscription.status !== "active_until_period_end") {
    throw new BillingInputError("Only subscriptions canceled at period end can be reactivated.");
  }
  await reactivateSubscription(subscription.id);
  logger.info("billing-subscription-reactivated", { userId: subscription.user_id });
  revalidatePath("/dashboard/billing");
}