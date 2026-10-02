import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { compareSubscription, expectedLocalStatus } from "./reconcile";
import { subscriptionFromRow } from "./records";
import type { SubscriptionRecord } from "./types";

function local(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return subscriptionFromRow({
    id: "sub_1",
    user_id: "u_1",
    plan_id: "plan_pro",
    status: "active",
    payment_provider: "stripe",
    provider_customer_id: "cus_1",
    provider_subscription_id: "stripe_sub_1",
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-02-01T00:00:00.000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2025-12-01T00:00:00.000Z",
    ended_at: null,
    payment_action_required: false,
    payment_action_reason: null,
    created_at: "2025-12-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  } as never);
}

const matching = {
  status: "active",
  currentPeriodStart: "2026-01-01T00:00:00.000Z",
  currentPeriodEnd: "2026-02-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  planId: "plan_pro",
};

describe("expectedLocalStatus", () => {
  it("maps Stripe's paying statuses to an active local row", () => {
    expect(expectedLocalStatus("active", false, "active")).toBe("active");
    expect(expectedLocalStatus("trialing", false, "active")).toBe("active");
  });

  it("reports active_until_period_end as soon as a cancellation is scheduled", () => {
    // Stripe keeps saying `active` right up to the period end after a
    // cancellation is requested. Without this the UI would offer "reactivate"
    // for a subscription that is about to disappear.
    expect(expectedLocalStatus("active", true, "active")).toBe("active_until_period_end");
  });

  it("maps the statuses Stripe stops collecting on", () => {
    expect(expectedLocalStatus("past_due", false, "active")).toBe("past_due");
    expect(expectedLocalStatus("unpaid", false, "past_due")).toBe("expired");
    expect(expectedLocalStatus("paused", false, "active")).toBe("expired");
    expect(expectedLocalStatus("canceled", false, "active")).toBe("canceled");
  });

  it("maps the incomplete pair onto pending and payment_failed", () => {
    expect(expectedLocalStatus("incomplete", false, "pending")).toBe("pending");
    expect(expectedLocalStatus("incomplete_expired", false, "pending")).toBe("payment_failed");
  });

  it("leaves an unknown Stripe status alone rather than guessing", () => {
    expect(expectedLocalStatus("something_new", false, "active")).toBe("active");
  });
});

describe("compareSubscription", () => {
  it("reports nothing when both sides agree", () => {
    const result = compareSubscription(local(), matching, "plan_pro");
    expect(result.discrepancies).toEqual([]);
    expect(result.repairs.size).toBe(0);
  });

  it("tolerates sub-minute drift in the stored window", () => {
    // Stripe timestamps are second-resolution and the local row is written in
    // milliseconds. Reporting that as a discrepancy would produce noise on every
    // pass and train everyone to ignore the report.
    const result = compareSubscription(
      local(),
      { ...matching, currentPeriodEnd: "2026-02-01T00:00:30.000Z" },
      "plan_pro",
    );
    expect(result.discrepancies).toEqual([]);
  });

  it("flags and repairs a missed renewal that left access active past its period", () => {
    // This is the exact divergence the pass exists for: the renewal webhook was
    // lost and the customer stopped paying but kept their entitlement.
    const result = compareSubscription(
      local({ status: "active", current_period_end: "2026-02-01T00:00:00.000Z" }),
      {
        ...matching,
        status: "past_due",
        currentPeriodEnd: "2026-02-28T00:00:00.000Z",
      },
      "plan_pro",
    );
    expect(result.discrepancies.map((d) => d.kind).sort()).toEqual(["period_mismatch", "status_mismatch"]);
    expect(result.repairs.get("sub_1")?.status).toBe("past_due");
  });

  it("flags a plan the user changed on Stripe but the webhook missed", () => {
    const result = compareSubscription(local(), matching, "plan_team");
    expect(result.discrepancies).toMatchObject([
      { kind: "plan_mismatch", local: "plan_team", stripe: "plan_pro" },
    ]);
    expect(result.repairs.get("sub_1")?.planId).toBe("plan_pro");
  });

  it("reports an unmapped price without touching the plan", () => {
    // A price no plan maps to is a configuration gap. Repairing it would pick a
    // plan on a technicality; leaving it and reporting it is the safe direction.
    const result = compareSubscription(local(), { ...matching, planId: null }, "plan_pro");
    expect(result.discrepancies).toMatchObject([{ kind: "unmapped_price" }]);
    expect(result.repairs.size).toBe(0);
  });

  it("flags a cancel flag that never arrived", () => {
    const result = compareSubscription(local(), { ...matching, cancelAtPeriodEnd: true }, "plan_pro");
    expect(result.discrepancies.map((d) => d.kind)).toEqual([
      "status_mismatch",
      "cancel_flag_mismatch",
    ]);
    expect(result.repairs.get("sub_1")).toMatchObject({ status: "active_until_period_end" });
  });

  it("does not queue a repair for a difference it cannot repair", () => {
    // `unmapped_price` and `period_mismatch` are reported, but the period is
    // synced opportunistically alongside a real repair, so on their own there is
    // nothing for the repair path to do.
    const result = compareSubscription(
      local(),
      { ...matching, currentPeriodStart: "2026-01-05T00:00:00.000Z" },
      "plan_pro",
    );
    expect(result.discrepancies.map((d) => d.kind)).toEqual(["period_mismatch"]);
    expect(result.repairs.size).toBe(0);
  });

  it("flags a row whose period is missing locally", () => {
    const result = compareSubscription(
      local({ current_period_start: null, current_period_end: null }),
      matching,
      "plan_pro",
    );
    expect(result.discrepancies.map((d) => d.kind)).toEqual(["period_mismatch"]);
  });

  it("collects every discrepancy for one row rather than stopping at the first", () => {
    const result = compareSubscription(
      local({ status: "active", cancel_at_period_end: false }),
      {
        status: "past_due",
        currentPeriodStart: "2026-03-01T00:00:00.000Z",
        currentPeriodEnd: "2026-04-01T00:00:00.000Z",
        cancelAtPeriodEnd: true,
        planId: "plan_team",
      },
      "plan_pro",
    );
    expect(result.discrepancies.map((d) => d.kind).sort()).toEqual([
      "cancel_flag_mismatch",
      "period_mismatch",
      "plan_mismatch",
      "status_mismatch",
    ]);
  });
});
