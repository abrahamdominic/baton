import { describe, expect, it } from "vitest";
import { resolveResumeRoute, type ResumeRouteInput } from "./resume-route";

const base: ResumeRouteInput = {
  subscriptionStatus: "pending",
  planId: "plan_1",
  planSlug: "team",
  interval: "monthly",
  paymentProvider: null,
  paymentStatus: null,
  hasCryptoTxHash: false,
  paymentId: null,
  stripeSession: null,
};

function makeInput(overrides: Partial<ResumeRouteInput>): ResumeRouteInput {
  return { ...base, ...overrides };
}

describe("resolveResumeRoute", () => {
  it("is closed when the subscription is no longer open", () => {
    for (const status of ["active", "canceled", "expired", "none"] as const) {
      expect(resolveResumeRoute(makeInput({ subscriptionStatus: status })).kind).toBe("closed");
    }
  });

  it("is closed without a plan id (buyer cannot be routed)", () => {
    const missingPlan = makeInput({ planId: null, planSlug: null });
    expect(resolveResumeRoute(missingPlan).kind).toBe("closed");
  });

  it("returns the live Stripe Checkout Session URL when it is still open", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "stripe",
        paymentStatus: "pending",
        stripeSession: { status: "open", url: "https://checkout.stripe.com/c/pay_123" },
      }),
    );
    expect(route).toEqual({ kind: "stripe_session", url: "https://checkout.stripe.com/c/pay_123" });
  });

  it("points at the result page when the Stripe session already completed", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "stripe",
        paymentStatus: "confirmed",
        paymentId: "pay_9",
        stripeSession: { status: "complete" },
      }),
    );
    expect(route).toEqual({ kind: "recheck", url: "/dashboard/billing/result?payment=pay_9" });
  });

  it("re-enters checkout (no duplicate) when an expired Stripe session falls back", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "stripe",
        paymentStatus: "pending",
        stripeSession: { status: "expired" },
      }),
    );
    expect(route).toEqual({
      kind: "usdc_order",
      url: "/dashboard/billing/checkout?plan=plan_1&billing=monthly",
    });
  });

  it("re-enters checkout when the Stripe retrieval failed (session unknown)", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "stripe",
        paymentStatus: "pending",
        stripeSession: { status: "missing" },
      }),
    );
    expect(route.kind).toBe("usdc_order");
  });

  it("keeps an awaiting-verification USDC payment on the result page", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "usdc",
        paymentStatus: "pending_verification",
        hasCryptoTxHash: true,
        paymentId: "pay_42",
      }),
    );
    expect(route).toEqual({ kind: "recheck", url: "/dashboard/billing/result?payment=pay_42" });
  });

  it("routes a pending USDC order without a submitted hash back to checkout", () => {
    const route = resolveResumeRoute(
      makeInput({
        paymentProvider: "usdc",
        paymentStatus: "pending",
        hasCryptoTxHash: false,
      }),
    );
    expect(route).toEqual({
      kind: "usdc_order",
      url: "/dashboard/billing/checkout?plan=plan_1&billing=monthly",
    });
  });

  it("honors the annual interval on the fallback checkout URL", () => {
    const route = resolveResumeRoute(makeInput({ interval: "annual" }));
    expect(route).toEqual({
      kind: "usdc_order",
      url: "/dashboard/billing/checkout?plan=plan_1&billing=annual",
    });
  });

  it("routes a payment_failed subscription back to checkout so the user retries", () => {
    const route = resolveResumeRoute(
      makeInput({ subscriptionStatus: "payment_failed", interval: "monthly" }),
    );
    expect(route.kind).toBe("usdc_order");
  });
});