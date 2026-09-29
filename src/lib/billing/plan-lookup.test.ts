import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

import { getPlanById, getPlanBySlug, DEFAULT_PLANS } from "./plans";

/**
 * The `plans` table is the runtime source of truth for what a customer is
 * charged. The seed catalog is only a legitimate fallback when the table
 * genuinely holds no row.
 *
 * The bug this guards: `getPlanById` treated "the query failed" and "no such
 * plan" identically and returned the seed row for both. A Supabase outage
 * therefore let checkout price a real purchase from hardcoded catalog amounts
 * instead of the admin-edited plan row, so a customer could be quoted and
 * charged a price the database never agreed to. A failed read must fail closed.
 */
describe("plan lookup fails closed when the plans table is unreachable", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
  });

  it("returns null when the query errors rather than the seed price", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    await expect(getPlanById("plan_team_default")).resolves.toBeNull();
    await expect(getPlanBySlug("team")).resolves.toBeNull();
  });

  it("returns null when the client throws", async () => {
    maybeSingle.mockRejectedValue(new Error("fetch failed"));

    await expect(getPlanById("plan_team_default")).resolves.toBeNull();
  });

  it("falls back to the seed catalog only when the table genuinely has no row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const plan = await getPlanById("plan_team_default");
    expect(plan?.monthly_price_cents).toBe(1500);
    expect(plan?.annual_price_cents).toBe(15000);

    const org = await getPlanBySlug("organization");
    expect(org?.monthly_price_cents).toBe(4900);
    expect(org?.annual_price_cents).toBe(49000);
  });

  it("prefers the stored row over the seed catalog when both exist", async () => {
    // An admin raises Team to $20/month. Checkout must charge $20, not the
    // catalog's $15, which is the whole point of the table being the source of
    // truth.
    maybeSingle.mockResolvedValue({
      data: {
        id: "plan_team_default",
        slug: "team",
        name: "Team",
        description: "Stored description",
        monthly_price_cents: 2000,
        annual_price_cents: 20000,
        price_custom: false,
        currency: "USD",
        features: [],
        limits: {},
        stripe_product_id: null,
        stripe_monthly_price_id: null,
        stripe_annual_price_id: null,
        is_active: true,
        is_public: true,
        sort_order: 10,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const plan = await getPlanById("plan_team_default");
    expect(plan?.monthly_price_cents).toBe(2000);
    expect(plan?.monthly_price_cents).not.toBe(
      DEFAULT_PLANS.find((p) => p.slug === "team")!.monthly_price_cents,
    );
  });

  it("returns null for an unknown plan instead of inventing one", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(getPlanById("plan_does_not_exist")).resolves.toBeNull();
  });
});
