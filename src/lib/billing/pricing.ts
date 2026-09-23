import type { PlanRecord, Cents } from "./types";

export type BillingInterval = "monthly" | "annual";

/**
 * Price helpers are pure on purpose so client components, server components
 * and tests all render identical prices from PlanRecord without extra IO.
 */

export function planPriceCents(plan: Pick<PlanRecord, "monthly_price_cents" | "annual_price_cents" | "price_custom">, interval: BillingInterval): Cents {
  if (plan.price_custom) return 0;
  return interval === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
}

export function formatPlanPrice(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export function planIntervalLabel(interval: BillingInterval): string {
  return interval === "annual" ? "/year" : "/month";
}

export function planBillingNote(plan: Pick<PlanRecord, "price_custom" | "name">, interval: BillingInterval): string {
  if (plan.price_custom) return `${plan.name} is custom-priced. Contact us to get started.`;
  return interval === "annual" ? "Billed annually." : "Billed monthly.";
}

/**
 * Plan pricing rules (annual billing).
 *
 * Annual plans carry exactly a 20% discount on 12 monthly periods
 * (`monthly * 12 * 4/5`). Integer cents throughout; never float math.
 */

/** Annual price in cents for a plan priced at `monthlyPriceCents`/month. */
export function annualFromMonthly(monthlyPriceCents: number): number {
  if (!Number.isSafeInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
    throw new Error(`invalid monthly price: ${monthlyPriceCents}`);
  }
  const annual = Math.round((monthlyPriceCents * 12 * 4) / 5);
  if (!Number.isSafeInteger(annual)) {
    throw new Error(`annual price overflows safe integer range: ${monthlyPriceCents}`);
  }
  return annual;
}

/** True when `annualPriceCents` is exactly 20% off the monthly rate. */
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