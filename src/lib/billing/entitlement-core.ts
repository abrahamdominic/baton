import { isPeriodExpired, subscriptionCountsAsPaid } from "./subscription-machine";
import { SUBSCRIPTION_STATUS_LABELS } from "./types";
import type {
  Entitlement,
  FeatureKey,
  FeatureMap,
  PlanLimits,
  SubscriptionRecord,
} from "./types";

/**
 * Pure entitlement resolution: everything that derives "what can this user do"
 * from a subscription row + plan limits. No I/O here so the rules are directly
 * unit-testable; the server-side I/O wrapper lives in entitlement.ts.
 */

/** Active repository cap for the free tier (no paid plan entitlement). */
export const FREE_TIER_MAX_REPOS = 3;

export const FREE_PLAN_LIMITS: PlanLimits = {
  maxRepos: FREE_TIER_MAX_REPOS,
  maxMembers: 0,
  features: [],
};

/** Plan precedence when merging own + workspace entitlements (higher wins). */
const PLAN_PRIORITY: Record<string, number> = {
  organization: 30,
  team: 20,
  free: 10,
};

export function parsePlanLimits(limits: unknown): PlanLimits {
  const raw = (limits ?? {}) as Record<string, unknown>;
  const maxRepos =
    typeof raw.maxRepos === "number" && Number.isInteger(raw.maxRepos) && raw.maxRepos > 0
      ? raw.maxRepos
      : null;
  const maxMembers =
    typeof raw.maxMembers === "number" && Number.isInteger(raw.maxMembers) && raw.maxMembers > 0
      ? raw.maxMembers
      : null;
  const features = Array.isArray(raw.features)
    ? (raw.features.filter((k): k is FeatureKey => typeof k === "string") as FeatureKey[])
    : [];
  return {
    maxRepos,
    maxMembers,
    features,
  };
}

export function featureMapFromLimits(limits: PlanLimits): FeatureMap {
  const map: FeatureMap = {};
  for (const key of limits.features ?? []) map[key] = true;
  return map;
}

export function hasFeature(entitlement: Entitlement, key: FeatureKey): boolean {
  return entitlement.features[key] === true;
}

function unifyCap(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

function unifyFeatures(a: FeatureMap, b: FeatureMap): FeatureMap {
  return { ...a, ...b };
}

interface PlanLabel {
  slug: string;
  name: string;
}

/** Best plan slug between two selections ("free" when neither is paid). */
export function betterPlan(a: PlanLabel | null, b: PlanLabel | null): PlanLabel | null {
  const order = (p: PlanLabel | null) => (p ? PLAN_PRIORITY[p.slug] ?? 0 : 0);
  return order(a) >= order(b) ? a : b;
}

/** Build an entitlement from a subscription (only counts while it is paid). */
export function entitlementFromSubscription(
  sub: SubscriptionRecord | null,
  source: Entitlement["source"],
): Entitlement | null {
  if (!sub || !sub.plan) return null;
  const paid = subscriptionCountsAsPaid(sub.status) && !isPeriodExpired(sub.status, sub.current_period_end);
  if (!paid) return null;
  const limits = parsePlanLimits(sub.plan.limits);
  return {
    planSlug: sub.plan.slug,
    planName: sub.plan.name,
    hasPaidAccess: true,
    maxRepos: limits.maxRepos ?? null,
    maxMembers: limits.maxMembers ?? null,
    features: featureMapFromLimits(limits),
    subscription: sub,
    status: sub.status,
    statusLabel: SUBSCRIPTION_STATUS_LABELS[sub.status],
    source,
  };
}

export function freeEntitlement(sub: SubscriptionRecord | null): Entitlement {
  const free: Entitlement = {
    planSlug: "free",
    planName: "Free",
    hasPaidAccess: false,
    maxRepos: FREE_PLAN_LIMITS.maxRepos ?? null,
    maxMembers: FREE_PLAN_LIMITS.maxMembers ?? 0,
    features: featureMapFromLimits(FREE_PLAN_LIMITS),
    subscription: null,
    status: "none",
    statusLabel: SUBSCRIPTION_STATUS_LABELS.none,
    source: "own",
  };
  // Keep the user's own status visible for a "pending checkout" style banner.
  if (sub && sub.status !== "active") {
    free.status = sub.status;
    free.statusLabel = SUBSCRIPTION_STATUS_LABELS[sub.status];
  }
  return free;
}

export function mergeEntitlements(a: Entitlement | null, b: Entitlement | null): Entitlement | null {
  if (!a) return b;
  if (!b) return a;
  const winner = betterPlan(
    { slug: a.planSlug, name: a.planName },
    { slug: b.planSlug, name: b.planName },
  )!;
  return {
    planSlug: winner.slug,
    planName: winner.name,
    hasPaidAccess: true,
    maxRepos: unifyCap(a.maxRepos, b.maxRepos),
    maxMembers: unifyCap(a.maxMembers ?? 0, b.maxMembers ?? 0),
    features: unifyFeatures(a.features, b.features),
    subscription: winner.slug === a.planSlug ? a.subscription : b.subscription,
    status: winner.slug === a.planSlug ? a.status : b.status,
    statusLabel: winner.slug === a.planSlug ? a.statusLabel : b.statusLabel,
    source: winner.slug === a.planSlug ? a.source : b.source,
  };
}