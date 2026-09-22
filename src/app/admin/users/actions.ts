"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required.");
  if (user.role !== "admin" || user.suspendedAt) throw new Error("Unauthorized.");
  return user;
}

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

async function writeAudit(actor: { id: string; login: string }, action: string, targetId: string, detail: string) {
  await prisma.auditLog.create({
    data: {
      actor: actor.login,
      action,
      targetType: "user",
      targetId,
      detailJson: JSON.stringify(detail),
      ...(await requestMeta()),
    },
  });
}

/** Sensitive admin actions require an explicit confirm checkbox (nk.md §17). */
function requireConfirm(formData: FormData): void {
  if (formData.get("confirm") !== "on") {
    throw new Error("Confirmation is required for this action.");
  }
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") === "admin" ? "admin" : "user";
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("User not found.");
  if (userId === admin.id && role !== "admin") throw new Error("You cannot demote your own account.");
  await prisma.user.update({ where: { id: userId }, data: { role } });
  await writeAudit(admin, "user.role.set", userId, JSON.stringify({ role, previous: target.role }));
  logger.info("admin-user-role", { actor: admin.login, userId, role });
  revalidatePath("/admin/users");
}

export async function setSuspensionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);
  const userId = String(formData.get("userId") ?? "");
  const suspended = formData.get("suspended") === "true";
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("User not found.");
  if (target.id === admin.id) throw new Error("You cannot suspend your own account.");
  await prisma.user.update({
    where: { id: userId },
    data: { suspendedAt: suspended ? new Date() : null },
  });
  if (suspended) {
    await revokeAllSessionsForUser(userId);
  }
  await writeAudit(admin, suspended ? "user.suspended" : "user.unsuspended", userId, JSON.stringify({ previous: target.suspendedAt?.toISOString() ?? null }));
  logger.info("admin-user-suspension", { actor: admin.login, userId, suspended });
  revalidatePath("/admin/users");
}