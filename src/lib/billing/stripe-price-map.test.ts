import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  priceIndexFromPlans,
  subscriptionPriceIds,
  resolveSubscriptionPlan,
  classifyPlanChange,
  intervalFromPeriod,
} from "./stripe-price-map";
import type { PlanRecord } from "./types";
import type Stripe from "stripe";

function plan(over: Partial<PlanRecord> & { id: string; slug: string }): PlanRecord {
  return {
    name: over.slug,
    description: null,
    monthly_price_cents: 1000,
    annual_price_cents: 10_000,
    price_custom: false,
    currency: "usd",
    features: [],
    limits: {},
    stripe_product_id: null,
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
    is_active: true,
    is_public: true,
    sort_order: 0,
    ...over,
  } as PlanRecord;
}

const FREE = plan({ id: "p_free", slug: "free", monthly_price_cents: 0, annual_price_cents: 0 });
const PRO = plan({
  id: "p_pro",
  slug: "pro",
  monthly_price_cents: 2000,
  annual_price_cents: 20_000,
  stripe_monthly_price_id: "price_pro_m",
  stripe_annual_price_id: "price_pro_a",
});
const TEAM = plan({
  id: "p_team",
  slug: "team",
  monthly_price_cents: 6000,
  annual_price_cents: 60_000,
  stripe_monthly_price_id: "price_team_m",
  stripe_annual_price_id: "price_team_a",
});

function stripeSub(priceIds: (string | null)[], quantity = 1): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    items: {
      data: priceIds.map((id) => ({
        id: `si_${id}`,
        quantity,
        price: id ? { id } : undefined,
      })),
    },
  } as unknown as Stripe.Subscription;
}

describe("priceIndexFromPlans", () => {
  it("maps every configured price to its plan and interval", () => {
    const { index } = priceIndexFromPlans([FREE, PRO, TEAM]);
    expect(index.get("price_pro_m")).toMatchObject({ planId: "p_pro", interval: "monthly" });
    expect(index.get("price_team_a")).toMatchObject({ planId: "p_team", interval: "annual" });
    expect(index.size).toBe(4);
  });

  it("ignores plans with no Stripe prices", () => {
    const { index } = priceIndexFromPlans([FREE]);
    expect(index.size).toBe(0);
  });

  it("reports a price configured on two plans instead of picking one silently", () => {
    // Iterating two plans with the same price id would otherwise make
    // entitlement depend on which row came back first.
    const a = plan({ id: "p_a", slug: "a", stripe_monthly_price_id: "price_shared" });
    const b = plan({ id: "p_b", slug: "b", stripe_monthly_price_id: "price_shared" });
    const { index, duplicatePriceIds } = priceIndexFromPlans([a, b]);
    expect(duplicatePriceIds).toEqual(["price_shared"]);
    expect(index.get("price_shared")?.planId).toBe("p_a");
  });
});

describe("subscriptionPriceIds", () => {
  it("reads attached prices", () => {
    expect(subscriptionPriceIds(stripeSub(["price_pro_m"]))).toEqual(["price_pro_m"]);
  });

  it("skips zero-quantity items so a scheduled downgrade does not flip entitlement early", () => {
    // Stripe models a downgrade that takes effect next period by attaching the
    // new price at quantity 0. Reading it as active would revoke the paid plan
    // the moment the user cancels, before they were ever charged for it.
    expect(subscriptionPriceIds(stripeSub(["price_pro_m", "price_team_m"], 0))).toEqual([]);
  });

  it("falls back to the legacy plan shape when items are empty", () => {
    const legacy = {
      id: "sub_1",
      status: "active",
      items: { data: [] },
      plan: { price: { id: "price_legacy" } },
    } as unknown as Stripe.Subscription;
    expect(subscriptionPriceIds(legacy)).toEqual(["price_legacy"]);
  });
});

describe("resolveSubscriptionPlan", () => {
  const { index } = priceIndexFromPlans([FREE, PRO, TEAM]);

  it("resolves the plan a subscription is paying for", () => {
    const resolved = resolveSubscriptionPlan(stripeSub(["price_team_a"]), index);
    expect(resolved?.binding).toMatchObject({ planId: "p_team", interval: "annual" });
    expect(resolved?.ambiguous).toBe(false);
  });

  it("returns null when no price maps to a plan", () => {
    expect(resolveSubscriptionPlan(stripeSub(["price_unknown"]), index)).toBeNull();
  });

  it("takes the highest billable price when several are attached", () => {
    // Mid-proration both the old and new price can be on the subscription; the
    // more expensive one is the one being charged.
    const resolved = resolveSubscriptionPlan(stripeSub(["price_pro_m", "price_team_m"]), index);
    expect(resolved?.binding.planId).toBe("p_team");
    expect(resolved?.ambiguous).toBe(true);
  });

  it("compares an annual price against a monthly one on what the user pays", () => {
    // pro annual ($200/yr = $16.67/mo) vs team monthly ($60/mo). Ranking these on
    // raw cents picks pro annual because 20000 > 6000, and grants the cheaper
    // plan to a customer being charged the more expensive one.
    const resolved = resolveSubscriptionPlan(stripeSub(["price_pro_a", "price_team_m"]), index);
    expect(resolved?.binding.planId).toBe("p_team");
  });
});

describe("classifyPlanChange", () => {
  const pro = { monthlyCents: 2000, annualCents: 20_000 };
  const team = { monthlyCents: 6000, annualCents: 60_000 };

  it("detects a straight upgrade and downgrade", () => {
    expect(classifyPlanChange(pro, team, "monthly", "monthly")).toBe("upgrade");
    expect(classifyPlanChange(team, pro, "monthly", "monthly")).toBe("downgrade");
  });

  it("treats a monthly-to-annual switch on the same plan as an upgrade", () => {
    // $20/mo -> $200/yr works out to $16.67/mo, so comparing the per-month
    // figures alone calls this a downgrade. The interval is the deciding signal
    // here: the customer moved to a longer term at a discount.
    expect(classifyPlanChange(pro, pro, "monthly", "annual")).toBe("upgrade");
  });

  it("treats dropping back to monthly on the same plan as a downgrade", () => {
    expect(classifyPlanChange(pro, pro, "annual", "monthly")).toBe("downgrade");
  });

  it("still uses money when the plan and the interval both change", () => {
    // pro annual ($16.67/mo equivalent) -> team monthly ($60/mo): a real upgrade,
    // and the interval rule must not hijack it.
    expect(classifyPlanChange(pro, team, "annual", "monthly")).toBe("upgrade");
    expect(classifyPlanChange(team, pro, "annual", "monthly")).toBe("downgrade");
  });

  it("calls a move between two plans at the same price lateral", () => {
    const a = { monthlyCents: 3000, annualCents: 30_000 };
    const b = { monthlyCents: 3000, annualCents: 30_000 };
    expect(classifyPlanChange(a, b, "monthly", "monthly")).toBe("lateral");
  });
});

describe("intervalFromPeriod", () => {
  it("reads an annual window as annual", () => {
    expect(intervalFromPeriod("2026-01-01T00:00:00.000Z", "2026-12-31T00:00:00.000Z")).toBe("annual");
  });

  it("reads a monthly window as monthly", () => {
    expect(intervalFromPeriod("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")).toBe("monthly");
  });

  it("falls back to monthly when the window is missing or nonsensical", () => {
    // Over-granting a year of access from a missing bound is the expensive
    // direction to be wrong in.
    expect(intervalFromPeriod(null, null)).toBe("monthly");
    expect(intervalFromPeriod("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe("monthly");
    expect(intervalFromPeriod("2026-01-01T00:00:00.000Z", "not-a-date")).toBe("monthly");
  });
});
