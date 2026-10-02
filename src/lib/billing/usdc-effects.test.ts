import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The double-credit guard.
 *
 * Confirming a payment and extending the subscription it paid for are two
 * writes, so a crash or a concurrent request between them used to be ambiguous:
 * re-running the verification could extend the subscription a second time,
 * granting a paid period for one transfer. (And the mirror failure is worse — a
 * confirm that committed while the process died left a paying customer on the
 * free plan with no path back, because every later run saw `status = confirmed`
 * and did nothing.)
 *
 * Two independent guards, matching the two failure modes:
 *   - the conditional UPDATE in `confirmPayment` decides which caller owns the
 *     effect, so concurrent verifications cannot both apply it;
 *   - the subscription event ledger lets a later run repair a payment that was
 *     confirmed but never applied, while recognising one that already was.
 */

const paymentRows: Record<string, any> = {
  "pay-1": {
    id: "pay-1",
    user_id: "user-1",
    plan_id: "plan_pro",
    subscription_id: "sub-1",
    payment_provider: "usdc",
    payment_type: "subscription",
    status: "pending_verification",
    amount: 1500,
    currency: "usd",
    metadata: { interval: "monthly" },
    crypto_network: "base",
    crypto_token: "USDC",
    crypto_wallet_address: "0xwallet",
    crypto_expected_amount_onchain: "1500037",
    crypto_transaction_hash: "0x" + "a".repeat(63) + "1",
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_invoice_id: null,
    failure_reason: null,
    paid_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
};

const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const activate = vi.hoisted(() => vi.fn(async () => {}));
const renew = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/billing/subscriptions", () => ({
  getSubscriptionById: vi.fn(async () => ({
    id: "sub-1",
    status: "pending",
    plan_id: "plan_pro",
  })),
  activateSubscription: activate,
  renewSubscription: renew,
  markSubscriptionPaymentFailed: vi.fn(async () => {}),
}));

vi.mock("@/lib/billing/plans", () => ({
  getPlanById: vi.fn(async () => null),
  getPurchasablePlanById: vi.fn(async () => null),
}));

vi.mock("@/lib/billing/events", () => ({
  // A subscription event carrying this payment id is the record that the effect
  // landed. `activate`/`renew` are what writes it in production.
  hasSubscriptionEventForPayment: vi.fn(async (paymentId: string) =>
    events.some((e) => e.paymentId === paymentId),
  ),
  recordSubscriptionEvent: vi.fn(async (e: Record<string, unknown>) => {
    events.push(e);
  }),
}));

vi.mock("@/lib/billing/system-events", () => ({ recordSystemEvent: vi.fn(async () => {}) }));

vi.mock("@/lib/config", () => ({
  usdcSettings: () => ({
    network: "base",
    token: "USDC",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://rpc.test",
    walletAddress: "0xbA7on0000000000000000000000000000000000AA",
    minConfirmations: 12,
  }),
  isSupabaseConfigured: () => true,
  getConfig: () => ({}),
}));

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "payments") throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({ data: { ...paymentRows["pay-1"] }, error: null }),
          };
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            },
            in: (column: string, values: unknown[]) => {
              filters.push([column, values]);
              return chain;
            },
            select: () => chain,
            maybeSingle: async () => {
              const stored = paymentRows["pay-1"] as Record<string, unknown>;
              const matched = filters.every(([column, value]) =>
                Array.isArray(value)
                  ? value.includes(stored[column])
                  : stored[column] === value,
              );
              // A conditional update that matched nothing returns no row — the
              // caller has to treat that as "somebody else got there first".
              if (!matched) return { data: null, error: null };
              Object.assign(stored, patch);
              return { data: { ...stored }, error: null };
            },
          };
          return chain;
        },
      };
    },
  }),
}));

import { confirmPayment, verifyUsdcPaymentNow } from "./payments";

beforeEach(() => {
  events.length = 0;
  activate.mockClear();
  renew.mockClear();
  const row = paymentRows["pay-1"] as Record<string, unknown>;
  row.status = "pending_verification";
  row.paid_at = null;
});

describe("confirmPayment claims the effect", () => {
  it("confirms an open payment and hands the effect to that caller", async () => {
    const { payment, claimed } = await confirmPayment("pay-1");
    expect(claimed).toBe(true);
    expect(payment.status).toBe("confirmed");
  });

  /**
   * The double-credit path. Stripe's webhook handler and the USDC verifier — or
   * two deliveries of the same webhook — can both arrive for one payment. The
   * second conditional update matches nothing because the row is no longer in an
   * open state, so it is told `claimed: false` and must not apply the effect.
   */
  it("tells the loser of a concurrent confirm that it does not own the effect", async () => {
    const first = await confirmPayment("pay-1");
    const second = await confirmPayment("pay-1");

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    // Both see the confirmed row, so a caller that re-reads can still render
    // success — but only the first may grant access.
    expect(second.payment.status).toBe("confirmed");
  });

  it("does not let a cancelled payment be confirmed", async () => {
    (paymentRows["pay-1"] as Record<string, unknown>).status = "cancelled";
    const { payment, claimed } = await confirmPayment("pay-1");
    expect(claimed).toBe(false);
    expect(payment.status).toBe("cancelled");
  });
});

/**
 * Re-verifying an already-confirmed payment is the interesting path, because it
 * is the only one that can apply an effect without a fresh confirm. It has to be
 * able to repair, and it has to be unable to double-credit — the ledger is the
 * only thing telling those two apart.
 */
describe("re-verifying a confirmed payment", () => {
  it("repairs a payment that was confirmed but whose effect never landed", async () => {
    // A process that died between the confirm and the effect: the row is
    // confirmed, and no event was ever recorded for it. A paying customer left
    // on the free plan has to be able to recover without support.
    (paymentRows["pay-1"] as Record<string, unknown>).status = "confirmed";

    const outcome = await verifyUsdcPaymentNow("pay-1");

    expect(outcome.ok).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("does not grant a second period when the effect already landed", async () => {
    // Same row, but the ledger records the subscription event for this payment:
    // whoever confirmed it also applied it. Re-verifying is a no-op, because
    // extending the period again would hand out paid time for one transfer.
    (paymentRows["pay-1"] as Record<string, unknown>).status = "confirmed";
    events.push({ paymentId: "pay-1" });

    const outcome = await verifyUsdcPaymentNow("pay-1");

    expect(outcome.ok).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
  });

  it("renews rather than activates when the subscription is already live", async () => {
    const subs = await import("@/lib/billing/subscriptions");
    (subs.getSubscriptionById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1",
      status: "active",
      plan_id: "plan_pro",
    });
    (paymentRows["pay-1"] as Record<string, unknown>).status = "confirmed";

    await verifyUsdcPaymentNow("pay-1");

    expect(renew).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });
});
