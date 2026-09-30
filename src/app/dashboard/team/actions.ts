"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getEntitlement,
  hasFeature,
  FEATURE_KEYS,
} from "@/lib/billing/entitlement";
import { myInstallations } from "@/lib/queries/dashboard";
import {
  generateInviteToken,
  INVITE_TTL_MS,
  isGitHubLogin,
  isValidSlug,
  normalizeLogin,
  requireActiveUser,
  seatVerdict,
  requireTeamMember,
  requireTeamMemberSafe,
  revokeWorkspaceConversations,
  slugFromName,
  workspaceMemberCap,
  type WorkspaceRole,
} from "@/lib/workspaces";
import { verifyGitHubUserExists } from "@/lib/github/user-lookup";

/**
 * Team workspace operations. Every mutation:
 *  1. resolves the signed-in user server-side,
 *  2. enforces membership + role requirements,
 *  3. validates workspace-plan entitlement + member caps,
 *  4. and touches only rows the caller is allowed to manage.
 */

async function auditedTeamAction(
  teamId: string,
  userId: string,
  actor: string,
  action: string,
  detail?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      userId,
      actor,
      action,
      targetType: "team",
      targetId: teamId,
      detailJson: detail ? JSON.stringify(detail) : null,
    },
  });
}

function revalidateTeam(teamId: string) {
  revalidatePath("/dashboard/team");
  revalidatePath(`/dashboard/team/${teamId}`);
  revalidatePath(`/dashboard/team/${teamId}/board`);
  revalidatePath("/dashboard/settings");
}

const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Team name is required").max(60),
  slug: z
    .string()
    .trim()
    .max(48)
    .refine(
      (s) => s === "" || isValidSlug(s),
      "Slug may only contain lowercase letters, numbers and dashes.",
    ),
});

export async function createTeam(
  input: z.infer<typeof createTeamSchema>,
): Promise<{ id: string }> {
  const user = await requireActiveUser();

  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "invalid team");

  const entitlement = await getEntitlement(user.id);
  if (
    user.role !== "admin" &&
    !hasFeature(entitlement, FEATURE_KEYS.teamWorkspace)
  ) {
    throw new Error(
      "Team workspaces require a paid Team or Organization plan. Upgrade from /dashboard/billing to unlock shared team boards.",
    );
  }

  const name = parsed.data.name;
  const slug = parsed.data.slug || slugFromName(name, generateInviteToken());

  const team = await prisma.team.create({
    data: {
      slug,
      name,
      ownerId: user.id,
      members: {
        create: { userId: user.id, role: "owner" },
      },
    },
    select: { id: true },
  });

  await auditedTeamAction(team.id, user.id, user.login, "team.created", {
    name,
    slug,
  });
  revalidatePath("/dashboard/team");
  return { id: team.id };
}

const updateTeamSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1, "Team name is required").max(60),
  slug: z
    .string()
    .trim()
    .max(48)
    .refine(
      (s) => s === "" || isValidSlug(s),
      "Slug may only contain lowercase letters, numbers and dashes.",
    ),
});

export async function updateTeam(
  input: z.infer<typeof updateTeamSchema>,
): Promise<void> {
  const user = await requireActiveUser();
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "invalid team");
  await requireTeamMember(parsed.data.teamId, user.id, "admin");

  const slug = parsed.data.slug || undefined;
  await prisma.team.update({
    where: { id: parsed.data.teamId },
    data: {
      name: parsed.data.name,
      ...(slug ? { slug } : {}),
    },
  });

  await auditedTeamAction(
    parsed.data.teamId,
    user.id,
    user.login,
    "team.updated",
    {
      name: parsed.data.name,
      slug,
    },
  );
  revalidateTeam(parsed.data.teamId);
}

const inviteSchema = z.object({
  teamId: z.string().min(1),
  githubLogin: z.string().trim().min(1, "GitHub login is required"),
  role: z.enum(["admin", "member"]),
});

/**
 * Outcome of an invite attempt.
 *
 * Returning a discriminated result instead of throwing is the fix for the
 * reported "An error occurred in the Server Components render" failure. Next.js
 * replaces a thrown action's message with generic production text, so a
 * rejected promise is indistinguishable to the user from a crash -- a business
 * rule ("your plan has no seats") was arriving as an opaque server error. A
 * returned value crosses the server/client boundary intact, which lets the UI
 * say the true thing and link to the place that fixes it.
 */
export type InviteOutcome =
  | { ok: true; login: string }
  | {
      ok: false;
      code:
        | "invalid_login"
        | "self_invite"
        | "not_a_member"
        | "not_an_admin"
        | "no_seats"
        | "plan_unavailable"
        | "already_member"
        | "already_invited"
        | "github_user_not_found";
      /** Safe to render. Never contains a token, query, or stack. */
      detail?: string;
      planName?: string;
    };

export async function inviteTeamMember(
  input: z.infer<typeof inviteSchema>,
): Promise<InviteOutcome> {
  const user = await requireActiveUser();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_login",
      detail: "Enter a GitHub username.",
    };
  }

  const login = normalizeLogin(parsed.data.githubLogin);
  if (!isGitHubLogin(login)) {
    return { ok: false, code: "invalid_login" };
  }
  if (login === normalizeLogin(user.login)) {
    return { ok: false, code: "self_invite" };
  }

  const membership = await requireTeamMemberSafe(
    parsed.data.teamId,
    user.id,
    "admin",
  );
  if (!membership.ok) {
    return {
      ok: false,
      // `not_an_owner` is unreachable for a minRole of "admin", but mapping it
      // to the permission code keeps this total if that call ever changes.
      code:
        membership.code === "not_an_owner" ? "not_an_admin" : membership.code,
    };
  }

  // The owner is not a seat. Counting them made a 0-seat (free) workspace
  // compare as `1 >= 0` and reject every invite, and made a paid workspace
  // silently one seat short of the plan it was sold.
  const {
    cap: memberCap,
    planName,
    lookupFailed,
  } = await workspaceMemberCap("team", parsed.data.teamId);
  if (lookupFailed) {
    // Refuse rather than guess: allowing the invite could oversell seats, and
    // blocking it with a "Free plan" message would blame the customer for our
    // outage.
    return { ok: false, code: "plan_unavailable" };
  }

  // One read answers three questions: how many non-owner seats are taken,
  // whether this person is already in the room, and (implicitly) that the
  // owner's own seat is excluded from the cap.
  //
  // The login comparison is done in JS rather than with
  // `mode: "insensitive"`, which PostgreSQL supports and SQLite does not, so
  // the identical query has to work against both providers. GitHub logins are
  // case-insensitive but not stored in one canonical case, so a plain `equals`
  // would let "@DConco" bypass the already-a-member check.
  const [members, pendingCount] = await Promise.all([
    prisma.teamMember.findMany({
      where: { teamId: parsed.data.teamId },
      select: { role: true, user: { select: { login: true } } },
    }),
    prisma.teamInvite.count({
      where: { teamId: parsed.data.teamId, status: "pending" },
    }),
  ]);
  const alreadyMember = members.some(
    (m) => normalizeLogin(m.user.login) === login,
  );
  if (alreadyMember) {
    return { ok: false, code: "already_member" };
  }
  const memberCount = members.filter((m) => m.role !== "owner").length;
  if (
    seatVerdict({ memberCount, pendingCount, cap: memberCap }) === "no_seats"
  ) {
    return { ok: false, code: "no_seats", planName };
  }

  // Confirm the account exists before writing an invite nobody can accept.
  // Only a 404 is treated as "not found"; a GitHub outage must not block
  // invitations, so an inconclusive check allows the invite through.
  const check = await verifyGitHubUserExists(user, login);
  if (!check.ok && check.reason === "not_found") {
    return { ok: false, code: "github_user_not_found" };
  }

  const existing = await prisma.teamInvite.findUnique({
    where: {
      teamId_githubLogin: { teamId: parsed.data.teamId, githubLogin: login },
    },
  });
  if (existing && existing.status === "pending") {
    return { ok: false, code: "already_invited" };
  }

  await prisma.teamInvite.upsert({
    where: {
      teamId_githubLogin: { teamId: parsed.data.teamId, githubLogin: login },
    },
    create: {
      teamId: parsed.data.teamId,
      githubLogin: login,
      role: parsed.data.role,
      token: generateInviteToken(),
      invitedById: user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    update: {
      role: parsed.data.role,
      token: generateInviteToken(),
      invitedById: user.id,
      status: "pending",
      acceptedByUserId: null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  await auditedTeamAction(
    parsed.data.teamId,
    user.id,
    user.login,
    "team.member_invited",
    {
      githubLogin: login,
      role: parsed.data.role,
    },
  );
  revalidateTeam(parsed.data.teamId);
  return { ok: true, login };
}

/** Accept a pending invite that is addressed to the signed-in user's login. */
export async function acceptTeamInvite(teamId: string): Promise<void> {
  const user = await requireActiveUser();

  const invite = await prisma.teamInvite.findUnique({
    where: {
      teamId_githubLogin: { teamId, githubLogin: normalizeLogin(user.login) },
    },
  });
  if (!invite || invite.status !== "pending")
    throw new Error("No pending invite for this team.");
  if (invite.expiresAt.getTime() <= Date.now())
    throw new Error("This invite has expired.");

  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
  });
  if (!existing) {
    const { cap: memberCap, planName } = await workspaceMemberCap(
      "team",
      teamId,
    );
    const memberCount = await prisma.teamMember.count({ where: { teamId } });
    if (memberCount >= memberCap) {
      throw new Error(
        `This workspace is at its ${memberCap}-member limit on the ${planName} plan. Contact an admin to raise the limit.`,
      );
    }
    await prisma.teamMember.create({
      data: { teamId, userId: user.id, role: invite.role },
    });
  }
  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { status: "accepted", acceptedByUserId: user.id },
  });

  await auditedTeamAction(teamId, user.id, user.login, "team.invite_accepted");
  revalidateTeam(teamId);
}

export async function declineTeamInvite(teamId: string): Promise<void> {
  const user = await requireActiveUser();
  await prisma.teamInvite.updateMany({
    where: {
      teamId,
      githubLogin: normalizeLogin(user.login),
      status: "pending",
    },
    data: { status: "revoked" },
  });
  revalidatePath("/dashboard/team");
}

export async function revokeTeamInvite(
  teamId: string,
  githubLogin: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "admin");
  const res = await prisma.teamInvite.updateMany({
    where: {
      teamId,
      githubLogin: normalizeLogin(githubLogin),
      status: "pending",
    },
    data: { status: "revoked" },
  });
  if (res.count === 0) throw new Error("Pending invite not found.");
  await auditedTeamAction(teamId, user.id, user.login, "team.invite_revoked", {
    githubLogin,
  });
  revalidateTeam(teamId);
}

export async function removeTeamMember(
  teamId: string,
  userIdToRemove: string,
): Promise<void> {
  const user = await requireActiveUser();
  const actorRole = await requireTeamMember(teamId, user.id, "admin");
  if (userIdToRemove === user.id)
    throw new Error("Use the leave action for your own membership.");

  const target = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: userIdToRemove } },
  });
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner")
    throw new Error("The owner cannot be removed. Transfer ownership first.");

  // Deleting the membership row is not enough: conversation access is authorized
  // separately, so a removed member would otherwise keep reading and posting in
  // this team's threads. Both writes share one transaction so a failure cannot
  // leave the membership gone but the conversation grants intact.
  const revokedConversations = await prisma.$transaction(async (tx) => {
    await tx.teamMember.delete({
      where: { teamId_userId: { teamId, userId: userIdToRemove } },
    });
    return revokeWorkspaceConversations("team", teamId, userIdToRemove, tx);
  });
  await auditedTeamAction(teamId, user.id, user.login, "team.member_removed", {
    removedUserId: userIdToRemove,
    actorRole: actorRole.role,
    revokedConversations,
  });
  revalidateTeam(teamId);
}

export async function leaveTeam(teamId: string): Promise<void> {
  const user = await requireActiveUser();
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
  });
  if (!member) throw new Error("You are not a member of this team.");
  if (member.role === "owner") {
    const others = await prisma.teamMember.count({
      where: { teamId, userId: { not: user.id } },
    });
    if (others === 0) {
      throw new Error(
        "Transfer ownership or delete the team before leaving." +
          " You are the only member.",
      );
    }
    throw new Error(
      "As the owner, transfer ownership to another member before leaving.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.delete({
      where: { teamId_userId: { teamId, userId: user.id } },
    });
    await revokeWorkspaceConversations("team", teamId, user.id, tx);
  });
  revalidateTeam(teamId);
}

export async function setTeamMemberRole(
  teamId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "admin");
  if (!["admin", "member"].includes(role)) {
    throw new Error("Invalid role. Only admin and member are assignable.");
  }
  const target = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner")
    throw new Error("The owner keeps the owner role.");

  await prisma.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role },
  });
  await auditedTeamAction(teamId, user.id, user.login, "team.role_changed", {
    targetUserId: userId,
    role,
  });
  revalidateTeam(teamId);
}

export async function transferTeamOwnership(
  teamId: string,
  newOwnerUserId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "owner");

  const target = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: newOwnerUserId } },
  });
  if (!target) throw new Error("The new owner must already be a member.");

  await prisma.$transaction([
    prisma.team.update({
      where: { id: teamId },
      data: { ownerId: newOwnerUserId },
    }),
    prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: user.id } },
      data: { role: "admin" },
    }),
    prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: newOwnerUserId } },
      data: { role: "owner" },
    }),
  ]);

  await auditedTeamAction(
    teamId,
    user.id,
    user.login,
    "team.ownership_transferred",
    {
      newOwnerUserId,
    },
  );
  revalidateTeam(teamId);
}

export async function addInstallationToTeam(
  teamId: string,
  installationId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "admin");

  const mine = await myInstallations(user, { allRepos: true });
  const owned = mine.find((i) => i.id === installationId);
  if (!owned)
    throw new Error(
      "That GitHub installation does not belong to your account.",
    );

  const existingTeam = await prisma.teamInstallation.findUnique({
    where: { installationId },
  });
  const existingOrg = await prisma.organizationInstallation.findUnique({
    where: { installationId },
  });
  if (existingTeam || existingOrg) {
    throw new Error("This GitHub account is already shared in a workspace.");
  }

  await prisma.teamInstallation.create({
    data: { teamId, installationId, addedById: user.id },
  });
  await auditedTeamAction(
    teamId,
    user.id,
    user.login,
    "team.installation_added",
    {
      installationId,
      account: owned.accountLogin,
    },
  );
  revalidateTeam(teamId);
}

export async function removeInstallationFromTeam(
  teamId: string,
  installationId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "admin");
  const res = await prisma.teamInstallation.deleteMany({
    where: { teamId, installationId },
  });
  if (res.count === 0) throw new Error("Shared installation not found.");
  await auditedTeamAction(
    teamId,
    user.id,
    user.login,
    "team.installation_removed",
    { installationId },
  );
  revalidateTeam(teamId);
}

export async function deleteTeam(teamId: string): Promise<void> {
  const user = await requireActiveUser();
  await requireTeamMember(teamId, user.id, "owner");
  await prisma.$transaction([
    prisma.auditLog.deleteMany({
      where: { targetType: "team", targetId: teamId },
    }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);
  revalidatePath("/dashboard/team");
}
