// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const m = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getEntitlement: vi.fn(),
  getCurrentSubscription: vi.fn(),
  listSubscriptionsForUser: vi.fn(),
  listPaymentsForUser: vi.fn(),
  findOpenPaymentForSubscription: vi.fn(),
  publicPlans: vi.fn(),
  listSubscriptionEvents: vi.fn(),
  billingPortalAvailability: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentUser: m.currentUser }));
vi.mock("@/lib/billing/entitlement", () => ({ getEntitlement: m.getEntitlement }));
vi.mock("@/lib/billing/subscriptions", () => ({
  getCurrentSubscription: m.getCurrentSubscription,
  listSubscriptionsForUser: m.listSubscriptionsForUser,
}));
vi.mock("@/lib/billing/payments", () => ({
  listPaymentsForUser: m.listPaymentsForUser,
  findOpenPaymentForSubscription: m.findOpenPaymentForSubscription,
}));
vi.mock("@/lib/billing/plans", () => ({ publicPlans: m.publicPlans }));
vi.mock("@/lib/billing/events", () => ({ listSubscriptionEvents: m.listSubscriptionEvents }));
vi.mock("@/lib/billing/billing-portal", () => ({ billingPortalAvailability: m.billingPortalAvailability }));

vi.mock("@/lib/i18n/server-t", () => ({
  getTranslatorForRequest: async () => {
    const { createTranslator, createCountTranslator } = await import("@/lib/i18n/translate");
    const { englishFlat } = await import("@/lib/i18n/bundles");
    const fmt = await import("@/lib/i18n/format");
    const bundles = { en: englishFlat() };
    const locale = "en";
    return {
      t: createTranslator(bundles, locale),
      tc: createCountTranslator(bundles, locale),
      locale,
      direction: "ltr",
      tag: "en",
      formatDate: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => fmt.formatDate(v, locale, o),
      formatDateTime: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => fmt.formatDateTime(v, locale, o),
      formatCurrency: (c: number, currency: string, o?: Intl.NumberFormatOptions) => fmt.formatCurrency(c, currency, locale, o),
      formatNumber: (v: number, o?: Intl.NumberFormatOptions) => fmt.formatNumber(v, locale, o),
    };
  },
}));

import BillingPage from "./page";
import { renderToStringWithI18n } from "@/lib/i18n/test-render";

const PLAN = {
  id: "plan-team", slug: "team", name: "Team", description: "For engineering teams.",
  monthly_price_cents: 1500, annual_price_cents: 15000, price_custom: false, currency: "USD",
  features: [], limits: {}, stripe_product_id: null, stripe_monthly_price_id: null,
  stripe_annual_price_id: null, is_active: true, is_public: true, sort_order: 10,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const PLAN2 = { ...PLAN, id: "plan-org", slug: "organization", name: "Organization", monthly_price_cents: 4900, annual_price_cents: 49000, sort_order: 20 };

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "sub-1", user_id: "user-1", plan_id: PLAN.id, status: "active",
    payment_provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "substripe_1",
    current_period_start: "2026-01-01T00:00:00.000Z", current_period_end: "2026-02-01T00:00:00.000Z",
    cancel_at_period_end: false, canceled_at: null, started_at: "2026-01-01T00:00:00.000Z", ended_at: null,
    payment_action_required: false, payment_action_reason: null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", plan: PLAN,
    ...over,
  };
}

function payment(over: Record<string, unknown> = {}) {
  return {
    id: "pay-1", user_id: "user-1", subscription_id: "sub-1", plan_id: PLAN.id,
    payment_provider: "usdc", payment_type: "initial_subscription", status: "pending",
    amount: 9600, currency: "USDC", stripe_payment_intent_id: null, stripe_checkout_session_id: null,
    stripe_invoice_id: null, crypto_network: "base", crypto_token: "USDC", crypto_wallet_address: "0xabc",
    crypto_expected_amount_onchain: "96000000", crypto_transaction_hash: null, failure_reason: null,
    metadata: { interval: "monthly" }, created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", paid_at: null, plan: PLAN, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "user-1", role: "user" });
  m.publicPlans.mockResolvedValue([PLAN, PLAN2]);
  m.billingPortalAvailability.mockResolvedValue({ available: true, reason: "ok", subscriptionId: "sub-1" });
  m.listSubscriptionEvents.mockResolvedValue([]);
  m.listSubscriptionsForUser.mockResolvedValue([]);
  m.findOpenPaymentForSubscription.mockResolvedValue(null);
  m.listPaymentsForUser.mockResolvedValue([]);
});

async function render() {
  return renderToStringWithI18n(await BillingPage());
}

describe("billing page states", () => {
  it("free / empty state", async () => {
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.getCurrentSubscription.mockResolvedValue(null);
    m.billingPortalAvailability.mockResolvedValue({ available: false, reason: "no_subscription", subscriptionId: null });
    const html = await render();
    expect(html).toContain("Individual Free");
  });

  it("gifted subscription", async () => {
    const s = sub({ payment_provider: "gift", provider_subscription_id: null, provider_customer_id: null });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    const html = await render();
    expect(html).toContain("Team");
  });

  it("action required", async () => {
    const s = sub({ payment_action_required: true, payment_action_reason: "Card declined" });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    const html = await render();
    expect(html).toContain("Card declined");
  });

  it("cancellation requested", async () => {
    const s = sub({ cancel_at_period_end: true });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    const html = await render();
    expect(html).toContain("Team");
  });

  it("active_until_period_end", async () => {
    const s = sub({ status: "active_until_period_end", cancel_at_period_end: true });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    const html = await render();
    expect(html).toContain("Team");
  });

  it("payment_failed current subscription", async () => {
    const s = sub({ status: "payment_failed" });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.getCurrentSubscription.mockResolvedValue(null);
    m.listSubscriptionsForUser.mockResolvedValue([s]);
    m.findOpenPaymentForSubscription.mockResolvedValue(payment({ status: "failed" }));
    const html = await render();
    expect(html).toContain("Team");
  });

  it("pending usdc with crypto_network null", async () => {
    const pending = sub({ id: "sub-p", status: "pending", payment_provider: "usdc" });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.getCurrentSubscription.mockResolvedValue(null);
    m.listSubscriptionsForUser.mockResolvedValue([pending]);
    m.findOpenPaymentForSubscription.mockResolvedValue(payment({ crypto_network: null }));
    const html = await render();
    expect(html).toContain("Team");
  });

  it("pending usdc with crypto_network empty string", async () => {
    const pending = sub({ id: "sub-p", status: "pending", payment_provider: "usdc" });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.getCurrentSubscription.mockResolvedValue(null);
    m.listSubscriptionsForUser.mockResolvedValue([pending]);
    m.findOpenPaymentForSubscription.mockResolvedValue(payment({ crypto_network: "" }));
    const html = await render();
    expect(html).toContain("Team");
  });

  it("active usdc subscription (renew button)", async () => {
    const s = sub({ payment_provider: "usdc", provider_subscription_id: null });
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    m.billingPortalAvailability.mockResolvedValue({ available: false, reason: "not_stripe", subscriptionId: s.id });
    const html = await render();
    expect(html).toContain("Team");
  });

  it("history with empty-string network", async () => {
    const s = sub();
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.getCurrentSubscription.mockResolvedValue(s);
    m.listPaymentsForUser.mockResolvedValue([payment({ status: "confirmed", crypto_network: "" })]);
    const html = await render();
    expect(html).toContain("Team");
  });
});

describe("billing store outage", () => {
  // The billing store is a separate service (Supabase). When a read to it fails
  // (the production symptom was `payments.list failed: TypeError: fetch failed`),
  // the page must degrade to an explicit notice instead of a fatal server error
  // that replaces the entire dashboard with the generic error boundary.
  it("renders a notice instead of throwing when the store is unreachable", async () => {
    const outage = new Error("payments.list failed: TypeError: fetch failed");
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.listPaymentsForUser.mockRejectedValue(outage);
    m.listSubscriptionEvents.mockRejectedValue(outage);
    m.getCurrentSubscription.mockRejectedValue(outage);
    m.listSubscriptionsForUser.mockRejectedValue(outage);
    m.billingPortalAvailability.mockRejectedValue(outage);

    const html = await render();

    expect(html).toContain("Billing details are temporarily unavailable");
    expect(html).not.toContain("Technical details");
  });

  it("keeps an available plan visible while the store is down", async () => {
    const outage = new Error("payments.list failed: TypeError: fetch failed");
    const s = sub();
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: true, subscription: s });
    m.listPaymentsForUser.mockRejectedValue(outage);
    m.listSubscriptionEvents.mockRejectedValue(outage);
    m.getCurrentSubscription.mockRejectedValue(outage);
    m.listSubscriptionsForUser.mockRejectedValue(outage);
    m.billingPortalAvailability.mockRejectedValue(outage);

    const html = await render();

    // The plan comes from the entitlement that was already resolved, so the
    // customer still sees what they are on despite the history being unreadable.
    expect(html).toContain("Team");
    expect(html).toContain("Billing details are temporarily unavailable");
  });

  it("does not show the notice when the store reads succeed", async () => {
    m.getEntitlement.mockResolvedValue({ hasPaidAccess: false, subscription: null });
    m.getCurrentSubscription.mockResolvedValue(null);

    const html = await render();

    expect(html).not.toContain("Billing details are temporarily unavailable");
  });
});
