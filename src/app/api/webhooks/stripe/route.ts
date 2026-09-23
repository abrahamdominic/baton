import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { rateLimiter } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/client";
import { constructStripeWebhookEvent } from "@/lib/billing/stripe";
import { stripeEventTypeSupported, processStripeEvent } from "@/lib/billing/stripe-webhooks";
import { recordSystemEvent } from "@/lib/billing/system-events";
import { BackendNotConfiguredError } from "@/lib/billing/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_SIZE_LIMIT = 1_000_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get("stripe-signature");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!(await isAllowed(ip))) {
    logger.warn("stripe-webhook-rate-limited", { ip });
    return new NextResponse("rate limited", { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > BODY_SIZE_LIMIT) {
    logger.warn("stripe-webhook-too-large", { ip, bytes: raw.length });
    return new NextResponse("too large", { status: 413 });
  }

  let event;
  try {
    event = constructStripeWebhookEvent(raw, signature);
  } catch (err) {
    const kind = err instanceof BackendNotConfiguredError ? "misconfigured" : "bad signature";
    logger.warn("stripe-webhook-rejected", { ip, kind });
    return new NextResponse(kind === "misconfigured" ? "misconfigured" : "invalid signature", {
      status: kind === "misconfigured" ? 500 : 401,
    });
  }

  if (!stripeEventTypeSupported(event.type)) {
    return new NextResponse("ok", { status: 200 });
  }

  // The webhook idempotency ledger records ONLY successfully processed events.
  // The ledger rows are immutable (history immutability trigger), so an event
  // whose processing failed earlier must NOT be treated as a duplicate: it
  // would be permanently dropped. Instead of reserving the row up front, we
  // check whether processing already succeeded, then record only on success.
  if (await wasEventProcessed(event.id)) {
    logger.debug("stripe-webhook-duplicate", { eventId: event.id, type: event.type });
    return new NextResponse("ok", { status: 200 });
  }

  try {
    await processStripeEvent(event);
  } catch (err) {
    logger.error("stripe-webhook-processing-failed", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : "unknown",
    });
    await recordSystemEvent({
      eventType: "stripe_webhook_failed",
      severity: "error",
      status: "failed",
      message: `Stripe webhook ${event.type} processing failed: ${err instanceof Error ? err.message : "unknown"}`,
      metadata: { eventId: event.id, type: event.type },
    });
    return new NextResponse("internal", { status: 500 });
  }

  // Best-effort ledger insert. A unique conflict means a concurrent delivery
  // of the same event already succeeded; that is fine (processing converged).
  await markEventProcessed(event.id, event.type);

  logger.info("stripe-webhook-processed", { eventId: event.id, type: event.type });
  return new NextResponse("ok", { status: 200 });
}

async function isAllowed(ip: string): Promise<boolean> {
  return rateLimiter.check(`stripe-webhook:${ip}`, 60, 1000);
}

async function wasEventProcessed(eventId: string): Promise<boolean> {
  const sb = getAdminClient();
  const { data } = await sb
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

async function markEventProcessed(eventId: string, eventType: string): Promise<void> {
  const sb = getAdminClient();
  await sb.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
  });
}