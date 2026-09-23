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