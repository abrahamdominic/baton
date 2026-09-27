import { DEFAULT_PLANS } from "./plans";
import type { PlanRecord } from "./types";

/**
 * The plan catalog is the single source of truth for pricing, so tests read
 * fixtures from it rather than restating amounts. A price change therefore
 * shows up as a deliberate diff in one file, not as silently stale assertions
 * spread across the suite.
 */
export function planOf(slug: string): PlanRecord {
  const plan = DEFAULT_PLANS.find((p) => p.slug === slug);
  if (!plan) throw new Error(`fixture plan missing: ${slug}`);
  return plan;
}
