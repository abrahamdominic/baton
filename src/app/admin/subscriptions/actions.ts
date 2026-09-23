"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import {
  adminOverrideSubscription,
  completeCancellation,
  getSubscriptionById,
  reactivateSubscription,
  transitionSubscription,
} from "@/lib/billing/subscriptions";
import { getPlanById } from "@/lib/billing/plans";
import { logAdminAudit } from "@/lib/billing/audit";
import { validateTransition } from "@/lib/billing/subscription-machine";
import type { SubscriptionStatus } from "@/lib/billing/types";

export interface AdminSubscriptionActionResult {
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

async function auditIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function requireConfirm(formData: FormData): string | null {
  if (formData.get("confirm") !== "on") {
    return "Confirmation is required for this action.";
  }
  return null;
}

/** Guard an admin-vetoed move: never emit in an invalid transition even if the UI races. */
function invalidTransitionGuard(
  current: string | null,
  to: SubscriptionStatus,
): string | null {
  if (!current) return null;
  const invalid = validateTransition(current as SubscriptionStatus, to);
  return invalid ? `Cannot move a "${invalid.from}" subscription to "${invalid.to}".` : null;
}

function actionError(err: unknown): AdminSubscriptionActionResult {
  const message = err instanceof Error ? err.message : "Could not complete the action. Try again.";
  return { ok: false, error: message };
}

/**
 * Apply a subscription override. `confirm` must be an explicit checkbox in the
 * form ("sensitive actions require confirmation", nk.md §17).
 */
export async function overrideSubscriptionAction(
  _prev: AdminSubscriptionActionResult,
  formData: FormData,
): Promise<AdminSubscriptionActionResult> {
  try {
    const admin = await requireAdmin();
    const confirmError = requireConfirm(formData);
    if (confirmError) return { ok: false, error: confirmError };

    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    const to = String(formData.get("to") ?? "") as SubscriptionStatus;
    const reason = String(formData.get("reason") ?? "");
    if (!subscriptionId) return { ok: false, error: "Subscription is required." };
    if (!to) return { ok: false, error: "Target status is required." };

    await adminOverrideSubscription(subscriptionId, { to, reason });
    await logAdminAudit({
      adminUserId: admin.id,
      action: "subscription.override",
      resourceType: "subscription",
      resourceId: subscriptionId,
      detail: { to, reason },
      ip: await auditIp(),
    });
    revalidatePath("/admin/subscriptions");
    return { ok: true };
  } catch (err) {
    return actionError(err);
  }
}

/** Change the plan a subscription is billed against. Emits a plan-changed event. */
export async function changePlanAction(
  _prev: AdminSubscriptionActionResult,
  formData: FormData,
): Promise<AdminSubscriptionActionResult> {
  try {
    const admin = await requireAdmin();
    const confirmError = requireConfirm(formData);
    if (confirmError) return { ok: false, error: confirmError };

    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    const planId = String(formData.get("planId") ?? "");
    if (!subscriptionId || !planId) {
      return { ok: false, error: "Subscription and plan are required." };
    }
    const plan = await getPlanById(planId);
    if (!plan || !plan.is_active) {
      return { ok: false, error: "Plan is not available." };
    }

    const current = await getSubscriptionById(subscriptionId);
    if (current) {
      const illegal = invalidTransitionGuard(current.status, "active");
      if (illegal) return { ok: false, error: illegal };
    }

    await transitionSubscription(subscriptionId, {
      to: "active",
      eventType: "subscription_plan_changed",
      source: "admin",
      planId: plan.id,
      reason: `admin plan change to ${plan.slug}`,
    });
    await logAdminAudit({
      adminUserId: admin.id,
      action: "subscription.plan_changed",
      resourceType: "subscription",
      resourceId: subscriptionId,
      detail: { planId, planSlug: plan.slug },
      ip: await auditIp(),
    });
    revalidatePath("/admin/subscriptions");
    return { ok: true, detail: `Plan changed to ${plan.name}.` };
  } catch (err) {
    return actionError(err);
  }
}

export async function reactivateSubscriptionAction(
  _prev: AdminSubscriptionActionResult,
  formData: FormData,
): Promise<AdminSubscriptionActionResult> {
  try {
    const admin = await requireAdmin();
    const confirmError = requireConfirm(formData);
    if (confirmError) return { ok: false, error: confirmError };

    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    if (!subscriptionId) return { ok: false, error: "Subscription is required." };
    await reactivateSubscription(subscriptionId);
    await logAdminAudit({
      adminUserId: admin.id,
      action: "subscription.reactivated",
      resourceType: "subscription",
      resourceId: subscriptionId,
      ip: await auditIp(),
    });
    revalidatePath("/admin/subscriptions");
    return { ok: true };
  } catch (err) {
    return actionError(err);
  }
}

export async function markCanceledAction(
  _prev: AdminSubscriptionActionResult,
  formData: FormData,
): Promise<AdminSubscriptionActionResult> {
  try {
    const admin = await requireAdmin();
    const confirmError = requireConfirm(formData);
    if (confirmError) return { ok: false, error: confirmError };

    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    if (!subscriptionId) return { ok: false, error: "Subscription is required." };
    await completeCancellation(subscriptionId);
    await logAdminAudit({
      adminUserId: admin.id,
      action: "subscription.canceled",
      resourceType: "subscription",
      resourceId: subscriptionId,
      ip: await auditIp(),
    });
    revalidatePath("/admin/subscriptions");
    return { ok: true };
  } catch (err) {
    return actionError(err);
  }
}