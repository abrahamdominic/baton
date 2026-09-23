"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import { upsertPlan, getPlanById } from "@/lib/billing/plans";
import { logAdminAudit } from "@/lib/billing/audit";
import { BillingInputError } from "@/lib/billing/errors";
import { provisionPlanStripePricing } from "@/lib/billing/stripe-provisioning";
import { isStripeConfigured } from "@/lib/config";

export interface PlanActionResult {
  ok: boolean;
  error?: string;
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

interface PlanFormValues {
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number;
  annualPriceCents: number;
  priceCustom: boolean;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  featuresText: string;
  limitsText: string;
  stripeProductId: string | null;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
}

function parseForm(formData: FormData): PlanFormValues {
  const featuresText = (formData.get("features") as string) ?? "";
  return {
    slug: ((formData.get("slug") as string) ?? "").trim(),
    name: ((formData.get("name") as string) ?? "").trim(),
    description: ((formData.get("description") as string) ?? "").trim() || null,
    monthlyPriceCents: Number(formData.get("monthlyPriceCents") ?? 0),
    annualPriceCents: Number(formData.get("annualPriceCents") ?? 0),
    priceCustom: formData.get("priceCustom") === "on",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    isPublic: formData.get("isPublic") === "on" || formData.get("isPublic") === "true",
    sortOrder: Number(formData.get("sortOrder") ?? 0),
    featuresText,
    limitsText: (formData.get("limits") as string) ?? "",
    stripeProductId: ((formData.get("stripeProductId") as string) ?? "").trim() || null,
    stripeMonthlyPriceId: ((formData.get("stripeMonthlyPriceId") as string) ?? "").trim() || null,
    stripeAnnualPriceId: ((formData.get("stripeAnnualPriceId") as string) ?? "").trim() || null,
  };
}

/** Parse the optional `limits` JSON textarea into a JSONB object (aa.md §1). */
function parseLimitsText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new BillingInputError("Limits must be valid JSON. Check the syntax and try again.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BillingInputError("Limits must be a JSON object, e.g. {\"seats\": 5}.");
  }
  return parsed as Record<string, unknown>;
}

export async function savePlanAction(prev: PlanActionResult, formData: FormData): Promise<PlanActionResult> {
  try {
    const admin = await requireAdmin();
    const id = (formData.get("id") as string) || null;
    const values = parseForm(formData);
    const features = values.featuresText
      .split("\n")
      .map((f: string) => f.trim())
      .filter(Boolean);
    const limits = parseLimitsText(values.limitsText);
    const plan = await upsertPlan(id, {
      slug: values.slug,
      name: values.name,
      description: values.description,
      monthly_price_cents: values.monthlyPriceCents,
      annual_price_cents: values.annualPriceCents,
      price_custom: values.priceCustom,
      features,
      limits,
      is_active: values.isActive,
      is_public: values.isPublic,
      sort_order: values.sortOrder,
      stripe_product_id: values.stripeProductId,
      stripe_monthly_price_id: values.stripeMonthlyPriceId,
      stripe_annual_price_id: values.stripeAnnualPriceId,
    });
    await logAdminAudit({
      adminUserId: admin.id,
      action: id ? "plan.updated" : "plan.created",
      resourceType: "plan",
      resourceId: plan.id,
      detail: { slug: plan.slug, planUpdate: Boolean(id) },
      ip: await auditIp(),
    });
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof BillingInputError ? err.message : "Could not save the plan. Try again.",
    };
  }
}
/**
 * Sync Stripe catalog pricing to match the plan's configured amounts. Stripe
 * Prices are immutable, so drift (or the absence of prices) is fixed by
 * archiving stale prices and creating fresh ones at the exact DB amounts, then
 * persisting the resulting product/price IDs on the plan row.
 */
export async function syncStripePricingAction(
  _prev: PlanActionResult,
  formData: FormData,
): Promise<PlanActionResult> {
  const planId = ((formData.get("id") as string) ?? "").trim();
  if (!planId) return { ok: false, error: "Missing plan id." };
  try {
    const admin = await requireAdmin();
    if (!isStripeConfigured()) {
      return { ok: false, error: "Stripe is not configured. Add STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET first." };
    }
    const plan = await getPlanById(planId);
    if (!plan) return { ok: false, error: "Plan not found." };

    const pricing = await provisionPlanStripePricing(plan);
    await logAdminAudit({
      adminUserId: admin.id,
      action: "plan.stripe_prices_synced",
      resourceType: "plan",
      resourceId: plan.id,
      detail: {
        slug: plan.slug,
        productId: pricing.productId,
        monthlyPriceId: pricing.monthlyPriceId,
        annualPriceId: pricing.annualPriceId,
      },
      ip: await auditIp(),
    });
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    return { ok: true, error: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof BillingInputError ? err.message : "Could not sync Stripe prices. Try again.",
    };
  }
}
