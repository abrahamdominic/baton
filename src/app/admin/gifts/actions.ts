"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createGiftedAccess, GIFT_MAX_MONTHS, GIFT_MIN_MONTHS } from "@/lib/billing/gifts";

export interface GiftActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

async function requireAdmin() {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required.");
  if (user.role !== "admin" || user.suspendedAt) throw new Error("Unauthorized.");
  return user;
}

/**
 * Gift a paid plan to a user (audited, no money moves). The form passes a
 * normalised `months` value and the `durationType` label; the server re-validates
 * both bounds and the user/plan anyway and records everything in gift_grants,
 * subscription_events, and audit_logs.
 */
export async function giftPlanAction(
  _prev: GiftActionResult,
  formData: FormData,
): Promise<GiftActionResult> {
  try {
    const admin = await requireAdmin();
    if (formData.get("confirm") !== "on") {
      return { ok: false, error: "You must confirm the gift before granting paid access." };
    }

    const userId = String(formData.get("userId") ?? "");
    const planId = String(formData.get("planId") ?? "");
    const durationType = formData.get("durationType") === "annual" ? "annual" : "monthly";
    const months = Number(formData.get("months") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    if (!userId || !planId) return { ok: false, error: "A user and a plan are required." };
    if (!Number.isSafeInteger(months) || months < GIFT_MIN_MONTHS || months > GIFT_MAX_MONTHS) {
      return {
        ok: false,
        error: `Gift duration must be between ${GIFT_MIN_MONTHS} and ${GIFT_MAX_MONTHS} months.`,
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { login: true, suspendedAt: true },
    });
    if (!user) return { ok: false, error: "That user does not exist anymore." };
    if (user.suspendedAt) {
      return {
        ok: false,
        error: `@${user.login} is suspended. Unsuspend the account before gifting a plan.`,
      };
    }

    const result = await createGiftedAccess({
      adminUserId: admin.id,
      userId,
      userLogin: user.login,
      planId,
      durationType,
      months,
      note: note || undefined,
    });

    revalidatePath("/admin/gifts");
    const until = new Date(result.accessEndsAt).toISOString().slice(0, 10);
    return {
      ok: true,
      detail: `Gifted to @${user.login} until ${until}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not complete the gift. Try again.",
    };
  }
}