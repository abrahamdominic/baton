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
  periodForInterval: vi.fn(() => ({ start: "2026-09-23T00:00:00.000Z", end: "2026-10-23T00:00:00.000Z" })),
}));

vi.mock("./plans", () => ({
  getPlanById: vi.fn(async () => ({ id: "plan-1", slug: "team" })),
}));

vi.mock("./system-events", () => ({
  recordSystemEvent: vi.fn(async () => {}),
}));

import { activateSubscription, renewSubscription, markPastDue, markSubscriptionPaymentFailed } from "./subscriptions";
import { confirmPayment, patchPayment } from "./payments";

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
    (confirmPayment as ReturnType<typeof vi.fn>).mockResolvedValue({
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
});