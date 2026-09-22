import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "./types";

/**
 * The subscription lifecycle state machine.
 *
 * Entitlement is derived from a resolved *status*, never from the frontend.
 * These transitions are the only legal moves a subscription can make; any
 * other transition is rejected (server-side) and an event is recorded.
 */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  none: ["pending"],
  pending: ["active", "payment_failed"],
  payment_failed: ["pending", "active"],
  active: ["active_until_period_end", "past_due", "active"],
  active_until_period_end: ["active", "canceled"],
  past_due: ["active", "expired"],
  canceled: ["pending"],
  expired: ["pending"],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  if (from === to) return true;
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Subscription statuses an administrator is allowed to move this subscription
 * to (used to render only legal admin actions). Implicit no-op moves appear so
 * an admin can, e.g., force-confirm an already-active row with a reason.
 */
export function adminTargets(status: SubscriptionStatus): SubscriptionStatus[] {
  return [...SUBSCRIPTION_STATUSES].filter((t) => canTransition(status, t));
}

export interface TransitionError {
  from: SubscriptionStatus;
  to: SubscriptionStatus;
}

/**
 * Resolve a subscription state transition. Returns a result instead of
 * throwing so callers can surface a controlled message; throws when the
 * transition is illegal. No-op transitions (from === to) are always allowed.
 */
export function validateTransition(from: SubscriptionStatus, to: SubscriptionStatus): TransitionError | null {
  if (from === to) return null;
  if (canTransition(from, to)) return null;
  return { from, to };
}

/**
 * Whether a subscription currently grants the user paid-plan access.
 * A user keeps access only while the backend state says so.
 */
export function subscriptionCountsAsPaid(status: SubscriptionStatus): boolean {
  return status === "active" || status === "past_due" || status === "active_until_period_end";
}

/** Whether an active (or paying) subscription has passed its paid window. */
export function isPeriodExpired(
  status: SubscriptionStatus,
  currentPeriodEnd: string | null,
  now = new Date(),
): boolean {
  if (!currentPeriodEnd) return false;
  if (status !== "active_until_period_end" && status !== "past_due" && status !== "active") {
    return false;
  }
  return new Date(currentPeriodEnd).getTime() <= now.getTime();
}