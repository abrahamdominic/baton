"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import { getPaymentById, verifyUsdcPaymentNow, adminVerifyPayment } from "@/lib/billing/payments";
import { logAdminAudit } from "@/lib/billing/audit";

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

/** Sensitive admin actions require an explicit confirm checkbox (nk.md §17). */
function requireConfirm(formData: FormData): void {
  if (formData.get("confirm") !== "on") {
    throw new Error("Confirmation is required for this action.");
  }
}

/** Run on-chain verification for a pending_verification USDC payment. */
export async function runVerificationAction(paymentId: string): Promise<void> {
  const admin = await requireAdmin();
  const payment = await getPaymentById(paymentId);
  if (!payment) throw new Error("Payment not found.");
  if (payment.payment_provider !== "usdc") throw new Error("Not a USDC payment.");

  const outcome = await verifyUsdcPaymentNow(paymentId);
  await logAdminAudit({
    adminUserId: admin.id,
    action: "payment.verification.triggered",
    resourceType: "payment",
    resourceId: paymentId,
    detail: { code: outcome.code, ok: outcome.ok },
    ip: await auditIp(),
  });
  revalidatePath("/admin/payments");
}

/**
 * Manual override decision for an ambiguous USDC payment (audited + recorded).
 * Changes entitlements, so it requires explicit confirmation.
 */
export async function manualDecisionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  requireConfirm(formData);
  const paymentId = String(formData.get("paymentId") ?? "");
  const decision = formData.get("decision") === "confirmed" ? "confirmed" : "rejected";
  const payment = await getPaymentById(paymentId);
  if (!payment) throw new Error("Payment not found.");
  if (payment.payment_provider !== "usdc") throw new Error("Only USDC payments support manual decisions.");

  await adminVerifyPayment({
    paymentId,
    adminUserId: admin.id,
    decision,
    note: "manual decision from admin payments page",
  });
  await logAdminAudit({
    adminUserId: admin.id,
    action: `payment.${decision}`,
    resourceType: "payment",
    resourceId: paymentId,
    detail: { decision, amount: payment.amount },
    ip: await auditIp(),
  });
  revalidatePath("/admin/payments");
}