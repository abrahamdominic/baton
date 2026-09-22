"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import {
  getSubscriptionById,
  cancelSubscription,
  reactivateSubscription,
} from "@/lib/billing/subscriptions";
import { BillingInputError } from "@/lib/billing/errors";

async function ownedSubscriptionOrThrow(subscriptionId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required.");
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription || subscription.user_id !== user.id) throw new Error("Subscription not found.");
  return subscription;
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