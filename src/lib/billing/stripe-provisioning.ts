import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getAdminClient } from "@/lib/supabase/client";
import { planFromRow, type Row } from "./records";
import { BillingInputError } from "./errors";
import type { Cents, PlanRecord } from "./types";

/**
 * Server-side Stripe catalog provisioning. Stripe Prices are immutable, so
 * "syncing" a plan amount means: find the plan's product, match the interval
 * price's amount, and if it differs, archive the old price and create a new
 * one. The resulting IDs are written back to the `plans` table so card
 * checkout always uses the exact amount the admin configured (aa.md §2).
 *
 * This is the ONLY place that mutates the Stripe catalog; the admin UI calls
 * it through a server action rather than letting users hand-paste IDs.
 */

const PRODUCT_META = {
  origin: "baton",
  kind: "subscription_plan",
} as const;

export interface StripePlanPricing {
  productId: string;
  monthlyPriceId: string | null;
  annualPriceId: string | null;
}

function requireCents(plan: PlanRecord, interval: "monthly" | "annual"): Cents {
  const cents = interval === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new BillingInputError(`Plan "${plan.slug}" has an invalid ${interval} amount.`);
  }
  return cents;
}

/** Find the plan's product by its stored id first, then by metadata slug. */
async function findProduct(stripe: Stripe, plan: PlanRecord): Promise<Stripe.Product | null> {
  if (plan.stripe_product_id) {
    try {
      return await stripe.products.retrieve(plan.stripe_product_id);
    } catch {
      // Stale id (deleted in Stripe). Fall back to a metadata search.
    }
  }
  for await (const product of stripe.products.list({
    limit: 100,
    active: true,
  })) {
    const meta = product.metadata ?? {};
    if (meta.origin === PRODUCT_META.origin && meta.baton_plan_slug === plan.slug) {
      return product;
    }
  }
  return null;
}

export async function ensureStripeProduct(plan: PlanRecord): Promise<Stripe.Product> {
  const stripe = getStripe();
  const existing = await findProduct(stripe, plan);
  if (existing) {
    const needsUpdate =
      existing.name !== plan.name ||
      (existing.metadata?.origin ?? "") !== PRODUCT_META.origin ||
      (existing.metadata?.baton_plan_slug ?? "") !== plan.slug;
    if (needsUpdate) {
      return stripe.products.update(existing.id, {
        name: plan.name,
        metadata: {
          ...(existing.metadata ?? {}),
          ...PRODUCT_META,
          baton_plan_id: plan.id,
          baton_plan_slug: plan.slug,
        },
      });
    }
    return existing;
  }

  return stripe.products.create({
    name: plan.name,
    description: plan.description ?? undefined,
    metadata: {
      ...PRODUCT_META,
      baton_plan_id: plan.id,
      baton_plan_slug: plan.slug,
    },
  });
}

const INTERVAL_META: Record<"monthly" | "annual", { interval: Stripe.Price.Recurring.Interval; baton_interval: string }> = {
  monthly: { interval: "month", baton_interval: "monthly" },
  annual: { interval: "year", baton_interval: "annual" },
};

/**
 * Ensure the interval price for a product matches the plan amount. Stripe tag
 * matching adds a check that the price actually belongs to this plan product.
 */
export async function ensureIntervalPrice(
  stripe: Stripe,
  productId: string,
  plan: PlanRecord,
  interval: "monthly" | "annual",
): Promise<Stripe.Price | null> {
  const cents = requireCents(plan, interval);
  if (cents <= 0) return null; // free tier: no payable price

  const meta = INTERVAL_META[interval];
  const currentId = interval === "annual" ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id;

  const existing = currentId
    ? await stripe.prices.retrieve(currentId).catch(() => null)
    : null;
  if (existing) {
    const currentAmount = existing.unit_amount ?? null;
    const currentInterval = existing.recurring?.interval ?? null;
    const tagMatches =
      existing.product === productId && existing.metadata?.baton_interval === meta.baton_interval;
    if (!tagMatches) {
      // Attached to a different product/interval: treat as stale and rebuild.
      return createPrice(stripe, productId, plan, interval, cents, meta, existing.id);
    }
    if (currentAmount !== cents || currentInterval !== meta.interval) {
      return createPrice(stripe, productId, plan, interval, cents, meta, existing.id);
    }
    return existing;
  }

  // No stored id: search the product's prices for a tag-true match.
  for await (const price of stripe.prices.list({
    product: productId,
    limit: 100,
    active: true,
  })) {
    const tagMatches =
      price.unit_amount === cents &&
      price.recurring?.interval === meta.interval &&
      price.metadata?.baton_interval === meta.baton_interval;
    if (tagMatches) return price;
  }
  return createPrice(stripe, productId, plan, interval, cents, meta, null);
}

async function createPrice(
  stripe: Stripe,
  productId: string,
  plan: PlanRecord,
  interval: "monthly" | "annual",
  cents: Cents,
  meta: { interval: Stripe.Price.Recurring.Interval; baton_interval: string },
  archiveExistingId: string | null,
): Promise<Stripe.Price> {
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: cents,
    currency: "usd",
    recurring: { interval: meta.interval },
    metadata: {
      ...PRODUCT_META,
      baton_plan_id: plan.id,
      baton_plan_slug: plan.slug,
      baton_interval: meta.baton_interval,
    },
  });
  if (archiveExistingId) {
    await stripe.prices.update(archiveExistingId, { active: false }).catch(() => null);
  }
  return price;
}

/**
 * Ensure product + both interval prices exist and match the plan amounts, then
 * persist the resulting Stripe IDs back onto the `plans` row. Returns the final
 * pricing linkage so callers can store/audit it.
 */
export async function provisionPlanStripePricing(plan: PlanRecord): Promise<StripePlanPricing> {
  const stripe = getStripe();
  const product = await ensureStripeProduct(plan);
  const monthly = await ensureIntervalPrice(stripe, product.id, plan, "monthly");
  const annual = await ensureIntervalPrice(stripe, product.id, plan, "annual");

  const pricing: StripePlanPricing = {
    productId: product.id,
    monthlyPriceId: monthly?.id ?? null,
    annualPriceId: annual?.id ?? null,
  };
  await persistPlanStripeIds(plan.id, pricing);
  return pricing;
}

export async function persistPlanStripeIds(planId: string, pricing: StripePlanPricing): Promise<PlanRecord> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("plans")
    .update({
      stripe_product_id: pricing.productId,
      stripe_monthly_price_id: pricing.monthlyPriceId,
      stripe_annual_price_id: pricing.annualPriceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .select("*")
    .single();
  if (error) throw new Error(`plans.stripe-link failed: ${error.message}`);
  return planFromRow(data as Row);
}

/**
 * Human-facing status of a plan's Stripe linkage, used by the admin UI to
 * explain why a "Sync Stripe prices" action is needed.
 */
export function stripeLinkageLabel(plan: PlanRecord): string {
  const missing: string[] = [];
  if (!plan.stripe_product_id) missing.push("product");
  if (!plan.stripe_monthly_price_id) missing.push("monthly price");
  if (!plan.stripe_annual_price_id) missing.push("annual price");
  if (missing.length === 0) return "Linked";
  if (missing.length === 3) return "Not linked (run \"Sync Stripe prices\")";
  return `Partially linked (missing ${missing.join(", ")})`;
}