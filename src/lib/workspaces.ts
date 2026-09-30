import "server-only";
import { prisma } from "./db";
import { STATE_META, ORDERED_STATES } from "./engine/types";
import {
  getWorkspacePaidSubscription,
  parsePlanLimits,
} from "./billing/entitlement";
import { FREE_MAX_MEMBERS } from "./billing/entitlement-core";
import { listSubscriptionsForUser } from "./billing/subscriptions";
import { currentUser, type SessionUser } from "./auth/session";
import { logger } from "./logger";
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
  seatVerdict,
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

/**
 * Revoke a departed user's access to a workspace's conversations.
 *
 * Removing someone from a team or organization deleted only the membership
 * row. The messaging actions authorize on `ConversationMember` alone, so a
 * removed member kept both read access to every message ever sent in those
 * threads and the ability to post into them — a page-level 404 is not an
 * access-control boundary, since server actions are directly callable.
 *
 * Deleting their `ConversationMember` rows closes that door. The thread key
 * itself is NOT rotated here: every member holds a copy of the same key, so
 * rotation is what stops a removed member from *replaying old plaintext* they
 * already hold, and it requires re-wrapping for the current roster from a
 * client that still holds the key. That is a deliberate, separately-reviewed
 * change, so this function revokes future access and does not pretend to
 * un-ring the bell on history the departing member was authorized to read.
 */
/** Minimal Prisma surface both helpers need, so either can join a transaction. */
export type WorkspaceDb = Pick<
  typeof prisma,
  "conversationMember" | "teamMember" | "organizationMember"
>;

export async function revokeWorkspaceConversations(
  kind: "team" | "organization",
  workspaceId: string,
  userId: string,
  db: WorkspaceDb = prisma,
): Promise<number> {
  const scope =
    kind === "team" ? { teamId: workspaceId } : { orgId: workspaceId };
  const { count } = await db.conversationMember.deleteMany({
    where: { userId, conversation: scope },
  });
  return count;
}

/**
 * Re-assert live workspace membership for a conversation participant.
 *
 * Conversation membership is the primary guard for message actions, but it is
 * a *derived* grant: it is only ever supposed to exist while the person is
 * still on the team or organization. A member row that outlives the workspace
 * membership (legacy rows, a partially-applied removal) must not confer
 * access, so conversation actions call this before acting.
 *
 * A query error is treated as "not a member" so a database fault can never
 * widen access.
 */
export async function isStillWorkspaceMember(
  kind: "team" | "organization",
  workspaceId: string,
  userId: string,
  db: WorkspaceDb = prisma,
): Promise<boolean> {
  const row =
    kind === "team"
      ? await db.teamMember
          .findUnique({
            where: { teamId_userId: { teamId: workspaceId, userId } },
            select: { id: true },
          })
          .catch(() => null)
      : await db.organizationMember
          .findUnique({
            where: {
              organizationId_userId: { organizationId: workspaceId, userId },
            },
            select: { id: true },
          })
          .catch(() => null);
  return row !== null;
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

export interface WorkspaceCap {
  /**
   * Seats the workspace may fill *beyond its owner*.
   *
   * The owner is not a seat. The owner is the workspace: they are necessarily a
   * member by construction, and counting them against the cap made a cap of 0
   * (the free tier, which sells no seats) compare as `1 >= 0` and reject every
   * invite unconditionally.
   */
  cap: number;
  planName: string;
  /**
   * True when the plan could not be read at all.
   *
   * This is deliberately not the same as "no seats". A Supabase outage makes
   * `getWorkspacePaidSubscription` fail closed to `null`, which previously
   * surfaced to the user as a confident "you are on the Free plan" message while
   * they were in fact paying for seats. Callers must treat this as unknown and
   * must not invent a limit from it.
   */
  lookupFailed: boolean;
}

/**
 * Member ceiling for a workspace, derived from the workspace owner's live
 * paid subscription (the workspace plan), never from a member's personal plan.
 *
 * A workspace with no paid plan gets the free allowance (`FREE_MAX_MEMBERS`),
 * not zero. At zero the "this plan has no seats" answer and the broken cap check
 * were indistinguishable, and both reached the user as the same opaque server
 * error, so a free workspace could never invite anybody at all.
 */
export async function workspaceMemberCap(
  kind: "team" | "organization",
  workspaceId: string,
): Promise<WorkspaceCap> {
  const ownerId = await workspaceOwnerId(kind, workspaceId);
  if (!ownerId)
    return { cap: FREE_MAX_MEMBERS, planName: "Free", lookupFailed: false };
  const sub = await getWorkspacePaidSubscription(ownerId);
  if (!sub) {
    // `getWorkspacePaidSubscription` returns null for "genuinely free" and for
    // "could not tell" alike. Distinguish them by asking for the evidence.
    return {
      cap: FREE_MAX_MEMBERS,
      planName: "Free",
      lookupFailed: await workspacePlanLookupFailed(ownerId),
    };
  }
  const plan = sub.plan;
  if (!plan)
    return { cap: FREE_MAX_MEMBERS, planName: "Free", lookupFailed: false };
  const limits = parsePlanLimits(plan.limits);
  return {
    cap: limits.maxMembers ?? 0,
    planName: plan.name,
    lookupFailed: false,
  };
}

/**
 * Did the plan lookup fail, or is the owner genuinely on the free tier?
 *
 * Used only to keep a billing outage from masquerading as a free plan. If this
 * check itself cannot run we assume the plan is real, because blocking a paying
 * customer's invite on a second failure is the worse failure.
 */
async function workspacePlanLookupFailed(ownerId: string): Promise<boolean> {
  try {
    // `listSubscriptionsForUser` throws on a Supabase error and resolves to an
    // array otherwise, so reaching the return means the ledger is readable.
    await listSubscriptionsForUser(ownerId);
    return false;
  } catch {
    logger.warn("workspace-cap-plan-lookup-failed", { ownerId });
    return true;
  }
}

export type MembershipCheck =
  | { ok: true; role: WorkspaceRole }
  | { ok: false; code: "not_a_member" | "not_an_admin" | "not_an_owner" };

/**
 * Non-throwing membership check.
 *
 * `requireTeamMember` throws, which is right for internal invariants but wrong
 * for a user-facing form: a rejected promise loses its message crossing the
 * server/client boundary in production, so "you are not an admin" and "your plan
 * has no seats" reach the browser as the same opaque server error.
 */
export async function requireTeamMemberSafe(
  teamId: string,
  userId: string,
  minRole?: WorkspaceRole,
): Promise<MembershipCheck> {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { id: true, role: true },
  });
  if (!member) return { ok: false, code: "not_a_member" };
  const role = member.role as WorkspaceRole;
  if (minRole === "owner" && role !== "owner")
    return { ok: false, code: "not_an_owner" };
  if (minRole === "admin" && role !== "owner" && role !== "admin") {
    return { ok: false, code: "not_an_admin" };
  }
  return { ok: true, role };
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

/** Non-throwing org membership check; see `requireTeamMemberSafe`. */
export async function requireOrganizationMemberSafe(
  organizationId: string,
  userId: string,
  minRole?: WorkspaceRole,
): Promise<MembershipCheck> {
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, role: true },
  });
  if (!member) return { ok: false, code: "not_a_member" };
  const role = member.role as WorkspaceRole;
  if (minRole === "owner" && role !== "owner")
    return { ok: false, code: "not_an_owner" };
  if (minRole === "admin" && role !== "owner" && role !== "admin") {
    return { ok: false, code: "not_an_admin" };
  }
  return { ok: true, role };
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

export async function listUserTeams(
  userId: string,
): Promise<WorkspaceSummary[]> {
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
    const role =
      (t.members.find((m) => m.userId === userId)?.role as WorkspaceRole) ??
      "member";
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

export async function listUserOrganizations(
  userId: string,
): Promise<WorkspaceSummary[]> {
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
    const role =
      (o.members.find((m) => m.userId === userId)?.role as WorkspaceRole) ??
      "member";
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
    where: {
      githubLogin: normalizeLogin(login),
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          owner: { select: { login: true } },
        },
      },
      invitedBy: { select: { login: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

export async function pendingOrgInvites(login: string) {
  return prisma.organizationInvite.findMany({
    where: {
      githubLogin: normalizeLogin(login),
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          owner: { select: { login: true } },
        },
      },
      invitedBy: { select: { login: true } },
    },
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
): Promise<{
  installAccounts: string[];
  repos: { id: string; owner: string; name: string; enabled: boolean }[];
  items: WorkspaceBoardItem[];
}> {
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

  const installAccounts = [
    ...new Set(links.map((l) => l.installation.accountLogin)),
  ];
  const repos = links.flatMap((l) =>
    l.installation.repos.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      enabled: r.enabled,
    })),
  );
  const repoIds = repos.map((r) => r.id);

  if (repoIds.length === 0) return { installAccounts, repos, items: [] };

  const now = Date.now();
  const prs = await prisma.pullRequest.findMany({
    where: { repoId: { in: repoIds }, githubState: "OPEN", isDraft: false },
    include: { repo: true },
  });

  const actionableOrder = (state: string) => {
    const idx = ORDERED_STATES.indexOf(
      state as (typeof ORDERED_STATES)[number],
    );
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
      stateLabel:
        STATE_META[pr.state as keyof typeof STATE_META]?.label ?? "Unknown",
      stateTone:
        STATE_META[pr.state as keyof typeof STATE_META]?.tone ?? "neutral",
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
    // The actor's GitHub handle is resolved by the same JOIN for every row, so
    // the audit ledger and its CSV/JSON export can show `@handle` next to the id
    // without an extra query per event.
    include: {
      user: {
        select: {
          id: true,
          login: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });
}
