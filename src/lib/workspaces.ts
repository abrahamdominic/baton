import "server-only";
import { prisma } from "./db";
import { STATE_META, ORDERED_STATES } from "./engine/types";
import { getWorkspacePaidSubscription, parsePlanLimits } from "./billing/entitlement";
import { currentUser, type SessionUser } from "./auth/session";
import {
  normalizeLogin,
  workspaceWhoseTurn,
  type WorkspaceRole,
} from "./workspace-utils";

export {
  INVITE_TTL_MS,
  normalizeLogin,
  generateInviteToken,
  isGitHubLogin,
  isValidSlug,
  slugFromName,
} from "./workspace-utils";
export type { WorkspaceRole } from "./workspace-utils";

/**
 * Team & Organization workspaces.
 *
 * Authorization model (enforced here AND in every calling server action):
 *  - owner  : full control, pays for the workspace plan.
 *  - admin  : can manage members, invites, shared repositories, and org policy.
 *  - member : can view the shared board and workspace pages.
 *
 * Entitlement for members resolves from the owner's live subscription (see
 * src/lib/billing/entitlement.ts); a workspace whose owner is not paid grants
 * members nothing above the free tier.
 */

/** Resolve the signed-in user, rejecting anonymous and suspended accounts. */
export async function requireActiveUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("sign-in required");
  if (user.suspendedAt) throw new Error("Your account is suspended.");
  return user;
}

export async function workspaceOwnerId(
  kind: "team" | "organization",
  workspaceId: string,
): Promise<string | null> {
  if (kind === "team") {
    const team = await prisma.team
      .findUnique({ where: { id: workspaceId }, select: { ownerId: true } })
      .catch(() => null);
    return team?.ownerId ?? null;
  }
  const org = await prisma.organization
    .findUnique({ where: { id: workspaceId }, select: { ownerId: true } })
    .catch(() => null);
  return org?.ownerId ?? null;
}

/**
 * Member ceiling for a workspace, derived from the workspace owner's live
 * paid subscription (the workspace plan), never from a member's personal plan.
 * Free workspaces and lapsed subscriptions cap at 0.
 */
export async function workspaceMemberCap(
  kind: "team" | "organization",
  workspaceId: string,
): Promise<{ cap: number; planName: string }> {
  const ownerId = await workspaceOwnerId(kind, workspaceId);
  if (!ownerId) return { cap: 0, planName: "Free" };
  const sub = await getWorkspacePaidSubscription(ownerId);
  if (!sub || !sub.plan) return { cap: 0, planName: "Free" };
  const limits = parsePlanLimits(sub.plan.limits);
  return { cap: limits.maxMembers ?? 0, planName: sub.plan.name };
}

export async function requireTeamMember(
  teamId: string,
  userId: string,
  minRole?: WorkspaceRole,
): Promise<{ id: string; role: WorkspaceRole }> {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { id: true, role: true },
  });
  if (!member) throw new Error("You are not a member of this team.");
  const role = member.role as WorkspaceRole;
  if (minRole === "owner" && role !== "owner") {
    throw new Error("Only the team owner can perform this action.");
  }
  if (minRole === "admin" && role !== "owner" && role !== "admin") {
    throw new Error("Team owner or admin access required.");
  }
  return { id: member.id, role };
}

export async function requireOrganizationMember(
  organizationId: string,
  userId: string,
  minRole?: WorkspaceRole,
): Promise<{ id: string; role: WorkspaceRole }> {
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, role: true },
  });
  if (!member) throw new Error("You are not a member of this organization.");
  const role = member.role as WorkspaceRole;
  if (minRole === "owner" && role !== "owner") {
    throw new Error("Only the organization owner can perform this action.");
  }
  if (minRole === "admin" && role !== "owner" && role !== "admin") {
    throw new Error("Organization owner or admin access required.");
  }
  return { id: member.id, role };
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  ownerLogin: string;
  paid: boolean;
  pendingInvites: number;
}

export async function listUserTeams(userId: string): Promise<WorkspaceSummary[]> {
  const teams = await prisma.team.findMany({
    where: { members: { some: { userId } } },
    include: {
      owner: { select: { login: true } },
      members: true,
      invites: { where: { status: "pending" }, select: { status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const out: WorkspaceSummary[] = [];
  for (const t of teams) {
    const role = (t.members.find((m) => m.userId === userId)?.role as WorkspaceRole) ?? "member";
    out.push({
      id: t.id,
      slug: t.slug,
      name: t.name,
      role,
      memberCount: t.members.length,
      ownerLogin: t.owner.login,
      paid: Boolean(await getWorkspacePaidSubscription(t.ownerId)),
      pendingInvites: t.invites.length,
    });
  }
  return out;
}

export async function listUserOrganizations(userId: string): Promise<WorkspaceSummary[]> {
  const orgs = await prisma.organization.findMany({
    where: { members: { some: { userId } } },
    include: {
      owner: { select: { login: true } },
      members: true,
      invites: { where: { status: "pending" }, select: { status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const out: WorkspaceSummary[] = [];
  for (const o of orgs) {
    const role = (o.members.find((m) => m.userId === userId)?.role as WorkspaceRole) ?? "member";
    out.push({
      id: o.id,
      slug: o.slug,
      name: o.name,
      role,
      memberCount: o.members.length,
      ownerLogin: o.owner.login,
      paid: Boolean(await getWorkspacePaidSubscription(o.ownerId)),
      pendingInvites: o.invites.length,
    });
  }
  return out;
}

/** Pending invitations addressed to a user (by their GitHub login). */
export async function pendingTeamInvites(login: string) {
  return prisma.teamInvite.findMany({
    where: { githubLogin: normalizeLogin(login), status: "pending", expiresAt: { gt: new Date() } },
    include: { team: { select: { id: true, name: true, slug: true, owner: { select: { login: true } } } }, invitedBy: { select: { login: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

export async function pendingOrgInvites(login: string) {
  return prisma.organizationInvite.findMany({
    where: { githubLogin: normalizeLogin(login), status: "pending", expiresAt: { gt: new Date() } },
    include: { organization: { select: { id: true, name: true, slug: true, owner: { select: { login: true } } } }, invitedBy: { select: { login: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

// ---------------------------------------------------------------------------
// Shared board (team/org): PR queue across the workspace's shared installations
// ---------------------------------------------------------------------------

export interface WorkspaceBoardItem {
  prId: string;
  number: number;
  title: string;
  url: string;
  account: string;
  owner: string;
  repo: string;
  state: string;
  stateLabel: string;
  stateTone: string;
  whoseTurn: string;
  hoursInState: number;
  authorLogin: string;
}

export async function workspaceBoard(
  kind: "team" | "organization",
  workspaceId: string,
): Promise<{ installAccounts: string[]; repos: { id: string; owner: string; name: string; enabled: boolean }[]; items: WorkspaceBoardItem[] }> {
  const links =
    kind === "team"
      ? await prisma.teamInstallation.findMany({
          where: { teamId: workspaceId },
          include: {
            installation: { include: { repos: { where: { enabled: true } } } },
          },
        })
      : await prisma.organizationInstallation.findMany({
          where: { organizationId: workspaceId },
          include: {
            installation: { include: { repos: { where: { enabled: true } } } },
          },
        });

  const installAccounts = [...new Set(links.map((l) => l.installation.accountLogin))];
  const repos = links.flatMap((l) => l.installation.repos.map((r) => ({ id: r.id, owner: r.owner, name: r.name, enabled: r.enabled })));
  const repoIds = repos.map((r) => r.id);

  if (repoIds.length === 0) return { installAccounts, repos, items: [] };

  const now = Date.now();
  const prs = await prisma.pullRequest.findMany({
    where: { repoId: { in: repoIds }, githubState: "OPEN", isDraft: false },
    include: { repo: true },
  });

  const actionableOrder = (state: string) => {
    const idx = ORDERED_STATES.indexOf(state as (typeof ORDERED_STATES)[number]);
    return idx === -1 ? 99 : idx;
  };

  const items: WorkspaceBoardItem[] = prs
    .map((pr) => ({
      prId: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      account: pr.repo.owner,
      owner: pr.repo.owner,
      repo: pr.repo.name,
      state: pr.state,
      stateLabel: STATE_META[pr.state as keyof typeof STATE_META]?.label ?? "Unknown",
      stateTone: STATE_META[pr.state as keyof typeof STATE_META]?.tone ?? "neutral",
      whoseTurn: workspaceWhoseTurn(pr.state),
      hoursInState: (now - pr.stateEnteredAt.getTime()) / 3_600_000,
      authorLogin: pr.authorLogin,
    }))
    .sort((a, b) => {
      const da = actionableOrder(a.state) - actionableOrder(b.state);
      if (da !== 0) return da;
      return b.hoursInState - a.hoursInState;
    });

  return { installAccounts, repos, items };
}

// ---------------------------------------------------------------------------
// Org-scoped audit trail (drives the audit export surface)
// ---------------------------------------------------------------------------

export async function recordOrgAudit(input: {
  organizationId: string;
  userId: string;
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      actor: input.actor,
      action: input.action,
      targetType: "organization",
      targetId: input.organizationId,
      detailJson: input.detail ? JSON.stringify(input.detail) : null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function organizationAuditLog(organizationId: string, take = 500) {
  return prisma.auditLog.findMany({
    where: { targetType: "organization", targetId: organizationId },
    orderBy: { createdAt: "desc" },
    take,
  });
}