import "server-only";
import { prisma } from "../db";
import { getCurrentSubscription } from "./subscriptions";
import { SUBSCRIPTION_STATUS_LABELS } from "./types";
import type { Entitlement, PlanLimits, SubscriptionRecord } from "./types";
import {
  FREE_TIER_MAX_REPOS,
  FREE_PLAN_LIMITS,
  hasFeature,
  parsePlanLimits,
  featureMapFromLimits,
  entitlementFromSubscription,
  freeEntitlement,
  mergeEntitlements,
} from "./entitlement-core";

export {
  FREE_TIER_MAX_REPOS,
  FREE_PLAN_LIMITS,
  hasFeature,
  parsePlanLimits,
  featureMapFromLimits,
  entitlementFromSubscription,
  freeEntitlement,
  mergeEntitlements,
};
export type {
  Entitlement,
} from "./types";

export { FEATURE_KEYS } from "./types";

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
 * The pure resolution rules live in entitlement-core.ts (unit-tested).
 */

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