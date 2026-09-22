"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentUser, readSessionCookie, hashToken } from "@/lib/auth/session";
import { enqueuePrRefresh } from "@/lib/engine/jobs";
import { myInstallations } from "@/lib/queries/dashboard";
import { logger } from "@/lib/logger";

/** Tenant check: does this repo belong to the signed-in user's installations? */
async function assertRepoAccess(repoId: string): Promise<{ repoId: string }> {
  const user = await currentUser();
  if (!user) throw new Error("sign-in required");
  const installations = await myInstallations(user);
  const owned = installations.some((i) => i.repos.some((r) => r.id === repoId));
  if (!owned) throw new Error("not your repo");
  return { repoId };
}

export async function setRepoEnabled(repoId: string, enabled: boolean): Promise<void> {
  await assertRepoAccess(repoId);
  await prisma.repo.update({ where: { id: repoId }, data: { enabled } });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/repos");
}

const settingsSchema = z.object({
  repoId: z.string().min(1),
  statusCommentEnabled: z.boolean(),
  labelsEnabled: z.boolean(),
  nudgesEnabled: z.boolean(),
  firstResponseHours: z.coerce.number().int().min(1).max(720),
  reviewFollowUpHours: z.coerce.number().int().min(1).max(720),
  changesRequiredHours: z.coerce.number().int().min(1).max(720),
  ciFailHours: z.coerce.number().int().min(1).max(720),
  conflictHours: z.coerce.number().int().min(1).max(720),
  readyToMergeHours: z.coerce.number().int().min(1).max(720),
  maxNudgesPerState: z.coerce.number().int().min(0).max(10),
});

export async function updateRepoSettings(input: z.infer<typeof settingsSchema>): Promise<void> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid settings");
  await assertRepoAccess(parsed.data.repoId);
  const { repoId, ...data } = parsed.data;
  await prisma.repoSetting.update({
    where: { repoId },
    data,
  });
  revalidatePath("/dashboard/repos");
  revalidatePath("/dashboard");
}

export async function rescanRepo(fullName: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("sign-in required");
  const installations = await myInstallations(user);
  const match = installations.flatMap((i) =>
    i.repos
      .filter((r) => r.fullName === fullName)
      .map((r) => ({ repo: r, installationId: i.installationId })),
  )[0];
  if (!match) throw new Error("not your repo");
  const prs = await prisma.pullRequest.findMany({
    where: { repoId: match.repo.id, githubState: "OPEN" },
    select: { number: true },
  });
  for (const pr of prs) {
    await enqueuePrRefresh(match.installationId, match.repo.owner, match.repo.name, pr.number);
  }
  logger.info("repo-rescanned", { repo: fullName, prs: prs.length });
  revalidatePath("/dashboard/repos");
}

// ---------------------------------------------------------------------------
// Account admin: session revocation (settings page)
// ---------------------------------------------------------------------------

/** Revoke one of the user's own sessions. The current session is handled by
 * regular sign-out; revoking it here would just log the user out mid-action. */
export async function revokeSessionById(sessionId: string): Promise<{ revoked: boolean }> {
  const user = await currentUser();
  if (!user) throw new Error("sign-in required");
  const currentToken = await readSessionCookie();
  const currentHash = currentToken ? hashToken(currentToken) : null;

  const target = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { tokenHash: true, userId: true },
  });
  if (!target || target.userId !== user.id) throw new Error("not your session");
  if (currentHash && target.tokenHash === currentHash) {
    return { revoked: false };
  }
  const res = await prisma.session.deleteMany({
    where: { id: sessionId, userId: user.id },
  });
  if (res.count > 0) {
    logger.info("session-revoked", { actor: user.login, sessionId });
    revalidatePath("/dashboard/settings");
  }
  return { revoked: res.count > 0 };
}

/** Sign out of every session except the current one. */
export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  const user = await currentUser();
  if (!user) throw new Error("sign-in required");
  const currentToken = await readSessionCookie();
  const currentHash = currentToken ? hashToken(currentToken) : null;

  const res = await prisma.session.deleteMany({
    where: {
      userId: user.id,
      ...(currentHash ? { NOT: { tokenHash: currentHash } } : {}),
    },
  });
  logger.info("sessions-revoked-others", { actor: user.login, count: res.count });
  revalidatePath("/dashboard/settings");
  return { revoked: res.count };
}