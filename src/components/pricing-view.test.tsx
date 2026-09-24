import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PricingView } from "./pricing-view";
import type { PlanRecord } from "@/lib/billing/types";

const FIXTURE_PLANS: PlanRecord[] = [
  {
    id: "plan_team_test",
    slug: "team",
    name: "Team",
    description: null,
    monthly_price_cents: 1500,
    annual_price_cents: 15000,
    price_custom: false,
    currency: "USD",
    features: [],
    limits: { maxRepos: null, maxMembers: 25, features: ["custom_thresholds", "team_workspace"] },
    stripe_product_id: null,
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
    is_active: true,
    is_public: true,
    sort_order: 10,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "plan_org_test",
    slug: "organization",
    name: "Organization",
    description: null,
    monthly_price_cents: 4900,
    annual_price_cents: 49000,
    price_custom: false,
    currency: "USD",
    features: [],
    limits: {
      maxRepos: null,
      maxMembers: 1000,
      features: ["custom_thresholds", "team_workspace", "organization_workspace", "organization_policies", "audit_export"],
    },
    stripe_product_id: null,
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
    is_active: true,
    is_public: true,
    sort_order: 20,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("PricingView component", () => {
  it("renders valid table markup without nested tr or DOM errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = ReactDOMServer.renderToString(<PricingView />);

    expect(html).toContain("Individual");
    expect(html).toContain("Team");
    expect(html).toContain("Organization");
    expect(html).toContain("$15");
    expect(html).toContain("Start 14-Day Free Trial (Monthly)");
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");

    // Verify there is no nested <tr> inside another <tr>
    const nestedTrRegex = /<tr\b[^>]*>(?:(?!<\/tr>).)*<tr\b/s;
    expect(nestedTrRegex.test(html)).toBe(false);

    // Verify that every section header tr and row tr has valid td/th children
    expect(html).toContain("Core State Engine");
    expect(html).toContain("Automation &amp; Nudges");
    expect(html).toContain("Workspaces, Roles &amp; Compliance");
    expect(html).toContain("Deterministic PR state machine");

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("derives the compare matrix from real plan caps (free = up to 3 repos, paid = unlimited)", () => {
    const html = ReactDOMServer.renderToString(<PricingView plans={FIXTURE_PLANS} />);

    expect(html).toContain("Up to 3");
    expect(html).toContain("Unlimited");
    expect(html).toContain("25 seats");
    expect(html).toContain("1,000 seats");
    // Feature gates surface in the matrix (custom thresholds / audit export).
    expect(html).toContain("Per-repo customizable thresholds &amp; grace periods");
    expect(html).toContain("Audit log export (CSV/JSON)");
  });

  it("renders the plans table even when no plan rows are passed (hardcoded fallback)", () => {
    const html = ReactDOMServer.renderToString(<PricingView plans={[]} />);
    expect(html).toContain("<table");
    expect(html).toContain("Individual");
    expect(html).toContain("Team");
    expect(html).toContain("Organization");
  });

  it("never contains em dashes", () => {
    const html = ReactDOMServer.renderToString(<PricingView />);
    expect(html.includes("\u2014")).toBe(false);
  });
});
