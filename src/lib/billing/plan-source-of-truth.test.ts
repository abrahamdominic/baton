import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLAN_CATALOG, catalogPlanBySlug } from "./plan-catalog";
import { DEFAULT_PLANS } from "./plans";
import { planPriceCents, planPriceLabel, planBillingNote } from "./pricing";

/**
 * Guards the "one source of truth for prices" rule.
 *
 * A plan price is only ever written down in `plan-catalog.ts`. Everything else
 * — pricing cards, compare matrix, checkout, USDC verification — must derive
 * from the `plans` row or the catalog. If a second module ever hardcodes the
 * canonical amounts again, these tests fail.
 */

/** Canonical amounts, in cents, for the two paid plans. */
const CANONICAL_CENTS = [1500, 15000, 4900, 49000];

/**
 * Files allowed to mention a canonical amount outside the catalog, with a
 * reason. Everything else is a violation.
 */
const ALLOWED = new Set<string>([
  // The single source of truth.
  "src/lib/billing/plan-catalog.ts",
  // Admin input hint showing the cents format, not plan data.
  "src/app/admin/plans/plan-form.tsx",
]);

/** Remove comments so prose examples do not count as hardcoded prices. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const ROOT = join(process.cwd(), "src");

describe("plan catalog is the single source of truth", () => {
  it("declares the canonical Team and Organization prices exactly once", () => {
    const team = catalogPlanBySlug("team")!;
    const org = catalogPlanBySlug("organization")!;
    expect([team.monthlyPriceCents, team.annualPriceCents]).toEqual([1500, 15000]);
    expect([org.monthlyPriceCents, org.annualPriceCents]).toEqual([4900, 49000]);
    expect(PLAN_CATALOG).toHaveLength(2);
  });

  it("keeps every annual price at ten monthly periods", () => {
    for (const plan of PLAN_CATALOG) {
      expect(plan.annualPriceCents).toBe(plan.monthlyPriceCents * 10);
    }
  });

  it("has no hardcoded canonical amount outside the allowlist", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const rel = `src/${file.slice(ROOT.length + 1).split("\\").join("/")}`;
      if (ALLOWED.has(rel)) continue;
      const text = stripComments(readFileSync(file, "utf8"));
      for (const cents of CANONICAL_CENTS) {
        // Match the number as a standalone token so 4900 does not match 49000.
        if (new RegExp(`(?<![\\w.])${cents}(?![\\w])`).test(text)) {
          violations.push(`${rel} mentions ${cents}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("server plan store is generated from the catalog", () => {
  it("produces DEFAULT_PLANS with the catalog prices and limits", () => {
    for (const catalog of PLAN_CATALOG) {
      const stored = DEFAULT_PLANS.find((p) => p.slug === catalog.slug)!;
      expect(stored).toBeDefined();
      expect(stored.monthly_price_cents).toBe(catalog.monthlyPriceCents);
      expect(stored.annual_price_cents).toBe(catalog.annualPriceCents);
      expect(stored.name).toBe(catalog.name);
      expect(stored.limits).toEqual(catalog.limits);
      expect(stored.is_public).toBe(true);
      expect(stored.is_active).toBe(true);
    }
  });

  it("renders the canonical price labels and billing notes from those rows", () => {
    const team = DEFAULT_PLANS.find((p) => p.slug === "team")!;
    expect(planPriceLabel(planPriceCents(team, "monthly"))).toBe("$15");
    expect(planPriceLabel(planPriceCents(team, "annual"))).toBe("$150");
    expect(planBillingNote(team, "monthly")).toBe("Billed monthly at $15/month");
    expect(planBillingNote(team, "annual")).toBe("Billed annually at $150/year (save $30/year)");

    const org = DEFAULT_PLANS.find((p) => p.slug === "organization")!;
    expect(planPriceLabel(planPriceCents(org, "monthly"))).toBe("$49");
    expect(planPriceLabel(planPriceCents(org, "annual"))).toBe("$490");
    expect(planBillingNote(org, "annual")).toBe("Billed annually at $490/year (save $98/year)");
  });
});

/**
 * The `plans` table is the runtime source of truth, and it is populated by the
 * SQL migrations. Those migrations are hand-written, so they drifted from the
 * catalog once already: 0006 projected an older, smaller `limits.features` list
 * and 0010 only corrected prices, which silently stripped four advertised
 * features from every paying customer. These tests fail if that ever recurs.
 */
describe("SQL migrations agree with the plan catalog", () => {
  const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

  function latestMigrationWritingPlans(): string {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // The catalog projection lives in the highest-numbered migration, which is
    // the one that runs last and therefore the state a real database ends in.
    for (let i = files.length - 1; i >= 0; i--) {
      const text = readFileSync(join(MIGRATIONS_DIR, files[i]), "utf8");
      if (/limits\s*=\s*'\{/.test(text) && /on conflict \(slug\)/i.test(text)) return text;
    }
    throw new Error("No migration seeds plans.limits with an on-conflict guard row.");
  }

  const latest = latestMigrationWritingPlans();

  it("seeds the canonical prices in the final plan migration", () => {
    for (const plan of PLAN_CATALOG) {
      const row = new RegExp(
        `\\('${plan.slug}',[\\s\\S]*?${plan.monthlyPriceCents},\\s*${plan.annualPriceCents},`,
      );
      expect(row.test(latest), `${plan.slug} guard row must carry the catalog prices`).toBe(true);
    }
  });

  it("seeds the exact catalog limits, so no advertised feature is locked away", () => {
    for (const plan of PLAN_CATALOG) {
      const normalized = latest.replace(/\s+/g, " ");
      for (const key of plan.limits.features ?? []) {
        expect(normalized, `migration must grant ${plan.slug} the "${key}" gate`).toContain(
          `"${key}"`,
        );
      }
      // maxMembers is stored on the row; assert it so a plan cannot silently
      // become a personal plan.
      expect(normalized).toContain(`"maxMembers": ${plan.limits.maxMembers}`);
    }
  });

  it("never regresses the Team plan to a superseded price", () => {
    // $96, $10, and $50/$480 were all real prices in earlier migrations. The
    // final projection must not reintroduce any of them.
    for (const stale of ["9600", "48000", "800", "1000, 9600", "5000, 48000"]) {
      expect(latest, `final migration must not reintroduce ${stale}`).not.toContain(stale);
    }
  });
});
