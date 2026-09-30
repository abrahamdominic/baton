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
  requireOrganizationMember,
  requireOrganizationMemberSafe,
  revokeWorkspaceConversations,
  slugFromName,
  recordOrgAudit,
  workspaceMemberCap,
  type WorkspaceRole,
} from "@/lib/workspaces";
import { verifyGitHubUserExists } from "@/lib/github/user-lookup";

/**
 * Organization workspace operations. Same authorization shape as teams, plus
 * the organization-wide review stall policy and the org-scoped audit trail.
 */

function revalidateOrg(organizationId: string) {
  revalidatePath("/dashboard/organization");
  revalidatePath(`/dashboard/organization/${organizationId}`);
  revalidatePath(`/dashboard/organization/${organizationId}/board`);
  revalidatePath("/dashboard/settings");
}

const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(60),
  slug: z
    .string()
    .trim()
    .max(48)
    .refine(
      (s) => s === "" || isValidSlug(s),
      "Slug may only contain lowercase letters, numbers and dashes.",
    ),
});

export async function createOrganization(
  input: z.infer<typeof createOrgSchema>,
): Promise<{ id: string }> {
  const user = await requireActiveUser();

  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "invalid organization");

  const entitlement = await getEntitlement(user.id);
  if (
    user.role !== "admin" &&
    !hasFeature(entitlement, FEATURE_KEYS.organizationWorkspace)
  ) {
    throw new Error(
      "Organization workspaces require the paid Organization plan. Upgrade from /dashboard/billing to unlock organization control.",
    );
  }

  const name = parsed.data.name;
  const slug = parsed.data.slug || slugFromName(name, generateInviteToken());

  const org = await prisma.organization.create({
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

  await recordOrgAudit({
    organizationId: org.id,
    userId: user.id,
    actor: user.login,
    action: "organization.created",
    detail: { name, slug },
  });
  revalidatePath("/dashboard/organization");
  return { id: org.id };
}

export async function updateOrganization(input: {
  organizationId: string;
  name: string;
  slug: string;
}): Promise<void> {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      organizationId: z.string().min(1),
      name: z.string().trim().min(1, "Organization name is required").max(60),
      slug: z
        .string()
        .trim()
        .max(48)
        .refine(
          (s) => s === "" || isValidSlug(s),
          "Slug may only contain lowercase letters, numbers and dashes.",
        ),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "invalid organization");
  await requireOrganizationMember(parsed.data.organizationId, user.id, "admin");

  const slug = parsed.data.slug || undefined;
  await prisma.organization.update({
    where: { id: parsed.data.organizationId },
    data: { name: parsed.data.name, ...(slug ? { slug } : {}) },
  });
  await recordOrgAudit({
    organizationId: parsed.data.organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.updated",
    detail: { name: parsed.data.name, slug },
  });
  revalidateOrg(parsed.data.organizationId);
}

/** See the identical type on team/actions.ts for why invites return, not throw. */
export type OrgInviteOutcome =
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
      detail?: string;
      planName?: string;
    };

export async function inviteOrgMember(input: {
  organizationId: string;
  githubLogin: string;
  role: "admin" | "member";
}): Promise<OrgInviteOutcome> {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      organizationId: z.string().min(1),
      githubLogin: z.string().trim().min(1),
      role: z.enum(["admin", "member"]),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_login",
      detail: "Enter a GitHub username.",
    };
  }

  const login = normalizeLogin(parsed.data.githubLogin);
  if (!isGitHubLogin(login)) return { ok: false, code: "invalid_login" };
  if (login === normalizeLogin(user.login))
    return { ok: false, code: "self_invite" };

  const membership = await requireOrganizationMemberSafe(
    parsed.data.organizationId,
    user.id,
    "admin",
  );
  if (!membership.ok) {
    return {
      ok: false,
      code:
        membership.code === "not_an_owner" ? "not_an_admin" : membership.code,
    };
  }

  // The owner is not a seat; see the identical fix in team/actions.ts.
  const {
    cap: memberCap,
    planName,
    lookupFailed,
  } = await workspaceMemberCap("organization", parsed.data.organizationId);
  if (lookupFailed) return { ok: false, code: "plan_unavailable" };

  // One read, provider-agnostic login matching; see team/actions.ts.
  const [members, pendingCount] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: parsed.data.organizationId },
      select: { role: true, user: { select: { login: true } } },
    }),
    prisma.organizationInvite.count({
      where: { organizationId: parsed.data.organizationId, status: "pending" },
    }),
  ]);
  const alreadyMember = members.some(
    (m) => normalizeLogin(m.user.login) === login,
  );
  if (alreadyMember) return { ok: false, code: "already_member" };
  const memberCount = members.filter((m) => m.role !== "owner").length;
  if (
    seatVerdict({ memberCount, pendingCount, cap: memberCap }) === "no_seats"
  ) {
    return { ok: false, code: "no_seats", planName };
  }

  // Only a 404 counts as "no such user"; a GitHub outage must not block invites.
  const check = await verifyGitHubUserExists(user, login);
  if (!check.ok && check.reason === "not_found") {
    return { ok: false, code: "github_user_not_found" };
  }

  const existing = await prisma.organizationInvite.findUnique({
    where: {
      organizationId_githubLogin: {
        organizationId: parsed.data.organizationId,
        githubLogin: login,
      },
    },
  });
  if (existing && existing.status === "pending") {
    return { ok: false, code: "already_invited" };
  }

  await prisma.organizationInvite.upsert({
    where: {
      organizationId_githubLogin: {
        organizationId: parsed.data.organizationId,
        githubLogin: login,
      },
    },
    create: {
      organizationId: parsed.data.organizationId,
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

  await recordOrgAudit({
    organizationId: parsed.data.organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.member_invited",
    detail: { githubLogin: login, role: parsed.data.role },
  });
  revalidateOrg(parsed.data.organizationId);
  return { ok: true, login };
}

export async function acceptOrgInvite(organizationId: string): Promise<void> {
  const user = await requireActiveUser();

  const invite = await prisma.organizationInvite.findUnique({
    where: {
      organizationId_githubLogin: {
        organizationId,
        githubLogin: normalizeLogin(user.login),
      },
    },
  });
  if (!invite || invite.status !== "pending")
    throw new Error("No pending invite for this organization.");
  if (invite.expiresAt.getTime() <= Date.now())
    throw new Error("This invite has expired.");

  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
  });
  if (!existing) {
    const { cap: memberCap, planName } = await workspaceMemberCap(
      "organization",
      organizationId,
    );
    const memberCount = await prisma.organizationMember.count({
      where: { organizationId },
    });
    if (memberCount >= memberCap) {
      throw new Error(
        `This workspace is at its ${memberCap}-member limit on the ${planName} plan. Contact an admin to raise the limit.`,
      );
    }
    await prisma.organizationMember.create({
      data: { organizationId, userId: user.id, role: invite.role },
    });
  }
  await prisma.organizationInvite.update({
    where: { id: invite.id },
    data: { status: "accepted", acceptedByUserId: user.id },
  });

  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.invite_accepted",
  });
  revalidateOrg(organizationId);
}

export async function declineOrgInvite(organizationId: string): Promise<void> {
  const user = await requireActiveUser();
  await prisma.organizationInvite.updateMany({
    where: {
      organizationId,
      githubLogin: normalizeLogin(user.login),
      status: "pending",
    },
    data: { status: "revoked" },
  });
  revalidatePath("/dashboard/organization");
}

export async function revokeOrgInvite(
  organizationId: string,
  githubLogin: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "admin");
  const res = await prisma.organizationInvite.updateMany({
    where: {
      organizationId,
      githubLogin: normalizeLogin(githubLogin),
      status: "pending",
    },
    data: { status: "revoked" },
  });
  if (res.count === 0) throw new Error("Pending invite not found.");
  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.invite_revoked",
    detail: { githubLogin },
  });
  revalidateOrg(organizationId);
}

export async function removeOrgMember(
  organizationId: string,
  userIdToRemove: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "admin");
  if (userIdToRemove === user.id)
    throw new Error("Use the leave action for your own membership.");

  const target = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: userIdToRemove },
    },
  });
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner")
    throw new Error("The owner cannot be removed. Transfer ownership first.");

  // Conversation membership authorizes messaging independently of organization
  // membership, so it must be revoked explicitly or the removed member keeps
  // full read/write access to this organization's threads. Both writes share one
  // transaction so a failure cannot leave the membership gone but the
  // conversation grants intact.
  const revokedConversations = await prisma.$transaction(async (tx) => {
    await tx.organizationMember.delete({
      where: {
        organizationId_userId: { organizationId, userId: userIdToRemove },
      },
    });
    return revokeWorkspaceConversations(
      "organization",
      organizationId,
      userIdToRemove,
      tx,
    );
  });
  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.member_removed",
    detail: { removedUserId: userIdToRemove, revokedConversations },
  });
  revalidateOrg(organizationId);
}

export async function leaveOrganization(organizationId: string): Promise<void> {
  const user = await requireActiveUser();
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
  });
  if (!member) throw new Error("You are not a member of this organization.");
  if (member.role === "owner") {
    throw new Error(
      "As the owner, transfer ownership to another member before leaving.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    await revokeWorkspaceConversations(
      "organization",
      organizationId,
      user.id,
      tx,
    );
  });
  revalidateOrg(organizationId);
}

export async function setOrgMemberRole(
  organizationId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "admin");
  if (!["admin", "member"].includes(role))
    throw new Error("Invalid role. Only admin and member are assignable.");

  const target = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner")
    throw new Error("The owner keeps the owner role.");

  await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { role },
  });
  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.role_changed",
    detail: { targetUserId: userId, role },
  });
  revalidateOrg(organizationId);
}

export async function transferOrgOwnership(
  organizationId: string,
  newOwnerUserId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "owner");

  const target = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: newOwnerUserId },
    },
  });
  if (!target) throw new Error("The new owner must already be a member.");

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organizationId },
      data: { ownerId: newOwnerUserId },
    }),
    prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      data: { role: "admin" },
    }),
    prisma.organizationMember.update({
      where: {
        organizationId_userId: { organizationId, userId: newOwnerUserId },
      },
      data: { role: "owner" },
    }),
  ]);

  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.ownership_transferred",
    detail: { newOwnerUserId },
  });
  revalidateOrg(organizationId);
}

export async function addInstallationToOrg(
  organizationId: string,
  installationId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "admin");

  const mine = await myInstallations(user, { allRepos: true });
  const owned = mine.find((i) => i.id === installationId);
  if (!owned)
    throw new Error(
      "That GitHub installation does not belong to your account.",
    );

  const existingOrg = await prisma.organizationInstallation.findUnique({
    where: { installationId },
  });
  const existingTeam = await prisma.teamInstallation.findUnique({
    where: { installationId },
  });
  if (existingOrg || existingTeam) {
    throw new Error("This GitHub account is already shared in a workspace.");
  }

  await prisma.organizationInstallation.create({
    data: { organizationId, installationId, addedById: user.id },
  });
  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.installation_added",
    detail: { installationId, account: owned.accountLogin },
  });
  revalidateOrg(organizationId);
}

export async function removeInstallationFromOrg(
  organizationId: string,
  installationId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "admin");
  const res = await prisma.organizationInstallation.deleteMany({
    where: { organizationId, installationId },
  });
  if (res.count === 0) throw new Error("Shared installation not found.");
  await recordOrgAudit({
    organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.installation_removed",
    detail: { installationId },
  });
  revalidateOrg(organizationId);
}

const CAP_MIN = 1;
const CAP_MAX = 168;

async function validatePolicyValue(v: number, label: string): Promise<number> {
  if (!Number.isInteger(v) || v < CAP_MIN || v > CAP_MAX) {
    throw new Error(
      `${label} must be a whole number of hours between ${CAP_MIN} and ${CAP_MAX}.`,
    );
  }
  return v;
}

export async function upsertOrgPolicy(input: {
  organizationId: string;
  firstResponseHours: number;
  reviewFollowUpHours: number;
  changesRequiredHours: number;
  ciFailHours: number;
  conflictHours: number;
  readyToMergeHours: number;
  maxNudgesPerState: number;
}): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(input.organizationId, user.id, "admin");

  const entitlement = await getEntitlement(user.id, {
    organizationId: input.organizationId,
  });
  if (!hasFeature(entitlement, FEATURE_KEYS.orgPolicies)) {
    throw new Error(
      "Organization-wide review stall policies require the Organization plan. Upgrade from /dashboard/billing to set org-level thresholds.",
    );
  }

  const firstResponseHours = await validatePolicyValue(
    input.firstResponseHours,
    "First response",
  );
  const reviewFollowUpHours = await validatePolicyValue(
    input.reviewFollowUpHours,
    "Re-review",
  );
  const changesRequiredHours = await validatePolicyValue(
    input.changesRequiredHours,
    "Changes required",
  );
  const ciFailHours = await validatePolicyValue(
    input.ciFailHours,
    "CI failing",
  );
  const conflictHours = await validatePolicyValue(
    input.conflictHours,
    "Merge conflicts",
  );
  const readyToMergeHours = await validatePolicyValue(
    input.readyToMergeHours,
    "Ready to merge",
  );
  const maxNudgesPerState = Math.min(
    10,
    Math.max(0, Math.round(input.maxNudgesPerState)),
  );

  const existing = await prisma.organizationPolicy.findUnique({
    where: { organizationId: input.organizationId },
  });
  const data = {
    firstResponseHours,
    reviewFollowUpHours,
    changesRequiredHours,
    ciFailHours,
    conflictHours,
    readyToMergeHours,
    maxNudgesPerState,
  };
  if (existing) {
    await prisma.organizationPolicy.update({
      where: { organizationId: input.organizationId },
      data,
    });
  } else {
    await prisma.organizationPolicy.create({
      data: { organizationId: input.organizationId, ...data },
    });
  }

  await recordOrgAudit({
    organizationId: input.organizationId,
    userId: user.id,
    actor: user.login,
    action: "organization.policy_updated",
    detail: data,
  });
  revalidateOrg(input.organizationId);
}

export async function deleteOrganization(
  organizationId: string,
): Promise<void> {
  const user = await requireActiveUser();
  await requireOrganizationMember(organizationId, user.id, "owner");
  await prisma.$transaction([
    prisma.auditLog.deleteMany({
      where: { targetType: "organization", targetId: organizationId },
    }),
    prisma.organization.delete({ where: { id: organizationId } }),
  ]);
  revalidatePath("/dashboard/organization");
}
