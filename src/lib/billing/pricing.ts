import type { PlanRecord, Cents } from "./types";

export type BillingInterval = "monthly" | "annual";

/**
 * Price helpers are pure on purpose so client components, server components
 * and tests all render identical prices from PlanRecord without extra IO.
 */

function assertInterval(interval: string): asserts interval is BillingInterval {
  if (interval !== "monthly" && interval !== "annual") {
    // Defaulting an unknown interval to the monthly price would let a request
    // pay less than the server expects, so this is a hard error.
    throw new Error(`invalid billing interval: ${interval}`);
  }
}

export function planPriceCents(plan: Pick<PlanRecord, "monthly_price_cents" | "annual_price_cents" | "price_custom">, interval: BillingInterval): Cents {
  assertInterval(interval);
  if (plan.price_custom) return 0;
  return interval === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
}

/**
 * What a year costs if it were paid monthly, so the annual saving is derived
 * from the same two numbers the checkout charges rather than a separate copy
 * string. Never negative: a plan priced at or above ten monthly periods
 * reports no saving rather than a fabricated discount.
 */
export function annualSavingsCents(
  plan: Pick<PlanRecord, "monthly_price_cents" | "annual_price_cents" | "price_custom">,
): Cents {
  if (plan.price_custom) return 0;
  if (!Number.isSafeInteger(plan.monthly_price_cents) || plan.monthly_price_cents <= 0) return 0;
  if (!Number.isSafeInteger(plan.annual_price_cents) || plan.annual_price_cents < 0) return 0;
  const twelveMonths = annualFromMonthly(plan.monthly_price_cents) + plan.monthly_price_cents * 2;
  return Math.max(0, twelveMonths - plan.annual_price_cents);
}

/** Whole-dollar label for a plan price, e.g. `1500 -> "$15"`. */
export function planPriceLabel(cents: Cents): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/**
 * The billing line shown under a price. The annual variant states the saving
 * only when there is one, so the copy cannot claim a discount that does not
 * exist in the plan row.
 */
export function planBillingNote(
  plan: Pick<PlanRecord, "monthly_price_cents" | "annual_price_cents" | "price_custom">,
  interval: BillingInterval,
): string {
  assertInterval(interval);
  if (plan.price_custom) return "Custom pricing. Contact us to get started.";
  const cents = planPriceCents(plan, interval);
  const price = `$${(cents / 100).toFixed(0)}`;
  if (interval === "monthly") return `Billed monthly at ${price}/month`;
  const savings = annualSavingsCents(plan);
  const suffix = savings > 0 ? ` (save $${(savings / 100).toFixed(0)}/year)` : "";
  return `Billed annually at ${price}/year${suffix}`;
}

export function formatPlanPrice(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export function planIntervalLabel(interval: BillingInterval): string {
  assertInterval(interval);
  return interval === "annual" ? "/year" : "/month";
}

/**
 * Plan pricing rules (annual billing).
 *
 * Annual plans grant two months free: annual = monthly × 10
 * (Team $15 → $150, Organization $49 → $490). Integer cents
 * throughout; never float math.
 */

/** Annual price in cents for a plan priced at `monthlyPriceCents`/month. */
export function annualFromMonthly(monthlyPriceCents: number): number {
  if (!Number.isSafeInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
    throw new Error(`invalid monthly price: ${monthlyPriceCents}`);
  }
  const annual = monthlyPriceCents * 10;
  if (!Number.isSafeInteger(annual)) {
    throw new Error(`annual price overflows safe integer range: ${monthlyPriceCents}`);
  }
  return annual;
}

/** True when `annualPriceCents` follows the annual two-months-free rule. */
export function isAnnualDiscount(monthlyPriceCents: number, annualPriceCents: number): boolean {
  if (!Number.isSafeInteger(monthlyPriceCents) || monthlyPriceCents <= 0) return false;
  return annualFromMonthly(monthlyPriceCents) === annualPriceCents;
}

/** Human-readable description of the expected annual total. */
export function annualAmountDescription(monthlyPriceCents: number): string {
  const annual = annualFromMonthly(monthlyPriceCents);
  const monthly = (monthlyPriceCents / 100).toFixed(2);
  const yearly = (annual / 100).toFixed(2);
  return `$${yearly}/year for a $${monthly}/month plan`;
}
