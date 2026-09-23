import { describe, it, expect } from "vitest";
import {
  SUBSCRIPTION_TRANSITIONS,
  canTransition,
  validateTransition,
  subscriptionCountsAsPaid,
  isPeriodExpired,
  adminTargets,
} from "./subscription-machine";

describe("subscription-machine transitions", () => {
  it("allows every declared transition", () => {
    for (const [from, tos] of Object.entries(SUBSCRIPTION_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransition(from as never, to as never), `${from} → ${to}`).toBe(true);
        expect(validateTransition(from as never, to as never)).toBeNull();
      }
    }
  });

  it("rejects illegal transitions with a descriptive result", () => {
    expect(validateTransition("none", "active")).toEqual({ from: "none", to: "active" });
    expect(validateTransition("active", "expired")).toEqual({ from: "active", to: "expired" });
    expect(validateTransition("canceled", "active")).toEqual({ from: "canceled", to: "active" });
  });

  it("allows no-op transitions (same status)", () => {
    expect(canTransition("active", "active")).toBe(true);
    expect(validateTransition("past_due", "past_due")).toBeNull();
  });

  it("supports the payment lifecycle only through valid states", () => {
    // pending must go active before it can become past_due.
    expect(canTransition("active", "past_due")).toBe(true);
    expect(canTransition("pending", "past_due")).toBe(false);
    // past_due recovers to active or expires.
    expect(canTransition("past_due", "active")).toBe(true);
    expect(canTransition("past_due", "expired")).toBe(true);
  });

  it("mirrors nk.md §23: no shortcuts around a verified activation", () => {
    expect(canTransition("none", "active")).toBe(false);
    expect(canTransition("pending", "canceled")).toBe(false);
    expect(canTransition("payment_failed", "canceled")).toBe(false);
    expect(canTransition("active", "payment_failed")).toBe(false);
    expect(canTransition("active", "expired")).toBe(false);
    expect(canTransition("canceled", "active")).toBe(false);
    expect(canTransition("expired", "active")).toBe(false);
  });

  it("restores cancelled/expired rows by reopening as pending", () => {
    expect(canTransition("canceled", "pending")).toBe(true);
    expect(canTransition("expired", "pending")).toBe(true);
  });
});

describe("adminTargets", () => {
  it("only surfaces legal admin moves per the state machine", () => {
    expect(adminTargets("none")).toEqual(["none", "pending"]);
    expect(adminTargets("active")).toEqual(["active", "active_until_period_end", "past_due"]);
    expect(adminTargets("active_until_period_end")).toEqual(["active", "active_until_period_end", "canceled"]);
    expect(adminTargets("canceled")).toEqual(["pending", "canceled"]);
    expect(adminTargets("expired")).toEqual(["pending", "expired"]);
    expect(adminTargets("pending")).toContain("active");
    expect(adminTargets("pending")).not.toContain("canceled");
  });
});

describe("subscriptionCountsAsPaid", () => {
  it("grants access only for paid statuses", () => {
    expect(subscriptionCountsAsPaid("active")).toBe(true);
    expect(subscriptionCountsAsPaid("active_until_period_end")).toBe(true);
    expect(subscriptionCountsAsPaid("past_due")).toBe(true);
    expect(subscriptionCountsAsPaid("none")).toBe(false);
    expect(subscriptionCountsAsPaid("pending")).toBe(false);
    expect(subscriptionCountsAsPaid("payment_failed")).toBe(false);
    expect(subscriptionCountsAsPaid("canceled")).toBe(false);
    expect(subscriptionCountsAsPaid("expired")).toBe(false);
  });
});

describe("nk.md §25 lifecycle journeys", () => {
  const walk = (steps: string[]) => {
    for (let i = 0; i + 1 < steps.length; i++) {
      expect(
        canTransition(steps[i] as never, steps[i + 1] as never),
        `${steps[i]} → ${steps[i + 1]}`,
      ).toBe(true);
    }
  };

  it("new user starts at none with no paid access", () => {
    expect(subscriptionCountsAsPaid("none")).toBe(false);
    expect(validateTransition("none", "pending")).toBeNull();
  });

  it("successful Stripe purchase: none → pending → active", () => {
    walk(["none", "pending", "active"]);
  });

  it("failed Stripe purchase: none → pending → payment_failed", () => {
    expect(canTransition("none", "pending")).toBe(true);
    expect(canTransition("pending", "payment_failed")).toBe(true);
    expect(subscriptionCountsAsPaid("payment_failed")).toBe(false);
  });

  it("successful USDC purchase only after verification: none → pending → active", () => {
    walk(["none", "pending", "active"]);
    expect(subscriptionCountsAsPaid("active")).toBe(true);
    // A supplied tx hash must never skip verification to active directly.
    expect(canTransition("none", "active")).toBe(false);
  });

  it("invalid USDC transaction: pending → payment_failed", () => {
    expect(canTransition("pending", "payment_failed")).toBe(true);
    expect(canTransition("pending", "active")).toBe(true);
  });

  it("cancellation: active → active_until_period_end → canceled", () => {
    walk(["active", "active_until_period_end", "canceled"]);
  });

  it("reactivation: active_until_period_end → active", () => {
    expect(canTransition("active_until_period_end", "active")).toBe(true);
    expect(canTransition("active_until_period_end", "canceled")).toBe(true);
  });

  it("failed renewal: active → past_due", () => {
    expect(canTransition("active", "past_due")).toBe(true);
    expect(subscriptionCountsAsPaid("past_due")).toBe(true);
  });

  it("recovered payment: past_due → active", () => {
    expect(canTransition("past_due", "active")).toBe(true);
  });

  it("expired subscription: past_due → expired", () => {
    expect(canTransition("past_due", "expired")).toBe(true);
    expect(subscriptionCountsAsPaid("expired")).toBe(false);
  });

  it("a second delivery of the same event is a no-op (idempotent reprocess)", () => {
    // A re-delivered webhook/payment converging on the same status is legal:
    // the DB unique constraints prevent duplicate payments/subscriptions.
    expect(canTransition("active", "active")).toBe(true);
    expect(canTransition("past_due", "past_due")).toBe(true);
    expect(canTransition("active_until_period_end", "active_until_period_end")).toBe(true);
  });

  it("status can never jump without a verified activation or defined op", () => {
    expect(validateTransition("none", "active")).not.toBeNull();
    expect(validateTransition("pending", "canceled")).not.toBeNull();
    expect(validateTransition("expired", "active")).not.toBeNull();
    expect(validateTransition("canceled", "active")).not.toBeNull();
  });
});

describe("isPeriodExpired", () => {
  const now = new Date("2026-01-15T00:00:00Z");

  it("expires a paid subscription whose period end passed", () => {
    expect(isPeriodExpired("active", "2026-01-01T00:00:00Z", now)).toBe(true);
  });

  it("keeps access within the paid window", () => {
    expect(isPeriodExpired("active", "2026-02-01T00:00:00Z", now)).toBe(false);
    expect(isPeriodExpired("active", null, now)).toBe(false);
  });

  it("never expires non-paying statuses", () => {
    expect(isPeriodExpired("pending", "2025-01-01T00:00:00Z", now)).toBe(false);
    expect(isPeriodExpired("canceled", "2025-01-01T00:00:00Z", now)).toBe(false);
  });
});