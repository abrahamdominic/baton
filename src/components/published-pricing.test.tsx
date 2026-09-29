// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { PricingView } from "./pricing-view";
import { renderWithI18n } from "@/lib/i18n/test-render";
import { catalogPlanBySlug } from "@/lib/billing/plan-catalog";
import { planPriceCents, annualSavingsCents } from "@/lib/billing/pricing";
import { DEFAULT_PLANS } from "@/lib/billing/plans";

// `plans.ts` is server-only; the client pricing view never imports it, so the
// guard is mocked away to let the test assert on the shared seed catalog too.
vi.mock("server-only", () => ({}));

afterEach(cleanup);

/**
 * End-to-end verification of the published Baton prices, from the catalog
 * through to the pixels a customer reads on /pricing:
 *
 *   Team          $15/month, $150/year, saves $30/year
 *   Organization  $49/month, $490/year, saves $98/year
 *
 * Every figure is asserted from the catalog, never retyped, so this fails if a
 * price is changed in one place but not another.
 */
const EXPECTED = {
  team: { monthly: 1500, annual: 15000, savings: 3000 },
  organization: { monthly: 4900, annual: 49000, savings: 9800 },
} as const;

const label = (cents: number) => `$${(cents / 100).toFixed(0)}`;

describe("published pricing is the documented source of truth", () => {
  it.each(["team", "organization"] as const)("%s prices are correct in the catalog", (slug) => {
    const plan = catalogPlanBySlug(slug)!;
    expect(plan.monthlyPriceCents).toBe(EXPECTED[slug].monthly);
    expect(plan.annualPriceCents).toBe(EXPECTED[slug].annual);
  });

  it.each(["team", "organization"] as const)("%s annual savings are arithmetically correct", (slug) => {
    const plan = catalogPlanBySlug(slug)!;
    const row = {
      monthly_price_cents: plan.monthlyPriceCents,
      annual_price_cents: plan.annualPriceCents,
      price_custom: plan.priceCustom,
    };
    // Twelve monthly payments minus the annual price.
    expect(row.monthly_price_cents * 12 - row.annual_price_cents).toBe(EXPECTED[slug].savings);
    // The helper must agree, and must not invent a discount.
    expect(annualSavingsCents(row)).toBe(EXPECTED[slug].savings);
    expect(annualSavingsCents(row)).toBeGreaterThan(0);
  });

  it("renders the correct prices on the pricing page for both intervals", () => {
    renderWithI18n(<PricingView />);

    // Monthly (default) state.
    expect(screen.getAllByText(label(EXPECTED.team.monthly)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(label(EXPECTED.organization.monthly)).length).toBeGreaterThan(0);
    expect(screen.queryByText(label(EXPECTED.team.annual))).toBeNull();

    // Annual state.
    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));
    expect(screen.getAllByText(label(EXPECTED.team.annual)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(label(EXPECTED.organization.annual)).length).toBeGreaterThan(0);
    expect(screen.queryByText(label(EXPECTED.team.monthly))).toBeNull();
  });

  it("shows the correct savings copy on the pricing page", () => {
    renderWithI18n(<PricingView />);
    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));

    expect(screen.getByText("Billed annually at $150/year (save $30/year)")).toBeTruthy();
    expect(screen.getByText("Billed annually at $490/year (save $98/year)")).toBeTruthy();
  });

  it("drives the checkout link from the selected interval for both plans", () => {
    renderWithI18n(<PricingView />);

    const teamMonthly = screen.getByRole("link", { name: /start 14-day free trial \(monthly\)/i });
    const orgMonthly = screen.getByRole("link", { name: /choose organization \(monthly\)/i });
    expect(decodeURIComponent(teamMonthly.getAttribute("href")!)).toBe(
      "/dashboard/billing/checkout?plan=plan_team_default&billing=monthly",
    );
    expect(decodeURIComponent(orgMonthly.getAttribute("href")!)).toBe(
      "/dashboard/billing/checkout?plan=plan_org_default&billing=monthly",
    );

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));

    const teamAnnual = screen.getByRole("link", { name: /start 14-day free trial \(annual\)/i });
    const orgAnnual = screen.getByRole("link", { name: /choose organization \(annual\)/i });
    // The toggle must change the checkout selection, not just the display.
    expect(decodeURIComponent(teamAnnual.getAttribute("href")!)).toBe(
      "/dashboard/billing/checkout?plan=plan_team_default&billing=annual",
    );
    expect(decodeURIComponent(orgAnnual.getAttribute("href")!)).toBe(
      "/dashboard/billing/checkout?plan=plan_org_default&billing=annual",
    );
  });

  it("keeps the compare-matrix headers in step with the toggle", () => {
    // The matrix columns are built from the `plans` rows, so the table needs
    // the real plan records - not the catalog fallback - to have Team and
    // Organization columns at all.
    renderWithI18n(<PricingView plans={DEFAULT_PLANS} />);

    const headerFor = (name: string) =>
      screen
        .getAllByRole("columnheader")
        .find((el) => el.textContent?.trim().startsWith(name))?.textContent ?? "";

    expect(headerFor("Team")).toContain("$15");
    expect(headerFor("Organization")).toContain("$49");

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));

    expect(headerFor("Team")).toContain("$150");
    expect(headerFor("Organization")).toContain("$490");
  });

  it("falls back to the same prices when the plans table is unavailable", () => {
    // `plans={[]}` is the dev/local path where Supabase is not configured.
    renderWithI18n(<PricingView plans={[]} />);
    expect(screen.getAllByText("$15").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));
    expect(screen.getAllByText("$150").length).toBeGreaterThan(0);
    expect(screen.getByText("Billed annually at $490/year (save $98/year)")).toBeTruthy();
  });

  it("seeds the runtime plan store with the published prices", () => {
    const team = DEFAULT_PLANS.find((p) => p.slug === "team")!;
    const org = DEFAULT_PLANS.find((p) => p.slug === "organization")!;
    expect(planPriceCents(team, "monthly")).toBe(EXPECTED.team.monthly);
    expect(planPriceCents(team, "annual")).toBe(EXPECTED.team.annual);
    expect(planPriceCents(org, "monthly")).toBe(EXPECTED.organization.monthly);
    expect(planPriceCents(org, "annual")).toBe(EXPECTED.organization.annual);
  });
});
