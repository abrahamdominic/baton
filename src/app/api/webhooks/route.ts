import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/env-boot";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifyWebhookSignature } from "@/lib/webhooks/verify";
import { dispatchEvent, isEventTracked } from "@/lib/webhooks/dispatcher";
import { rateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_SIZE_LIMIT = 1_000_000; // 1MB of raw JSON

export async function POST(req: NextRequest): Promise<NextResponse> {
  const eventType = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  const signature = req.headers.get("x-hub-signature-256");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!config.GITHUB_APP_WEBHOOK_SECRET) {
    logger.error("webhook-no-secret", { ip });
    return new NextResponse("misconfigured", { status: 500 });
  }

  if (!(await isAllowed(ip))) {
    logger.warn("webhook-rate-limited", { ip, event: eventType });
    return new NextResponse("rate limited", { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > BODY_SIZE_LIMIT) {
    logger.warn("webhook-too-large", { ip, event: eventType, bytes: raw.length });
    return new NextResponse("too large", { status: 413 });
  }

  if (!verifyWebhookSignature(config.GITHUB_APP_WEBHOOK_SECRET, raw, signature)) {
    logger.warn("webhook-bad-signature", { ip, event: eventType });
    return new NextResponse("invalid signature", { status: 401 });
  }

  // Not our event type — still a valid signature, acknowledge quietly.
  if (!isEventTracked(eventType)) {
    return new NextResponse("ok", { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  // Idempotency: one row per (deliveryId, eventType) forever.
  const recorded = await prisma.webhookEvent.create({
    data: { deliveryId, eventType, rawJson: raw },
  }).catch((e: { code?: string }) => {
    if (e.code === "P2002") {
      logger.debug("webhook-duplicate", { deliveryId, event: eventType });
      return null;
    }
    throw e;
  });
  if (!recorded) return new NextResponse("ok", { status: 200 });

  const schema = z.object({
    action: z.string().optional(),
    installation: z.object({ id: z.number() }).optional().nullable(),
    repository: z
      .object({
        name: z.string().optional(),
        owner: z.object({ login: z.string() }).optional(),
        full_name: z.string().optional(),
      })
      .optional()
      .nullable(),
    pull_request: z.object({ number: z.number() }).optional().nullable(),
    check_run: z
      .object({ pull_requests: z.array(z.object({ number: z.number() })).optional() })
      .optional(),
    check_suite: z
      .object({ pull_requests: z.array(z.object({ number: z.number() })).optional() })
      .optional(),
    comment: z.object({ user: z.object({ type: z.string().optional() }).optional() }).optional(),
    issue: z
      .object({
        pull_request: z.unknown().optional(),
        number: z.number().optional(),
      })
      .optional(),
    sender: z.object({ id: z.number().optional() }).optional(),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logger.warn("webhook-invalid-payload", { event: eventType, deliveryId });
    await prisma.webhookEvent.update({
      where: { deliveryId_eventType: { deliveryId, eventType } },
      data: { processedAt: new Date() },
    });
    return new NextResponse("bad payload", { status: 400 });
  }

  const result = dispatchEvent(eventType, parsed.data);
  if (result.jobs > 0 || result.handled !== "ignored") {
    logger.info("webhook-dispatched", {
      event: eventType,
      action: parsed.data.action,
      deliveryId,
      handled: result.handled,
      jobs: result.jobs,
    });
  }
  await prisma.webhookEvent.update({
    where: { deliveryId_eventType: { deliveryId, eventType } },
    data: { processedAt: new Date() },
  });

  return new NextResponse("ok", { status: 200 });
}

async function isAllowed(ip: string): Promise<boolean> {
  // 120 webhook deliveries per second per IP — generous; this is defense-in
  // depth against replay storms, not the primary control (idempotency is).
  return rateLimiter.check(`webhook:${ip}`, 120, 1000);
}