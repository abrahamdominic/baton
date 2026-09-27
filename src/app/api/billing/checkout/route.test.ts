import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

/**
 * Checkout-route security tests.
 *
 * The point of these is to prove the charged amount is derived on the server
 * from the stored plan row, so no client-supplied field can change what a
 * customer is billed or which plan they end up on.
 */

const state = vi.hoisted(() => ({
  user: { id: "user-1", suspendedAt: null } as Record<string, unknown> | null,
  stripeConfigured: true,
  usdcConfigured: true,
  prepared: { subscription: { id: "sub-1" }, alreadyOnPlan: false, renewal: false } as Record<string, unknown>,
  stripePayment: { id: "pay-1" },
  usdcPayment: {
    id: "pay-2",
    amount: 1500,
    crypto_wallet_address: "0xwallet",
    crypto_network: "base",
    crypto_token: "USDC",
  },
  /** Every amount the route asked the payment layer to charge. */
  charged: [] as number[],
  intervals: [] as string[],
  sessions: [] as number[],
}));

const plan = vi.hoisted(() => ({
  id: "plan_team_default",
  slug: "team",
  name: "Team",
  is_active: true,
  price_custom: false,
  monthly_price_cents: 1500,
  annual_price_cents: 15000,
  currency: "USD",
  limits: { features: ["team_workspace"] },
}));

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiter: { check: vi.fn(async () => true) },
}));
vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn(async () => state.user) }));
vi.mock("@/lib/env-boot", () => ({ config: { SITE_URL: "https://baton.test" } }));
vi.mock("@/lib/config", () => ({
  isStripeConfigured: () => state.stripeConfigured,
  isUsdcConfigured: () => state.usdcConfigured,
}));
vi.mock("@/lib/billing/plans", () => ({
  // Mirrors the real resolver: an unknown id yields null, never a default plan.
  getPlanById: vi.fn(async (id: string) => (id === plan.id ? plan : null)),
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  prepareSubscriptionForCheckout: vi.fn(async () => state.prepared),
}));
vi.mock("@/lib/billing/payments", () => ({
  createStripePayment: vi.fn(async (input: { amount: number; interval: string }) => {
    state.charged.push(input.amount);
    state.intervals.push(input.interval);
    return state.stripePayment;
  }),
  createUsdcPayment: vi.fn(async (input: { amount: number; interval: string }) => {
    state.charged.push(input.amount);
    state.intervals.push(input.interval);
    return { ...state.usdcPayment, amount: input.amount };
  }),
  patchPayment: vi.fn(async () => {}),
}));
vi.mock("@/lib/billing/stripe", () => ({
  createStripeCheckoutSession: vi.fn(async (input: { plan: unknown; interval: string }) => {
    // The Stripe session must be created from the server-side plan row, and
    // Stripe's own price must match the plan amount (checked in stripe.ts).
    void input.plan;
    return { url: "https://checkout.stripe.com/c/pay", sessionId: "cs_1" };
  }),
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  // The route only reads `headers` and `json()`, so a plain Request with the
  // forwarded-IP header exercises the real code path.
  return new Request("https://baton.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  state.user = { id: "user-1", suspendedAt: null };
  state.stripeConfigured = true;
  state.usdcConfigured = true;
  state.prepared = { subscription: { id: "sub-1" }, alreadyOnPlan: false, renewal: false };
  state.charged = [];
  state.intervals = [];
});

describe("checkout requires authentication", () => {
  it("rejects a signed-out request", async () => {
    state.user = null;
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(401);
    expect(state.charged).toEqual([]);
  });

  it("rejects a suspended user", async () => {
    state.user = { id: "user-1", suspendedAt: new Date() };
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(401);
    expect(state.charged).toEqual([]);
  });
});

describe("the charged amount is always server-derived", () => {
  it("charges Team monthly at 1500 and annual at 15000", async () => {
    await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    await POST(request({ planId: "plan_team_default", billing: "annual", provider: "stripe" }));
    expect(state.charged).toEqual([1500, 15000]);
  });

  it("ignores a client-supplied amount", async () => {
    const res = await POST(
      request({
        planId: "plan_team_default",
        billing: "annual",
        provider: "stripe",
        amount: 1,
        amountMinor: 1,
        price: 1,
        cents: 1,
        total: 1,
      }),
    );
    expect(res.status).toBe(200);
    expect(state.charged).toEqual([15000]);
  });

  it("ignores a client-supplied plan id and resolves the real plan", async () => {
    const res = await POST(
      request({ planId: "plan_team_default", billing: "monthly", provider: "usdc", plan: "organization" }),
    );
    expect(res.status).toBe(200);
    expect(state.charged).toEqual([1500]);
  });

  it("passes the requested interval through to the payment record", async () => {
    await POST(request({ planId: "plan_team_default", billing: "annual", provider: "usdc" }));
    expect(state.intervals).toEqual(["annual"]);
  });

  it("rejects a forged billing interval instead of defaulting to the cheaper one", async () => {
    const res = await POST(
      request({ planId: "plan_team_default", billing: "lifetime", provider: "stripe" }),
    );
    expect(res.status).toBe(400);
    expect(state.charged).toEqual([]);
  });

  it("rejects a forged provider", async () => {
    const res = await POST(
      request({ planId: "plan_team_default", billing: "monthly", provider: "paypal" }),
    );
    expect(res.status).toBe(400);
    expect(state.charged).toEqual([]);
  });

  it("rejects an unknown or inactive plan", async () => {
    for (const planId of ["", "plan_nope", "../../etc/passwd"]) {
      const res = await POST(request({ planId, billing: "monthly", provider: "stripe" }));
      expect([400, 404]).toContain(res.status);
    }
    expect(state.charged).toEqual([]);
  });

  it("refuses a custom-priced plan over self-serve checkout", async () => {
    const { getPlanById } = await import("@/lib/billing/plans");
    (getPlanById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...plan,
      price_custom: true,
      monthly_price_cents: 0,
      annual_price_cents: 0,
    });
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "usdc" }));
    expect(res.status).toBe(400);
  });
});

describe("provider availability is enforced server-side", () => {
  it("refuses Stripe when it is not configured", async () => {
    state.stripeConfigured = false;
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(501);
    expect(state.charged).toEqual([]);
  });

  it("refuses USDC when no wallet is configured", async () => {
    state.usdcConfigured = false;
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "usdc" }));
    expect(res.status).toBe(501);
    expect(state.charged).toEqual([]);
  });

  it("still accepts the other provider", async () => {
    state.usdcConfigured = false;
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(200);
    expect(state.charged).toEqual([1500]);
  });
});

describe("a duplicate checkout attempt does not create a second subscription", () => {
  it("returns 409 and charges nothing when the user is already on the plan", async () => {
    state.prepared = { subscription: { id: "sub-1" }, alreadyOnPlan: true, renewal: false };
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(409);
    expect(state.charged).toEqual([]);
  });
});

describe("no secret is echoed to the client", () => {
  it("the USDC order response contains only the payment instructions", async () => {
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "usdc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["amountMinor", "crypto_transaction_hash", "network", "paymentId", "provider", "renewal", "token", "txSubmitted", "walletAddress"]
        .filter((k) => k in body)
        .sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/whsec|sk_live|sk_test|STRIPE_/);
  });

  it("the Stripe response contains only the checkout URL and ids", async () => {
    const res = await POST(request({ planId: "plan_team_default", billing: "monthly", provider: "stripe" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      provider: "stripe",
      url: "https://checkout.stripe.com/c/pay",
      sessionId: "cs_1",
      paymentId: "pay-1",
    });
  });
});
