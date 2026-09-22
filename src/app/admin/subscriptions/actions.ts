"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import {
  adminOverrideSubscription,
  completeCancellation,
  reactivateSubscription,
  transitionSubscription,
} from "@/lib/billing/subscriptions";
import { getPlanById } from "@/lib/billing/plans";
import { logAdminAudit } from "@/lib/billing/audit";
import type { SubscriptionStatus } from "@/lib/billing/types";

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

function requireConfirm(formData: FormData): void {
  if (formData.get("confirm") !== "on") {
    throw new Error("Confirmation is required for this action.");
  }
}

/**
 * Apply a subscription override. `confirm` must be an explicit checkbox in the
 * form ("sensitive actions require confirmation" — nk.md §17).
 */
export async function overrideSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);

  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  const to = String(formData.get("to") ?? "") as SubscriptionStatus;
  const reason = String(formData.get("reason") ?? "");
  if (!subscriptionId) throw new Error("Subscription is required.");

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
}

/** Change the plan a subscription is billed against. Emits a plan-changed event. */
export async function changePlanAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);

  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  if (!subscriptionId || !planId) throw new Error("Subscription and plan are required.");
  const plan = await getPlanById(planId);
  if (!plan || !plan.is_active) throw new Error("Plan is not available.");

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
}

export async function reactivateSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);

  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  if (!subscriptionId) throw new Error("Subscription is required.");
  await reactivateSubscription(subscriptionId);
  await logAdminAudit({
    adminUserId: admin.id,
    action: "subscription.reactivated",
    resourceType: "subscription",
    resourceId: subscriptionId,
    ip: await auditIp(),
  });
  revalidatePath("/admin/subscriptions");
}

export async function markCanceledAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);

  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  if (!subscriptionId) throw new Error("Subscription is required.");
  await completeCancellation(subscriptionId);
  await logAdminAudit({
    adminUserId: admin.id,
    action: "subscription.canceled",
    resourceType: "subscription",
    resourceId: subscriptionId,
    ip: await auditIp(),
  });
  revalidatePath("/admin/subscriptions");
}