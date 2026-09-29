import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  processStripeEvent,
  stripeEventTypeSupported,
} from "./stripe-webhooks";

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn() })) })),
      insert: vi.fn(async () => ({ error: null })),
    })),
  })),
}));

vi.mock("./subscriptions", () => ({
  getSubscriptionByProviderSubId: vi.fn(),
  getSubscriptionById: vi.fn(async () => ({
    id: "sub-1",
    user_id: "user-1",
    plan_id: "plan-1",
    status: "pending",
  })),
  activateSubscription: vi.fn(async () => ({ id: "sub-1", status: "active" })),
  renewSubscription: vi.fn(async () => ({ id: "sub-1", status: "active" })),
  markPastDue: vi.fn(async () => ({ id: "sub-1", status: "past_due" })),
  markSubscriptionPaymentFailed: vi.fn(async () => ({ id: "sub-1", status: "payment_failed" })),
  completeCancellation: vi.fn(),
  expireSubscription: vi.fn(),
}));

vi.mock("./payments", () => ({
  getPaymentByCheckoutSessionId: vi.fn(async () => ({
    id: "pay-1",
    subscription_id: "sub-1",
    plan_id: "plan-1",
    status: "pending",
    amount: 1000,
    metadata: { interval: "monthly" },
  })),
  getPaymentById: vi.fn(),
  confirmPayment: vi.fn(async () => ({ id: "pay-1", status: "confirmed", paid_at: new Date().toISOString() })),
  createPayment: vi.fn(async () => ({ id: "pay-renewal", status: "confirmed" })),
  patchPayment: vi.fn(async () => ({})),
  periodForInterval: vi.fn((interval: "monthly" | "annual") => ({
    start: "2026-09-23T00:00:00.000Z",
    end: interval === "annual" ? "2027-09-23T00:00:00.000Z" : "2026-10-23T00:00:00.000Z",
  })),
  rejectPayment: vi.fn(async () => ({ id: "pay-1", status: "failed" })),
}));

vi.mock("./plans", () => ({
  getPlanById: vi.fn(async () => ({ id: "plan-1", slug: "team" })),
}));

vi.mock("./system-events", () => ({
  recordSystemEvent: vi.fn(async () => {}),
}));

import { activateSubscription, renewSubscription, markPastDue, markSubscriptionPaymentFailed } from "./subscriptions";
import { confirmPayment, patchPayment, rejectPayment, periodForInterval, createPayment } from "./payments";

const baseSession = (over: Record<string, unknown> = {}) =>
  ({
    id: "cs_test_abc",
    payment_status: "paid",
    metadata: { planId: "plan-1", subscriptionId: "sub-1", paymentId: "pay-1" },
    customer: "cus_123",
    subscription: "sub_stripe_1",
    payment_intent: "pi_123",
    invoice: "in_123",
    ...over,
  }) as unknown as Parameters<typeof processStripeEvent>[0]["data"]["object"];

/**
 * Stripe API version 2025-03-31 removed `period_start` / `period_end` from the
 * invoice object and moved them onto `lines.data[].period`, so both shapes are
 * exercised here.
 */
const baseInvoice = (over: Record<string, unknown> = {}) =>
  ({
    id: "in_123",
    subscription: "sub_stripe_1",
    customer: "cus_123",
    currency: "usd",
    amount_paid: 1000,
    payment_intent: "pi_123",
    period_start: 1729728000,
    period_end: 1732406400,
    lines: { data: [] },
    ...over,
  }) as unknown as Parameters<typeof processStripeEvent>[0]["data"]["object"];

type StripeEvent = Parameters<typeof processStripeEvent>[0];
const asEvent = (type: string, object: unknown): StripeEvent =>
  ({ type, data: { object } }) as StripeEvent;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripe-webhooks", () => {
  it("supports the documented event set", () => {
    expect(stripeEventTypeSupported("checkout.session.completed")).toBe(true);
    expect(stripeEventTypeSupported("invoice.paid")).toBe(true);
    expect(stripeEventTypeSupported("invoice.payment_failed")).toBe(true);
    expect(stripeEventTypeSupported("customer.subscription.updated")).toBe(true);
    expect(stripeEventTypeSupported("customer.subscription.deleted")).toBe(true);
    expect(stripeEventTypeSupported("customer.subscription.created")).toBe(true);
    expect(stripeEventTypeSupported("charge.succeeded")).toBe(false);
  });

  it("supports the delayed payment method events", () => {
    // A bank debit settles long after the customer left Checkout. Without
    // these the order would never activate, and a failure would never revoke.
    expect(stripeEventTypeSupported("checkout.session.async_payment_succeeded")).toBe(true);
    expect(stripeEventTypeSupported("checkout.session.async_payment_failed")).toBe(true);
  });

  it("confirm + activate a completed card checkout on a pending subscription", async () => {
    await processStripeEvent(asEvent("checkout.session.completed", baseSession()));
    expect(confirmPayment).toHaveBeenCalledWith("pay-1");
    expect(patchPayment).toHaveBeenCalledWith("pay-1", expect.objectContaining({ stripe_payment_intent_id: "pi_123" }));
    expect(activateSubscription).toHaveBeenCalledWith("sub-1", expect.objectContaining({ planId: "plan-1" }));
  });

  it("ignores checkout.session.completed with payment_status !== paid", async () => {
    await processStripeEvent(asEvent("checkout.session.completed", baseSession({ payment_status: "unpaid" })));
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("never activates a checkout whose payment was cancelled mid-flight", async () => {
    const { confirmPayment } = await import("./payments");
    (confirmPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "pay-1",
      status: "cancelled",
      paid_at: null,
    });
    await processStripeEvent(asEvent("checkout.session.completed", baseSession()));
    expect(confirmPayment).toHaveBeenCalledWith("pay-1");
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(patchPayment).not.toHaveBeenCalled();
  });

  it("activates a pending subscription on invoice.paid", async () => {
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "pending",
    });
    await processStripeEvent(asEvent("invoice.paid", baseInvoice()));
    expect(activateSubscription).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ providerSubscriptionId: "sub_stripe_1" }),
    );
  });

  it("renews an active subscription on invoice.paid", async () => {
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "active",
    });
    await processStripeEvent(asEvent("invoice.paid", baseInvoice()));
    expect(renewSubscription).toHaveBeenCalledWith("sub-1", expect.any(Object));
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("marks a pending subscription payment_failed on invoice.payment_failed", async () => {
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "pending",
    });
    await processStripeEvent(asEvent("invoice.payment_failed", baseInvoice({ status: "open" })));
    expect(markSubscriptionPaymentFailed).toHaveBeenCalledWith("sub-1", expect.objectContaining({ source: "stripe" }));
    expect(markPastDue).not.toHaveBeenCalled();
  });

  it("marks an active subscription past_due on invoice.payment_failed", async () => {
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "active",
    });
    await processStripeEvent(asEvent("invoice.payment_failed", baseInvoice({ status: "open" })));
    expect(markPastDue).toHaveBeenCalledWith("sub-1", expect.stringContaining("in_123"));
    expect(markSubscriptionPaymentFailed).not.toHaveBeenCalled();
  });

  it("grants a real paid window when Stripe omits the invoice period", async () => {
    // Stripe 2025-03-31 removed period_start/period_end from the invoice.
    // Falling back to `new Date()` for both ends made a subscription that was
    // either already expired or never expired at all.
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "pending",
    });
    await processStripeEvent(
      asEvent("invoice.paid", baseInvoice({ period_start: null, period_end: null })),
    );
    expect(activateSubscription).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        currentPeriodStart: "2026-09-23T00:00:00.000Z",
        currentPeriodEnd: "2026-10-23T00:00:00.000Z",
      }),
    );
  });

  it("never grants a zero-length or infinite paid window", async () => {
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "pending",
    });
    await processStripeEvent(
      asEvent("invoice.paid", baseInvoice({ period_start: null, period_end: null })),
    );
    const [, opts] = (activateSubscription as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    const start = Date.parse(opts.currentPeriodStart as string);
    const end = Date.parse(opts.currentPeriodEnd as string);
    expect(Number.isFinite(start)).toBe(true);
    expect(end).toBeGreaterThan(start);
  });

  it("derives an annual renewal window from the invoice line items", async () => {
    // The modern API keeps the period on lines.data[].period.
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "active",
    });
    const yearStart = Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000);
    const yearEnd = Math.floor(Date.parse("2027-01-01T00:00:00.000Z") / 1000);
    await processStripeEvent(
      asEvent(
        "invoice.paid",
        baseInvoice({
          period_start: null,
          period_end: null,
          lines: { data: [{ period: { start: yearStart, end: yearEnd } }] },
        }),
      ),
    );
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { interval: "annual" } }),
    );
    expect(renewSubscription).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ currentPeriodEnd: "2027-09-23T00:00:00.000Z" }),
    );
  });

  it("never mixes a supplied bound with one derived from now", async () => {
    // `periodForInterval` derives BOTH bounds from `now`, so filling in only a
    // missing end from that helper would stretch the window by however long ago
    // the real start was. Whichever bound Stripe sent has to be preserved and
    // the other reconstructed from it.
    const { getSubscriptionByProviderSubId } = await import("./subscriptions");
    (getSubscriptionByProviderSubId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub-1",
      user_id: "user-1",
      plan_id: "plan-1",
      status: "pending",
    });
    const startIso = "2024-01-10T00:00:00.000Z";
    await processStripeEvent(
      asEvent(
        "invoice.paid",
        baseInvoice({
          period_start: Math.floor(Date.parse(startIso) / 1000),
          period_end: null,
        }),
      ),
    );
    const [, opts] = (activateSubscription as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(opts.currentPeriodStart).toBe(startIso);
    // One month from the real start, not from now.
    expect(opts.currentPeriodEnd).toBe("2024-02-10T00:00:00.000Z");
  });

  it("activates a delayed payment once Stripe reports it succeeded", async () => {
    await processStripeEvent(
      asEvent("checkout.session.async_payment_succeeded", baseSession({ payment_status: "paid" })),
    );
    expect(confirmPayment).toHaveBeenCalledWith("pay-1");
    expect(activateSubscription).toHaveBeenCalledWith("sub-1", expect.any(Object));
  });

  it("revokes a delayed payment that Stripe reports failed", async () => {
    const { getPaymentById } = await import("./payments");
    (getPaymentById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "pay-1",
      status: "pending",
    });
    await processStripeEvent(
      asEvent(
        "checkout.session.async_payment_failed",
        baseSession({ payment_status: "unpaid" }),
      ),
    );
    expect(rejectPayment).toHaveBeenCalledWith("pay-1", expect.stringContaining("delayed payment"));
    expect(markSubscriptionPaymentFailed).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ source: "stripe" }),
    );
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(periodForInterval).not.toHaveBeenCalled();
  });
});