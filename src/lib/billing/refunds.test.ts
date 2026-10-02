import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { refundAccessDecision, derivePaymentStatus, type RefundStatus } from "./refunds";
import type { SubscriptionStatus } from "./types";

const money: {
  refundStatus: RefundStatus;
  refundAmount: number;
  totalSucceededRefunded: number;
  chargedAmount: number;
} = {
  refundStatus: "succeeded",
  refundAmount: 2000,
  totalSucceededRefunded: 2000,
  chargedAmount: 2000,
};

function decision(over: Partial<typeof money>, status: SubscriptionStatus) {
  return refundAccessDecision({ ...money, ...over, subscriptionStatus: status });
}

describe("derivePaymentStatus", () => {
  it("marks a payment refunded once refunds add up to the charge", () => {
    expect(derivePaymentStatus("confirmed", 2000, 2000)).toBe("refunded");
    expect(derivePaymentStatus("confirmed", 2000, 5000)).toBe("refunded");
  });

  it("keeps a partially refunded payment confirmed", () => {
    // Marking this `refunded` would claim money came back that did not, and the
    // ledger is the thing an operator reads during a dispute.
    expect(derivePaymentStatus("confirmed", 2000, 200)).toBe("confirmed");
  });

  it("reopens a refunded payment that turns out to be only partial", () => {
    expect(derivePaymentStatus("refunded", 2000, 200)).toBe("confirmed");
  });

  it("leaves an untouched payment alone", () => {
    expect(derivePaymentStatus("confirmed", 2000, 0)).toBe("confirmed");
    expect(derivePaymentStatus("failed", 2000, 0)).toBe("failed");
  });

  it("never revokes on a refund of a zero-amount charge", () => {
    // A $0 charge cannot be "fully refunded"; treating it as one would revoke
    // access on an admin adjustment.
    expect(derivePaymentStatus("confirmed", 0, 0)).toBe("confirmed");
  });
});

describe("refundAccessDecision", () => {
  it("revokes access on a full refund of a live subscription", () => {
    expect(decision({}, "active")).toMatchObject({ kind: "revoke", to: "expired" });
  });

  it("cancels instead of expiring a subscription already scheduled to cancel", () => {
    // `active_until_period_end` has no `expired` transition; asking for one
    // would throw inside the webhook and make Stripe retry forever.
    expect(decision({}, "active_until_period_end")).toMatchObject({ kind: "revoke", to: "canceled" });
  });

  it("fails a still-pending subscription rather than expiring it", () => {
    expect(decision({}, "pending")).toMatchObject({ kind: "revoke", to: "payment_failed" });
  });

  it("keeps access on a partial refund", () => {
    // Most partial refunds are overcharge corrections and goodwill. Cutting a
    // paying customer off over a small adjustment is a support incident.
    const result = decision({ refundAmount: 200, totalSucceededRefunded: 200 }, "active");
    expect(result.kind).toBe("none");
    expect(result.reason).toContain("partial refund");
  });

  it("keeps access while a refund is still pending", () => {
    expect(decision({ refundStatus: "pending" }, "active").kind).toBe("none");
  });

  it("keeps access when the refund failed or was cancelled", () => {
    // A failed dispute is the customer's money being clawed back; revoking on it
    // would punish them for the issuer's decision.
    expect(decision({ refundStatus: "failed" }, "active").kind).toBe("none");
    expect(decision({ refundStatus: "cancelled" }, "active").kind).toBe("none");
  });

  it("revokes once partial refunds accumulate to the full charge", () => {
    // Two $15 refunds against a $20 charge are a full refund in aggregate, so
    // the total across the ledger decides, not the size of any single refund.
    expect(
      decision({ refundAmount: 15, totalSucceededRefunded: 30, chargedAmount: 20 }, "active"),
    ).toMatchObject({ kind: "revoke", to: "expired" });
  });

  it("keeps access while accumulated refunds are still short of the charge", () => {
    expect(
      decision({ refundAmount: 15, totalSucceededRefunded: 15, chargedAmount: 20 }, "active").kind,
    ).toBe("none");
  });

  it("does nothing for a subscription that is already terminal", () => {
    expect(decision({}, "canceled").kind).toBe("none");
    expect(decision({}, "expired").kind).toBe("none");
    expect(decision({}, "payment_failed").kind).toBe("none");
  });

  it("does nothing when the payment row has no amount to compare against", () => {
    expect(decision({ chargedAmount: 0 }, "active").kind).toBe("none");
  });

  it("never asks for a transition the state machine would refuse", () => {
    // The choice is made against the legal transitions for the current status,
    // so this holds for every status in the machine rather than a hand-picked few.
    const statuses: SubscriptionStatus[] = [
      "none",
      "pending",
      "active",
      "active_until_period_end",
      "past_due",
      "payment_failed",
      "canceled",
      "expired",
    ];
    for (const subscriptionStatus of statuses) {
      const result = decision({}, subscriptionStatus);
      if (result.kind !== "revoke") continue;
      expect(
        ["expired", "canceled", "payment_failed"],
        `${subscriptionStatus} -> ${result.to}`,
      ).toContain(result.to);
      expect(subscriptionStatus).not.toBe(result.to);
    }
  });

  it("prefers expiry over cancellation when both are legal", () => {
    // From `active`, both are reachable in the machine; expiry is the accurate
    // description of a refunded payment.
    expect(decision({}, "active")).toMatchObject({ kind: "revoke", to: "expired" });
  });
});
