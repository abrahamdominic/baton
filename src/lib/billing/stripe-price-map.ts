import "server-only";
import type Stripe from "stripe";
import { listPlans } from "./plans";
import type { PlanRecord } from "./types";

/**
 * Mapping Stripe prices back to Baton plans.
 *
 * Entitlements live in Baton's database and are derived from `subscriptions.plan_id`.
 * A user who changes their plan does so on Stripe (through the Billing Portal),
 * which means Stripe is the side that learns the new price first and Baton has to
 * work out which plan that price *is*. Without this mapping an upgrade or
 * downgrade is invisible to Baton: the subscription keeps paying, the renewal
 * events keep arriving, and the user silently keeps the old entitlement.
 *
 * The mapping is deliberately driven by the `plans` table
 * (`stripe_monthly_price_id` / `stripe_annual_price_id`) rather than by parsing
 * Stripe product names, so the answer is auditable in the same place the price
 * is administered and a renamed product cannot silently re-point a plan.
 */

export type BillingInterval = "monthly" | "annual";

export interface PriceBinding {
  /** Baton plan this Stripe price pays for. */
  planId: string;
  planSlug: string;
  planName: string;
  interval: BillingInterval;
  priceId: string;
  /** True when the plan's price rank says the new plan is a step up or down. */
  monthlyCents: number;
  annualCents: number;
}

export const ANNUAL_WINDOW_MS = 330 * 86_400_000;

/**
 * Index every configured Stripe price id to the plan it belongs to.
 *
 * A price configured on two plans is a configuration error that would make
 * entitlement depend on iteration order, so the first plan (by the caller's sort
 * order, i.e. plan sort_order) wins and the clash is reported rather than
 * silently resolved.
 */
export function priceIndexFromPlans(plans: PlanRecord[]): {
  index: Map<string, PriceBinding>;
  duplicatePriceIds: string[];
} {
  const index = new Map<string, PriceBinding>();
  const duplicatePriceIds: string[] = [];

  for (const plan of plans) {
    const candidates: { priceId: string | null; interval: BillingInterval }[] = [
      { priceId: plan.stripe_monthly_price_id, interval: "monthly" },
      { priceId: plan.stripe_annual_price_id, interval: "annual" },
    ];
    for (const { priceId, interval } of candidates) {
      if (!priceId) continue;
      if (index.has(priceId)) {
        if (!duplicatePriceIds.includes(priceId)) duplicatePriceIds.push(priceId);
        continue;
      }
      index.set(priceId, {
        planId: plan.id,
        planSlug: plan.slug,
        planName: plan.name,
        interval,
        priceId,
        monthlyCents: plan.monthly_price_cents,
        annualCents: plan.annual_price_cents,
      });
    }
  }
  return { index, duplicatePriceIds };
}

/**
 * Price ids currently attached to a Stripe subscription.
 *
 * Stripe moved `plan` to `items` on the subscription object, and both shapes are
 * still seen depending on the account's API version, so both are read. Items
 * with quantity 0 are skipped: they are how Stripe models a scheduled downgrade
 * (the new price is attached but not billed yet), and treating them as active
 * would flip the user's entitlement the moment they cancel, before payment.
 */
export function subscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  const out: string[] = [];
  const items = subscription.items?.data ?? [];
  for (const item of items) {
    const quantity = typeof item.quantity === "number" ? item.quantity : 1;
    if (quantity <= 0) continue;
    const priceId = item.price?.id ?? null;
    if (priceId) out.push(priceId);
  }
  if (out.length === 0) {
    // Legacy shape: subscription.plan without items populated.
    const legacy = (subscription as unknown as { plan?: Stripe.Subscription["items"]["data"][number] }).plan;
    if (legacy?.price?.id) out.push(legacy.price.id);
  }
  return out;
}

/**
 * What a price costs per month, regardless of how it is billed.
 *
 * Annual prices are billed up front, so comparing their raw cents against a
 * monthly price makes every annual price look "bigger". Ranking or classifying on
 * raw figures therefore puts `pro annual` ($200/yr) above `team monthly` ($60/mo)
 * and reads a monthly to annual switch as a downgrade. Both are wrong, so every
 * money comparison in this module goes through this one function.
 */
function monthlyEquivalent(binding: PriceBinding): number {
  return binding.interval === "annual" ? binding.annualCents / 12 : binding.monthlyCents;
}

/**
 * The plan a subscription is currently paying for.
 *
 * Returns null when no attached price maps to a plan, which is a configuration
 * gap rather than a normal state: the caller records it and leaves the local
 * entitlement alone, because guessing would either grant or revoke access on a
 * technicality. A subscription with several *recognised* prices (a proration
 * mid-flight, or a leftover old item) resolves to the highest-ranked one, since
 * the highest price is the one being charged.
 */
export function resolveSubscriptionPlan(
  subscription: Stripe.Subscription,
  index: Map<string, PriceBinding>,
): { binding: PriceBinding; ambiguous: boolean } | null {
  const bindings = subscriptionPriceIds(subscription)
    .map((id) => index.get(id))
    .filter((b): b is PriceBinding => Boolean(b));
  if (bindings.length === 0) return null;

  const ranked = [...bindings].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));
  return { binding: ranked[0], ambiguous: bindings.length > 1 };
}

/**
 * Recover the billing interval from a stored paid window.
 *
 * Used where the interval is needed but no payment is at hand, a plan change
 * webhook, for instance. Stripe itself uses the same 330-day threshold when
 * deciding whether an invoice is annual, so a window of that length is treated
 * as annual here too rather than by an exact 365.
 */
export function intervalFromPeriod(
  start: string | null,
  end: string | null,
): BillingInterval {
  if (!start || !end) return "monthly";
  const span = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(span) || span <= 0) return "monthly";
  return span >= ANNUAL_WINDOW_MS ? "annual" : "monthly";
}

export type PlanChangeDirection = "upgrade" | "downgrade" | "lateral";

/**
 * Classify a plan change by money, not by plan ordering.
 *
 * Plan slugs are not a ranking ("team" is not above "pro" by name). Both sides
 * are normalised to what the user pays per month, with one exception: a change of
 * interval on the same plan is decided by the interval, not by the per-month
 * figure.
 */
export function classifyPlanChange(
  current: { monthlyCents: number; annualCents: number },
  next: { monthlyCents: number; annualCents: number },
  currentInterval: BillingInterval,
  nextInterval: BillingInterval,
): PlanChangeDirection {
  // Same plan, different term: the interval decides. Switching to annual is an
  // upgrade even though it lowers the per-month figure, because the customer is
  // committing to a longer term at a discount; switching back to monthly gives
  // that up. Comparing the per-month figures here instead would report a
  // monthly to annual switch as a downgrade, which is both wrong and the sort of
  // thing that ends up rendered as "downgraded" on an invoice email.
  if (currentInterval !== nextInterval) {
    const samePrice =
      current.monthlyCents === next.monthlyCents && current.annualCents === next.annualCents;
    if (samePrice) return nextInterval === "annual" ? "upgrade" : "downgrade";
  }

  const now = normalizeToMonthly(current, currentInterval);
  const then = normalizeToMonthly(next, nextInterval);
  if (then > now) return "upgrade";
  if (then < now) return "downgrade";
  return "lateral";
}

function normalizeToMonthly(
  binding: { monthlyCents: number; annualCents: number },
  interval: BillingInterval,
): number {
  return interval === "annual" ? binding.annualCents / 12 : binding.monthlyCents;
}

/** Load the price index from the plans table. */
export async function loadPriceIndex(): Promise<{
  index: Map<string, PriceBinding>;
  duplicatePriceIds: string[];
}> {
  const plans = await listPlans({ includeInactive: true });
  return priceIndexFromPlans(plans);
}
