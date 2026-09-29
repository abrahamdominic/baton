// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import React from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { PricingView } from "./pricing-view";
import { renderWithI18n } from "@/lib/i18n/test-render";
import { DEFAULT_PLANS } from "@/lib/billing/plans";
import type { PlanRecord } from "@/lib/billing/types";

afterEach(cleanup);

function plan(slug: string, overrides: Partial<PlanRecord> = {}): PlanRecord {
  const base = DEFAULT_PLANS.find((p) => p.slug === slug);
  if (!base) throw new Error(`fixture plan missing: ${slug}`);
  return { ...base, ...overrides };
}

describe("pricing cards read the plan row", () => {
  it("renders the plan row's price instead of the built-in literal", () => {
    renderWithI18n(<PricingView plans={[plan("team", { monthly_price_cents: 2000, annual_price_cents: 20000 })]} />);

    // $20, not the hardcoded $15.
    expect(screen.getAllByText("$20").length).toBeGreaterThan(0);
    expect(screen.queryByText("$15")).toBeNull();
  });

  it("derives the annual savings claim from the plan row", () => {
    renderWithI18n(<PricingView plans={[plan("team")]} />);

    // The note under the price follows the selected billing toggle.
    expect(screen.getByText("Billed monthly at $15/month")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));
    expect(screen.getByText("Billed annually at $150/year (save $30/year)")).toBeTruthy();
  });

  it("recomputes the savings when the annual price is discounted differently", () => {
    renderWithI18n(<PricingView plans={[plan("organization", { annual_price_cents: 40_000 })]} />);

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));
    // Twelve months of $49 is $588; annual $400 saves $188.
    expect(screen.getByText("Billed annually at $400/year (save $188/year)")).toBeTruthy();
  });

  it("shows Custom and no savings for a custom-priced plan", () => {
    renderWithI18n(<PricingView plans={[plan("team", { price_custom: true })]} />);
    expect(screen.getAllByText("Custom").length).toBeGreaterThan(0);
    expect(screen.queryByText(/save \$/)).toBeNull();
  });

  it("falls back to the shipped defaults when the plan fetch returned nothing", () => {
    renderWithI18n(<PricingView plans={[]} />);
    expect(screen.getAllByText("$15").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$49").length).toBeGreaterThan(0);
  });
});
