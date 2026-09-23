import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let mockSubStatus: string = "pending";
let mockSubUser: string = "user-1";

const baseRow = {
  id: "sub-1",
  user_id: "user-1",
  plan_id: "plan-1",
  status: "pending",
  payment_provider: "stripe",
  provider_customer_id: null,
  provider_subscription_id: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  started_at: null,
  ended_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "subscriptions") {
        const row = { ...baseRow, status: mockSubStatus, user_id: mockSubUser };
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { ...row, status: "canceled" }, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
        insert: vi.fn(async () => ({ error: null })),
        update: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      };
    }),
  })),
}));

const plan = { id: "plan-1", slug: "team", name: "Team", is_active: true };
vi.mock("./plans", () => ({
  getPlanById: vi.fn(async () => plan),
}));

vi.mock("./events", () => ({
  recordSubscriptionEvent: vi.fn(async () => {}),
}));

vi.mock("./system-events", () => ({
  recordSystemEvent: vi.fn(async () => {}),
}));

vi.mock("./stripe", () => ({
  getStripe: vi.fn(() => stripeSpy),
}));

const stripeSpy = vi.hoisted(() => ({
  checkout: { sessions: { expire: vi.fn(async () => ({})) } },
}));

vi.mock("./payments", () => ({
  findOpenPaymentForSubscription: vi.fn(async () => ({
    id: "pay-1",
    status: "pending",
    payment_provider: "stripe",
    stripe_checkout_session_id: "cs_test_abc",
  })),
  cancelCheckoutPayment: vi.fn(async () => ({
    id: "pay-1",
    status: "cancelled",
    payment_provider: "stripe",
    stripe_checkout_session_id: "cs_test_abc",
  })),
  confirmPayment: vi.fn(),
  getPaymentById: vi.fn(),
}));

import { cancelCheckoutPayment, findOpenPaymentForSubscription } from "./payments";
import { getStripe } from "./stripe";
import { cancelPendingCheckout } from "./subscriptions";

beforeEach(() => {
  vi.clearAllMocks();
  mockSubStatus = "pending";
  mockSubUser = "user-1";
});

describe("cancelPendingCheckout", () => {
  it("cancels the open payment, expires the Stripe session, and cancels the subscription", async () => {
    const result = await cancelPendingCheckout("user-1", "sub-1");

    expect(getStripe().checkout.sessions.expire).toHaveBeenCalledWith("cs_test_abc");
    expect(cancelCheckoutPayment).toHaveBeenCalledWith("pay-1");
    expect(result.subscription.status).toBe("canceled");
  });

  it("aborts when the payment was already confirmed (authoritative race winner)", async () => {
    (cancelCheckoutPayment as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "pay-1",
      status: "confirmed",
      payment_provider: "stripe",
      stripe_checkout_session_id: "cs_test_abc",
    });

    await expect(cancelPendingCheckout("user-1", "sub-1")).rejects.toThrow("already succeeded");
  });

  it("rejects a checkout belonging to another user", async () => {
    mockSubUser = "someone-else";
    await expect(cancelPendingCheckout("user-1", "sub-1")).rejects.toThrow("Checkout not found.");
  });

  it("refuses to cancel a subscription that is no longer open", async () => {
    mockSubStatus = "active";
    await expect(cancelPendingCheckout("user-1", "sub-1")).rejects.toThrow("can no longer be cancelled");
  });

  it("still closes the subscription when the checkout has no open payment", async () => {
    (findOpenPaymentForSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await cancelPendingCheckout("user-1", "sub-1");
    expect(cancelCheckoutPayment).not.toHaveBeenCalled();
    expect(result.subscription.status).toBe("canceled");
  });
});