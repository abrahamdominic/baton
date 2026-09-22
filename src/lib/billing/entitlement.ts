import "server-only";
import { getCurrentSubscription } from "./subscriptions";
import { isPeriodExpired, subscriptionCountsAsPaid } from "./subscription-machine";
import { SUBSCRIPTION_STATUS_LABELS } from "./types";
import type { Entitlement } from "./types";

/**
 * The single entitlement resolver used by every page/API that gates features.
 * Presentational pages that merely want a status (e.g. dashboard banner) use
 * the same source so billing UI and access control never disagree.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const subscription = await getCurrentSubscription(userId);
  if (!subscription || !subscription.plan) {
    return {
      planSlug: "free",
      planName: "Free",
      hasPaidAccess: false,
      subscription: null,
      status: "none",
      statusLabel: SUBSCRIPTION_STATUS_LABELS.none,
    };
  }

  const periodExpired = isPeriodExpired(subscription.status, subscription.current_period_end);
  const hasPaidAccess = subscriptionCountsAsPaid(subscription.status) && !periodExpired;

  return {
    planSlug: subscription.plan.slug,
    planName: subscription.plan.name,
    hasPaidAccess,
    subscription,
    status: subscription.status,
    statusLabel: SUBSCRIPTION_STATUS_LABELS[subscription.status],
  };
}