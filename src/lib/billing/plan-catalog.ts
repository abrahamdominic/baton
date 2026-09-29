import type { PlanLimits } from "./types";

/**
 * Canonical plan catalog — the single place a plan's price and capabilities are
 * written down in code.
 *
 * Deliberately free of `server-only` so both sides of the render boundary can
 * read it: the server plan store builds `DEFAULT_PLANS` from these entries, and
 * the public pricing cards use them as the offline fallback. There is exactly
 * one copy of "Team is $15/month, $150/year", so a price change cannot drift
 * between the marketing card, the compare matrix, and what checkout charges.
 *
 * The `plans` table remains the runtime source of truth: production reads the
 * rows an admin edits, and these entries are the seed plus the fallback used
 * when the database is unreachable.
 */

export interface CatalogPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Monthly price in integer cents. */
  monthlyPriceCents: number;
  /** Annual price in integer cents (ten monthly periods: two months free). */
  annualPriceCents: number;
  /** When true the plan has no fixed price and is sold through contact. */
  priceCustom: boolean;
  currency: string;
  /** Human-readable marketing bullets shown on the pricing card. */
  features: string[];
  /** Machine gates enforced by the entitlement resolver. */
  limits: PlanLimits;
  sortOrder: number;
}

export const PLAN_CATALOG: readonly CatalogPlan[] = [
  {
    id: "plan_team_default",
    slug: "team",
    name: "Team",
    description: "For engineering teams that want to ship fast and stop PR stalls.",
    monthlyPriceCents: 1500,
    annualPriceCents: 15000,
    priceCustom: false,
    currency: "USD",
    features: [
      "Unlimited repositories",
      "Deterministic state classifier",
      "Per-repo customizable nudge thresholds",
      "Automated @-mention reviewer nudges",
      "Team-wide repository boards",
      "Your Move queue with priority sorting",
      "Evidence-backed repository intelligence",
      "Saved work context",
    ],
    limits: {
      maxRepos: null,
      maxMembers: 25,
      features: [
        "custom_thresholds",
        "team_workspace",
        "unlimited_repos",
        "repo_intelligence",
        "work_context",
      ],
    },
    sortOrder: 10,
  },
  {
    id: "plan_org_default",
    slug: "organization",
    name: "Organization",
    description:
      "For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.",
    monthlyPriceCents: 4900,
    annualPriceCents: 49000,
    priceCustom: false,
    currency: "USD",
    features: [
      "Everything in Team",
      "Unlimited repositories & team members",
      "Organization-wide review stall policies",
      "Team roles, invitations & permissions with audit trail",
      "Audit log export (CSV/JSON)",
      "What Broke? CI investigation",
      "Change impact analysis",
    ],
    limits: {
      maxRepos: null,
      maxMembers: 1000,
      features: [
        "custom_thresholds",
        "team_workspace",
        "organization_workspace",
        "organization_policies",
        "audit_export",
        "unlimited_repos",
        "repo_intelligence",
        "work_context",
        "change_impact",
      ],
    },
    sortOrder: 20,
  },
] as const;

const BY_SLUG = new Map(PLAN_CATALOG.map((p) => [p.slug, p]));

/** Look up a catalog plan by slug (`"team"`, `"organization"`). */
export function catalogPlanBySlug(slug: string): CatalogPlan | null {
  return BY_SLUG.get(slug) ?? null;
}
