"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export interface AdminActionState {
  ok: boolean;
  error?: string;
}

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

/**
 * Sensitive admin actions require an explicit confirmation (nk.md §17). Unlike a
 * thrown error (which surfaces as a Next.js digest page), a missing confirmation
 * is a user-fixable validation condition and must be returned to the dialog.
 */
function requireConfirm(formData: FormData): { ok: boolean; error?: string } {
  if (formData.get("confirm") !== "on") {
    return { ok: false, error: "Please confirm this action before it can run." };
  }
  return { ok: true };
}

export async function setUserRoleAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const confirmed = requireConfirm(formData);
    if (!confirmed.ok) return confirmed;
    const userId = String(formData.get("userId") ?? "");
    const role = String(formData.get("role") ?? "") === "admin" ? "admin" : "user";
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: "That user account no longer exists." };
    if (userId === admin.id && role !== "admin") {
      return { ok: false, error: "You cannot demote your own account." };
    }
    await prisma.user.update({ where: { id: userId }, data: { role } });
    await writeAudit(admin, "user.role.set", userId, JSON.stringify({ role, previous: target.role }));
    logger.info("admin-user-role", { actor: admin.login, userId, role });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    logger.error("admin-user-role-failed", { error: String(err) });
    return { ok: false, error: "Could not change that user's role. Try again." };
  }
}

export async function setSuspensionAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdmin();
    const confirmed = requireConfirm(formData);
    if (!confirmed.ok) return confirmed;
    const userId = String(formData.get("userId") ?? "");
    const suspended = formData.get("suspended") === "true";
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: "That user account no longer exists." };
    if (target.id === admin.id) return { ok: false, error: "You cannot suspend your own account." };
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
    return { ok: true };
  } catch (err) {
    logger.error("admin-user-suspension-failed", { error: String(err) });
    return { ok: false, error: "Could not update that user's suspension. Try again." };
  }
}