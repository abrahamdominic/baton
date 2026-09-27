import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DEFAULT_PLANS } from "./plans";
import { planPriceCents, annualFromMonthly, annualSavingsCents, planBillingNote } from "./pricing";
import { formatMoney, minorToUsdcOnchain, usdcOnchainToMinor } from "./amounts";
import { planOf } from "./test-fixtures";
import type { Cents } from "./types";

/**
 * Billing matrix from the pricing spec. Every row is asserted across the whole
 * chain: what the pricing page shows, what checkout charges, what the USDC
 * on-chain transfer must be, and what the server independently expects.
 *
 * If a row ever drifts, this fails rather than silently charging the wrong
 * amount.
 */
const MATRIX = [
  { slug: "team", interval: "monthly", cents: 1500, display: "$15.00", per: "month" },
  { slug: "team", interval: "annual", cents: 15000, display: "$150.00", per: "year" },
  { slug: "organization", interval: "monthly", cents: 4900, display: "$49.00", per: "month" },
  { slug: "organization", interval: "annual", cents: 49000, display: "$490.00", per: "year" },
] as const;

describe("billing matrix: canonical prices", () => {
  it.each(MATRIX)("$slug $interval is $display", ({ slug, interval, cents }) => {
    expect(planPriceCents(planOf(slug), interval)).toBe(cents);
  });

  it("uses the same four prices in the plan catalog that the pricing page reads", () => {
    const team = DEFAULT_PLANS.find((p) => p.slug === "team")!;
    const org = DEFAULT_PLANS.find((p) => p.slug === "organization")!;
    expect([
      team.monthly_price_cents,
      team.annual_price_cents,
      org.monthly_price_cents,
      org.annual_price_cents,
    ]).toEqual([1500, 15000, 4900, 49000]);
  });
});

describe("billing matrix: display", () => {
  it.each(MATRIX)("$slug $interval renders as $display", ({ cents, display }) => {
    expect(formatMoney(cents, "USD")).toBe(display);
  });

  it.each(MATRIX)("$slug $interval renders correctly for USDC", ({ cents, display }) => {
    expect(formatMoney(cents, "USDC")).toBe(`${display} USDC`);
  });

  it("annual prices are exactly ten monthly periods (two months free)", () => {
    expect(annualFromMonthly(1500)).toBe(15000);
    expect(annualFromMonthly(4900)).toBe(49000);
  });
});

describe("annual savings are communicated accurately", () => {
  it("Team saves $30/year", () => {
    expect(annualSavingsCents(planOf("team"))).toBe(3000);
    expect(formatMoney(annualSavingsCents(planOf("team")), "USD")).toBe("$30.00");
  });

  it("Organization saves $98/year", () => {
    expect(annualSavingsCents(planOf("organization"))).toBe(9800);
    expect(formatMoney(annualSavingsCents(planOf("organization")), "USD")).toBe("$98.00");
  });

  it("never reports a negative saving for a discounted or custom plan", () => {
    expect(annualSavingsCents(planOf("team"))).toBeGreaterThan(0);
    expect(annualSavingsCents(planOf("organization"))).toBeGreaterThan(0);
  });
});

describe("billing matrix: USDC on-chain amounts", () => {
  it.each(MATRIX)("$slug $interval settles as the exact on-chain USDC amount", ({ cents }) => {
    const onchain = minorToUsdcOnchain(cents as Cents);
    // 6 on-chain decimals, so $15.00 is 15_000_000 base units.
    expect(Number.isSafeInteger(onchain)).toBe(true);
    expect(onchain).toBe(cents * 10_000);
  });

  it("round-trips every matrix amount without drift", () => {
    for (const row of MATRIX) {
      const onchain = minorToUsdcOnchain(row.cents as Cents);
      expect(usdcOnchainToMinor(onchain)).toBe(row.cents);
    }
  });

  it("rejects a sub-cent transfer so it can never satisfy an exact plan price", () => {
    expect(() => usdcOnchainToMinor(15_000_001)).toThrow(/non-decimal-cent transfer/);
  });
});

describe("billing matrix: interval is part of the priced key", () => {
  it("resolves a distinct amount for each of the four combinations", () => {
    const amounts = new Set(MATRIX.map((r) => planPriceCents(planOf(r.slug), r.interval)));
    expect(amounts.size).toBe(4);
  });

  it("rejects an unknown interval rather than defaulting to a cheaper charge", () => {
    expect(() => planPriceCents(planOf("team"), "weekly" as never)).toThrow(/invalid billing interval/);
  });
});

describe("annual savings claim is derived, not hardcoded copy", () => {
  it("Team's annual note states the $30 saving", () => {
    expect(planBillingNote(planOf("team"), "annual")).toBe(
      "Billed annually at $150/year (save $30/year)",
    );
  });

  it("Organization's annual note states the $98 saving", () => {
    expect(planBillingNote(planOf("organization"), "annual")).toBe(
      "Billed annually at $490/year (save $98/year)",
    );
  });

  it("monthly notes carry the charged amount", () => {
    expect(planBillingNote(planOf("team"), "monthly")).toBe("Billed monthly at $15/month");
    expect(planBillingNote(planOf("organization"), "monthly")).toBe("Billed monthly at $49/month");
  });

  it("omits the saving entirely for a plan with no discount", () => {
    const noDiscount = { ...planOf("team"), annual_price_cents: 15_000 * 2 };
    expect(annualSavingsCents(noDiscount)).toBe(0);
    expect(planBillingNote(noDiscount, "annual")).toBe("Billed annually at $300/year");
  });

  it("never claims a saving on a custom-priced plan", () => {
    const custom = { ...planOf("team"), price_custom: true };
    expect(annualSavingsCents(custom)).toBe(0);
    expect(planBillingNote(custom, "annual")).toBe("Custom pricing. Contact us to get started.");
  });

  it("rejects an unknown interval instead of falling back to a note", () => {
    expect(() => planBillingNote(planOf("team"), "lifetime" as never)).toThrow(
      /invalid billing interval/,
    );
  });
});
