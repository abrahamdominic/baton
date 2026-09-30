import {
  isPeriodExpired,
  subscriptionCountsAsPaid,
} from "./subscription-machine";
import { FEATURE_KEYS, SUBSCRIPTION_STATUS_LABELS } from "./types";
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

/**
 * Free plan caps.
 *
 * `maxMembers` is 3 rather than 0 so a Free workspace can actually invite
 * anyone. At 0 the invitation path could not distinguish "this plan has no
 * seats" from "the check is broken" -- and it was broken, because the owner was
 * counted against the cap, so every invite was refused with an opaque server
 * error. Three seats is enough to demonstrate the feature and to make a second
 * browser usable, and it still leaves Team (25) and Organization (1000) as the
 * upgrades that matter.
 */
/** Seats a Free workspace has beyond its owner. */
export const FREE_MAX_MEMBERS = 3;

export const FREE_PLAN_LIMITS: PlanLimits = {
  maxRepos: FREE_TIER_MAX_REPOS,
  maxMembers: FREE_MAX_MEMBERS,
  features: [],
};

/** Plan precedence when merging own + workspace entitlements (higher wins). */
const PLAN_PRIORITY: Record<string, number> = {
  organization: 30,
  team: 20,
  free: 10,
};

/**
 * The only feature keys an entitlement may ever grant. `plan.limits.features` is
 * persisted as free-form JSON, so a corrupted or hand-edited row must not be
 * able to invent keys (or prototype-pollute the feature map) and unlock a
 * capability no plan actually sells.
 */
const KNOWN_FEATURE_KEYS: ReadonlySet<string> = new Set<string>(
  Object.values(FEATURE_KEYS),
);

function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && KNOWN_FEATURE_KEYS.has(value);
}

/**
 * Read one numeric cap out of a free-form `limits` blob.
 *
 * `null` means "no cap" and is only honoured when the stored value is
 * genuinely `null`/`undefined` — i.e. when an administrator deliberately wrote
 * "unlimited". A malformed, negative, zero, or fractional value falls back to
 * `0` instead of `null`: failing open would hand a corrupted row an unlimited
 * allowance, and failing closed costs a customer nothing they could prove they
 * were entitled to.
 */
function readCap(
  raw: Record<string, unknown>,
  key: "maxRepos" | "maxMembers",
): number | null {
  const value = raw[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return value;
  return 0;
}

export function parsePlanLimits(limits: unknown): PlanLimits {
  const raw = (limits ?? {}) as Record<string, unknown>;
  const maxRepos = readCap(raw, "maxRepos");
  const maxMembers = readCap(raw, "maxMembers");
  const features = Array.isArray(raw.features)
    ? (raw.features.filter(isFeatureKey) as FeatureKey[])
    : [];
  return {
    maxRepos,
    maxMembers,
    features,
  };
}

export function featureMapFromLimits(limits: PlanLimits): FeatureMap {
  const map: FeatureMap = {};
  for (const key of limits.features ?? []) {
    if (key === FEATURE_KEYS.unlimitedRepos) {
      // `unlimited_repos` is a derived alias of the repo cap: a plan listing the
      // key is still bounded when maxRepos is numeric. Resolve it here so the
      // feature map never lies about the actual cap.
      map[key] = limits.maxRepos === null;
      continue;
    }
    map[key] = true;
  }
  return map;
}

export function hasFeature(entitlement: Entitlement, key: FeatureKey): boolean {
  // `unlimited_repos` is a derived alias of the repo cap AND the plan's own
  // grant: a plan that never lists the key grants nothing, and a plan that
  // lists it is still bounded when maxRepos is numeric.
  if (key === FEATURE_KEYS.unlimitedRepos) {
    return entitlement.features[key] === true && entitlement.maxRepos === null;
  }
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
export function betterPlan(
  a: PlanLabel | null,
  b: PlanLabel | null,
): PlanLabel | null {
  const order = (p: PlanLabel | null) => (p ? (PLAN_PRIORITY[p.slug] ?? 0) : 0);
  return order(a) >= order(b) ? a : b;
}

/** Build an entitlement from a subscription (only counts while it is paid). */
export function entitlementFromSubscription(
  sub: SubscriptionRecord | null,
  source: Entitlement["source"],
): Entitlement | null {
  if (!sub || !sub.plan) return null;
  const paid =
    subscriptionCountsAsPaid(sub.status) &&
    !isPeriodExpired(sub.status, sub.current_period_end);
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

export function mergeEntitlements(
  a: Entitlement | null,
  b: Entitlement | null,
): Entitlement | null {
  if (!a) return b;
  if (!b) return a;
  // Paid access must be carried over from whichever side actually has it.
  // Hardcoding `true` here would report paid access for a user whose only
  // entitlements are the free tier.
  const hasPaidAccess = a.hasPaidAccess || b.hasPaidAccess;
  if (!hasPaidAccess) {
    return {
      ...a,
      ...b,
      ...freeEntitlement(null),
      subscription: a.subscription ?? null,
    };
  }
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
