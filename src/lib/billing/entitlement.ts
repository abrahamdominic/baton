import "server-only";
import { prisma } from "../db";
import { getCurrentSubscription } from "./subscriptions";
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
 * The single entitlement resolver used by every page/action/API that gates a
 * feature. There is only ever one answer to "what can this user do?" and it
 * comes from the backend state machine, never from client-supplied values.
 *
 * Resolution rule, in priority order:
 *   1. Administrators always receive full paid access (source "admin").
 *   2. The user's own current subscription (source "own").
 *   3. When a workspace (team/organization) is passed and the user is a member
 *      of it, the workspace's paid subscription (source "workspace"). A paid
 *      member subscription raises the member's access for that workspace.
 *
 * Plan limits only apply while the subscription counts as paid; a pending,
 * failed, expired, or canceled row flips the user back to the free defaults so
 * a checkout mid-flight can never accidentally grant paid features.
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

/** Best plan slug between two selections ("free" when neither is paid). */
function betterPlan(a: PlanLabel | null, b: PlanLabel | null): PlanLabel | null {
  const order = (p: PlanLabel | null) => (p ? PLAN_PRIORITY[p.slug] ?? 0 : 0);
  return order(a) >= order(b) ? a : b;
}

interface PlanLabel {
  slug: string;
  name: string;
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

function freeEntitlement(sub: SubscriptionRecord | null): Entitlement {
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

function adminEntitlement(sub: SubscriptionRecord | null): Entitlement {
  const limits: PlanLimits = { maxRepos: null, maxMembers: null, features: [] };
  return {
    planSlug: sub?.plan?.slug ?? "organization",
    planName: sub?.plan?.name ?? "Organization",
    hasPaidAccess: true,
    maxRepos: null,
    maxMembers: null,
    features: { ...featureMapFromLimits(limits) },
    subscription: sub ?? null,
    status: sub?.status ?? "active",
    statusLabel: sub ? SUBSCRIPTION_STATUS_LABELS[sub.status] : "Active (Administrator)",
    source: "admin",
  };
}

function mergeEntitlements(a: Entitlement | null, b: Entitlement | null): Entitlement | null {
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

/**
 * The workspace's paid subscription, if the workspace owner holds an active
 * paid plan. null means the workspace is not currently paid, so its members
 * receive none of the workspace plan's entitlements.
 */
export async function getWorkspacePaidSubscription(
  workspaceOwnerId: string,
): Promise<SubscriptionRecord | null> {
  const ownerSub = await getCurrentSubscription(workspaceOwnerId).catch(() => null);
  return entitlementFromSubscription(ownerSub, "workspace") ? ownerSub : null;
}

export interface WorkspaceScope {
  teamId?: string;
  organizationId?: string;
}

/**
 * Resolve the entitlement a workspace grants its members. Returns null when
 * the caller is not a member or the workspace is not currently paid.
 */
async function resolveWorkspaceEntitlement(
  userId: string,
  scope: WorkspaceScope,
): Promise<Entitlement | null> {
  let ownerId: string | null = null;
  if (scope.teamId) {
    const member = await prisma.teamMember
      .findUnique({ where: { teamId_userId: { teamId: scope.teamId, userId } } })
      .catch(() => null);
    if (!member) return null;
    const team = await prisma.team
      .findUnique({ where: { id: scope.teamId }, select: { ownerId: true } })
      .catch(() => null);
    ownerId = team?.ownerId ?? null;
  } else if (scope.organizationId) {
    const member = await prisma.organizationMember
      .findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId } } })
      .catch(() => null);
    if (!member) return null;
    const org = await prisma.organization
      .findUnique({ where: { id: scope.organizationId }, select: { ownerId: true } })
      .catch(() => null);
    ownerId = org?.ownerId ?? null;
  }
  if (!ownerId) return null;
  const ownerSub = await getCurrentSubscription(ownerId).catch(() => null);
  return entitlementFromSubscription(ownerSub, "workspace");
}

export async function getEntitlement(
  userId: string,
  scope: WorkspaceScope = {},
): Promise<Entitlement> {
  const [user, ownSub] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null),
    getCurrentSubscription(userId).catch(() => null),
  ]);

  if (user?.role === "admin") {
    return adminEntitlement(ownSub);
  }

  const own = entitlementFromSubscription(ownSub, "own");
  let workspace: Entitlement | null = null;
  if (scope.teamId || scope.organizationId) {
    workspace = await resolveWorkspaceEntitlement(userId, scope);
  }

  return mergeEntitlements(own, workspace) ?? freeEntitlement(ownSub);
}

export type { Entitlement };
export { FEATURE_KEYS } from "./types";