import "server-only";
import { prisma } from "../db";
import { getCurrentSubscription } from "./subscriptions";
import { isPeriodExpired, subscriptionCountsAsPaid } from "./subscription-machine";
import { SUBSCRIPTION_STATUS_LABELS } from "./types";
import type { Entitlement } from "./types";

/**
 * The single entitlement resolver used by every page/API that gates features.
 * Presentational pages that merely want a status (e.g. dashboard banner) use
 * the same source so billing UI and access control never disagree.
 *
 * Administrators automatically receive full paid access across the application.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null),
    getCurrentSubscription(userId).catch(() => null),
  ]);

  if (user?.role === "admin") {
    return {
      planSlug: subscription?.plan?.slug ?? "organization",
      planName: subscription?.plan?.name ?? "Organization",
      hasPaidAccess: true,
      subscription: subscription ?? null,
      status: subscription?.status ?? "active",
      statusLabel: subscription ? SUBSCRIPTION_STATUS_LABELS[subscription.status] : "Active (Administrator)",
    };
  }

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