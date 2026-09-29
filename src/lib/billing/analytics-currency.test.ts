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
 * Every payment row is stored in 2-decimal minor units, USDC included: the
 * checkout route prices an order with `planPriceCents` regardless of provider,
 * and `amounts.ts` converts the 6-decimal on-chain value down to the same
 * scale before persisting. Summing them into one "total revenue in USD"
 * figure would still be wrong, so totals are bucketed per currency and never
 * combined.
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
      { status: "confirmed", payment_provider: "usdc", amount: 4_900, currency: "USDC" },
    );
    const agg = await confirmedPaymentAggregates();
    expect(agg.byCurrency.USD).toEqual({ count: 2, amountMinor: 16500 });
    expect(agg.byCurrency.USDC).toEqual({ count: 1, amountMinor: 4_900 });
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
      { status: "confirmed", payment_provider: "usdc", amount: 4_900, currency: "USDC" },
    );
    const agg = await confirmedPaymentAggregates();
    expect(agg.byProvider.stripe).toEqual({ count: 1, amountMinor: 1500 });
    expect(agg.byProvider.usdc).toEqual({ count: 1, amountMinor: 4_900 });
  });
});

describe("currency totals render in their own currency", () => {
  it("formats USD cents with two decimals", () => {
    expect(formatCurrencyTotal("USD", 1500)).toBe("USD 15.00");
    expect(formatCurrencyTotal("USD", 15000)).toBe("USD 150.00");
  });

  it("formats a real USDC order as its true face value", () => {
    // A paid Organization order is 4_900 minor units, i.e. 49 USDC. Rendering
    // it with 6 decimals reported "USDC 0.004900" on the admin dashboard.
    expect(formatCurrencyTotal("USDC", 4_900)).toBe("USDC 49.00");
    expect(formatCurrencyTotal("USDC", 1_500)).toBe("USDC 15.00");
    expect(formatCurrencyTotal("USDC", 49_000)).toBe("USDC 490.00");
  });

  it("accepts a lowercase currency code", () => {
    expect(formatCurrencyTotal("usd", 1500)).toBe("USD 15.00");
  });
});
