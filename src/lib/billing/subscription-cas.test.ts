import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The write-race regression for the subscription state machine.
 *
 * `transitionSubscription` used to read a row, validate the transition against
 * the status it read, and then write unconditionally. Two writers that read the
 * same status both validated and both wrote, so the last writer won and the row
 * could land in a state the machine would have rejected outright, a renewal and
 * a cancellation interleaving in the same window being the ordinary case.
 *
 * The fix is the `.eq("status", observed)` predicate: the write only lands if
 * the status is still the one that was validated against. When it does not, the
 * caller has to be told, not silently handed the other writer's row.
 */

const rows = {
  "sub-1": {
    id: "sub-1",
    user_id: "user-1",
    plan_id: "plan_pro",
    status: "active",
    payment_provider: "stripe",
    provider_customer_id: "cus_1",
    provider_subscription_id: "ps_1",
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-02-01T00:00:00.000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: null,
    payment_action_required: false,
    payment_action_reason: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
};

type Row = (typeof rows)["sub-1"];

/**
 * The `select(...)` terminal used by plain reads.
 *
 * The row is snapshotted at call time, the way a database returns it: a read is
 * a value at an instant, not a live view of the table. Without the copy, a test
 * that moves the row between the read and the write would look as though the
 * read had seen the new state, and the race under test would never run.
 */
const readRow = vi.fn(async () => ({
  data: { ...rows["sub-1"] } as Row,
  error: null,
}));
const eventMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "subscriptions")
        throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          const chain = { eq: () => chain, maybeSingle: readRow };
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            },
            select: () => chain,
            maybeSingle: async () => {
              // A PostgREST `.update().eq(k, v)` returns a row only when every
              // predicate matches the row as it stands *now*, and the patch is
              // applied only then, which is exactly the compare-and-set the
              // state machine depends on.
              const stored = rows["sub-1"] as unknown as Record<
                string,
                unknown
              >;
              const matched = filters.every(
                ([column, value]) => stored[column] === value,
              );
              if (!matched) return { data: null, error: null };
              Object.assign(stored, patch);
              return { data: stored as unknown as Row, error: null };
            },
          };
          return chain;
        },
      };
    },
  }),
}));

vi.mock("@/lib/billing/plans", () => ({
  getPlanById: vi.fn(async () => null),
  getPurchasablePlanById: vi.fn(async () => null),
}));
vi.mock("@/lib/billing/events", () => ({ recordSubscriptionEvent: eventMock }));
vi.mock("@/lib/billing/system-events", () => ({
  recordSystemEvent: vi.fn(async () => {}),
}));

import { transitionSubscription } from "./subscriptions";
import { SubscriptionConflictError } from "./errors";

beforeEach(() => {
  const row = rows["sub-1"] as unknown as Record<string, unknown>;
  row.status = "active";
  row.cancel_at_period_end = false;
  readRow.mockClear();
  eventMock.mockClear();
});

describe("transitionSubscription compare-and-set", () => {
  it("writes through when the status is still the one that was validated", async () => {
    const sub = await transitionSubscription("sub-1", {
      to: "active_until_period_end",
      cancelAtPeriodEnd: true,
      eventType: "subscription.updated",
      source: "stripe" as const,
    });
    expect(sub.status).toBe("active_until_period_end");
    expect(sub.cancel_at_period_end).toBe(true);
    expect(eventMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The race, in the shape it actually happens.
   *
   * Dunning moves a `past_due` row to `active_until_period_end` (the user
   * scheduled a cancellation) at the same moment the payment webhook is
   * recovering it to `active`. Both writers read `past_due`, both validate
   * `past_due to active`, and without the status predicate both write, so the
   * subscription silently returns to `active` for a billing period the user had
   * already ended. Here the predicate matches nothing, the re-read shows
   * `active_until_period_end`, and because `active_until_period_end to active` is
   * still legal the caller is told to retry rather than handed a decision
   * somebody else made.
   */
  it("refuses to write over a status that changed underneath it", async () => {
    rows["sub-1"].status = "past_due";
    const inFlight = transitionSubscription("sub-1", {
      to: "active",
      eventType: "subscription.activated",
      source: "stripe" as const,
    });

    // The competing writer wins between our read and our write.
    rows["sub-1"].status = "active_until_period_end";

    await expect(inFlight).rejects.toBeInstanceOf(SubscriptionConflictError);
    // The losing writer left the winning state alone...
    expect(rows["sub-1"].status).toBe("active_until_period_end");
    // ...and did not record an event for a transition that never applied.
    expect(eventMock).not.toHaveBeenCalled();
  });

  it("treats an identical concurrent transition as already applied", async () => {
    const inFlight = transitionSubscription("sub-1", {
      to: "active_until_period_end",
      cancelAtPeriodEnd: true,
      eventType: "subscription.updated",
      source: "stripe" as const,
    });

    // A second copy of the very same request won the race.
    rows["sub-1"].status = "active_until_period_end";

    const sub = await inFlight;
    expect(sub.status).toBe("active_until_period_end");
  });

  /**
   * The other branch: the winner moved the row somewhere the requested target is
   * not reachable from. Writing or returning here would resurrect a canceled or
   * expired subscription, so the machine still refuses, naming the transition it
   * rejected rather than a retry hint that could not have helped.
   */
  it("still refuses an illegal transition that was legal when first read", async () => {
    const inFlight = transitionSubscription("sub-1", {
      to: "active_until_period_end",
      cancelAtPeriodEnd: true,
      eventType: "subscription.updated",
      source: "stripe" as const,
    });

    rows["sub-1"].status = "expired";

    await expect(inFlight).rejects.toThrow(/Illegal subscription transition/);
    expect(rows["sub-1"].status).toBe("expired");
    expect(eventMock).not.toHaveBeenCalled();
  });
});
