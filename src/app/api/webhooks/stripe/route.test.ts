import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

/**
 * Regression tests for the Stripe webhook endpoint's idempotency ledger.
 *
 * The ledger table is `stripe_webhook_events` and its unique column is
 * `stripe_event_id` (supabase/migrations/0001_billing_core.sql). The route
 * previously read and wrote `event_id`, so PostgREST returned a column error on
 * every call: `wasEventProcessed` always reported "not seen" and
 * `markEventProcessed` silently wrote nothing. Duplicate deliveries were
 * therefore never suppressed, and a redelivered `checkout.session.completed`
 * re-stamped the paid window from `now`, silently resetting a customer's term.
 */

const processStripeEvent = vi.fn(async (event: unknown) => event);
const stripeEventTypeSupported = vi.fn((type: string) => type.startsWith("checkout.session."));
const constructStripeWebhookEvent = vi.fn((raw: string, sig: string | null) => ({
  id: `evt_${sig ?? "unsigned"}`,
  type: "checkout.session.completed",
  raw,
}));

vi.mock("@/lib/billing/stripe-webhooks", () => ({
  processStripeEvent: (event: unknown) => processStripeEvent(event),
  stripeEventTypeSupported: (type: string) => stripeEventTypeSupported(type),
}));

vi.mock("@/lib/billing/stripe", () => ({
  constructStripeWebhookEvent: (raw: string, sig: string | null) =>
    constructStripeWebhookEvent(raw, sig),
}));

vi.mock("@/lib/billing/system-events", () => ({
  recordSystemEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimiter: { check: vi.fn(async () => true) },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Records every Supabase call so the ledger column names can be asserted. */
const calls: Array<{ op: string; table: string; args: Record<string, unknown> }> = [];
let ledgerRow: Record<string, unknown> | null = null;
let ledgerReadError: { message: string } | null = null;

vi.mock("@/lib/supabase/client", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        calls.push({ op: "select", table, args: { cols } });
        const chain: Record<string, unknown> = {};
        chain.eq = (column: string, value: unknown) => {
          calls.push({ op: "eq", table, args: { column, value } });
          return chain;
        };
        chain.maybeSingle = async () => ({ data: ledgerRow, error: ledgerReadError });
        return chain;
      },
      insert: async (values: Record<string, unknown>) => {
        calls.push({ op: "insert", table, args: values });
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

function makeRequest(body = "{}"): NextRequest {
  return {
    headers: new Headers({ "stripe-signature": "t=1,v1=abc" }),
    text: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  ledgerRow = null;
  ledgerReadError = null;
  processStripeEvent.mockImplementation(async () => {});
  stripeEventTypeSupported.mockReturnValue(true);
  constructStripeWebhookEvent.mockReturnValue({
    id: "evt_1",
    type: "checkout.session.completed",
    raw: "{}",
  });
});

describe("stripe webhook idempotency ledger", () => {
  it("reads the real unique column, not a misspelled one", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const eq = calls.find((c) => c.op === "eq");
    expect(eq?.args.column).toBe("stripe_event_id");
    expect(calls.some((c) => c.args.column === "event_id")).toBe(false);
  });

  it("writes the real unique column on success", async () => {
    await POST(makeRequest());
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("stripe_webhook_events");
    expect(insert?.args.stripe_event_id).toBe("evt_1");
    expect(insert?.args.event_type).toBe("checkout.session.completed");
    expect("event_id" in (insert?.args ?? {})).toBe(false);
  });

  it("skips processing a delivery that is already in the ledger", async () => {
    ledgerRow = { stripe_event_id: "evt_1" };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(processStripeEvent).not.toHaveBeenCalled();
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("processes and records a first delivery", async () => {
    await POST(makeRequest());
    expect(processStripeEvent).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.op === "insert")).toBe(true);
  });

  it("does not record an event whose processing failed", async () => {
    processStripeEvent.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    // A non-recorded event stays reprocessable, so Stripe's retry is honoured.
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("processes rather than dropping the event when the ledger read fails", async () => {
    ledgerReadError = { message: "connection reset" };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Failing closed would silently drop a real customer payment.
    expect(processStripeEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects an unverified signature before touching the ledger", async () => {
    constructStripeWebhookEvent.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(processStripeEvent).not.toHaveBeenCalled();
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("ignores an unsupported event type entirely", async () => {
    stripeEventTypeSupported.mockReturnValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(processStripeEvent).not.toHaveBeenCalled();
    expect(calls.length).toBe(0);
  });
});
