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

  const idempotent = await recordWebhookEvent(event.id, event.type);
  if (idempotent === "duplicate") {
    logger.debug("stripe-webhook-duplicate", { eventId: event.id, type: event.type });
    return new NextResponse("ok", { status: 200 });
  }
  if (idempotent === "error") {
    return new NextResponse("internal", { status: 500 });
  }

  try {
    await processStripeEvent(event);
  } catch (err) {
    // Processing failed: delete the idempotency row so Stripe's retry can
    // reprocess the event fresh rather than being silently dropped.
    await deleteWebhookEvent(event.id);
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

  logger.info("stripe-webhook-processed", { eventId: event.id, type: event.type });
  return new NextResponse("ok", { status: 200 });
}

async function isAllowed(ip: string): Promise<boolean> {
  return rateLimiter.check(`stripe-webhook:${ip}`, 60, 1000);
}

type WebhookRecordOutcome = "recorded" | "duplicate" | "error";

async function recordWebhookEvent(eventId: string, eventType: string): Promise<WebhookRecordOutcome> {
  const sb = getAdminClient();
  const { error } = await sb.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
  });
  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate")) return "duplicate";
    logger.error("stripe-webhook-idempotency-failed", { eventId, error: error.message });
    return "error";
  }
  return "recorded";
}

async function deleteWebhookEvent(eventId: string): Promise<void> {
  const sb = getAdminClient();
  await sb.from("stripe_webhook_events").delete().eq("event_id", eventId);
}