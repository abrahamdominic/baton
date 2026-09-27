import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

// The admin client is stubbed so the aggregation can be exercised over a fixed
// payment ledger without a database.
const payments: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: payments, error: null }),
    }),
  }),
}));

import { confirmedPaymentAggregates, formatCurrencyTotal } from "./analytics";

/**
 * USDC payments are recorded in USDC minor units (6 decimals) while card
 * payments are USD cents (2 decimals). Summing them into one "total revenue in
 * USD" figure reported a fabricated number on the admin overview, so totals are
 * bucketed per currency and never combined.
 */
function reset() {
  payments.length = 0;
}

describe("confirmed payment totals never mix currencies", () => {
  it("buckets confirmed totals by currency", async () => {
    reset();
    payments.push(
      { status: "confirmed", payment_provider: "stripe", amount: 1500, currency: "USD" },
      { status: "confirmed", payment_provider: "stripe", amount: 15000, currency: "USD" },
      { status: "confirmed", payment_provider: "usdc", amount: 4_900_000, currency: "USDC" },
    );
    const agg = await confirmedPaymentAggregates();
    expect(agg.byCurrency.USD).toEqual({ count: 2, amountMinor: 16500 });
    expect(agg.byCurrency.USDC).toEqual({ count: 1, amountMinor: 4_900_000 });
    // There is deliberately no combined total to render as a single USD figure.
    expect(Object.keys(agg).sort()).toEqual([
      "byCurrency",
      "byProvider",
      "byStatus",
      "totalRows",
    ]);
  });

  it("excludes non-confirmed payments from every total", async () => {
    reset();
    payments.push(
      { status: "confirmed", payment_provider: "stripe", amount: 1500, currency: "USD" },
      { status: "pending", payment_provider: "stripe", amount: 4900, currency: "USD" },
      { status: "failed", payment_provider: "usdc", amount: 123, currency: "USDC" },
      { status: "refunded", payment_provider: "stripe", amount: 15000, currency: "USD" },
    );
    const agg = await confirmedPaymentAggregates();
    expect(agg.byCurrency.USD).toEqual({ count: 1, amountMinor: 1500 });
    expect(agg.byCurrency.USDC).toBeUndefined();
    expect(agg.byStatus.pending).toBe(1);
    expect(agg.byStatus.failed).toBe(1);
    expect(agg.byStatus.refunded).toBe(1);
    expect(agg.totalRows).toBe(4);
  });

  it("defaults a missing currency to USD rather than dropping the row", async () => {
    reset();
    payments.push({ status: "confirmed", payment_provider: "stripe", amount: 1500 });
    const agg = await confirmedPaymentAggregates();
    expect(agg.byCurrency.USD).toEqual({ count: 1, amountMinor: 1500 });
  });

  it("keeps provider totals separate too", async () => {
    reset();
    payments.push(
      { status: "confirmed", payment_provider: "stripe", amount: 1500, currency: "USD" },
      { status: "confirmed", payment_provider: "usdc", amount: 4_900_000, currency: "USDC" },
    );
    const agg = await confirmedPaymentAggregates();
    expect(agg.byProvider.stripe).toEqual({ count: 1, amountMinor: 1500 });
    expect(agg.byProvider.usdc).toEqual({ count: 1, amountMinor: 4_900_000 });
  });
});

describe("currency totals render in their own currency", () => {
  it("formats USD cents with two decimals", () => {
    expect(formatCurrencyTotal("USD", 1500)).toBe("USD 15.00");
    expect(formatCurrencyTotal("USD", 15000)).toBe("USD 150.00");
  });

  it("formats USDC with six decimals", () => {
    // 4_900_000 USDC minor units is 4.9 USDC, not $49,000.
    expect(formatCurrencyTotal("USDC", 4_900_000)).toBe("USDC 4.900000");
  });

  it("accepts a lowercase currency code", () => {
    expect(formatCurrencyTotal("usd", 1500)).toBe("USD 15.00");
  });
});
