import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { config } from "@/lib/env-boot";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifyWebhookSignature } from "@/lib/webhooks/verify";
import { dispatchEvent, isEventTracked } from "@/lib/webhooks/dispatcher";
import { drainQueue } from "@/lib/engine/job-runner";
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

  // Not our event type; still a valid signature, acknowledge quietly.
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
  //
  // The unique constraint is on RECEIPT, but the short-circuit below only
  // applies once the row is marked `processedAt`. A delivery recorded by a
  // request that then died before enqueueing must be reprocessable on GitHub's
  // retry; treating "seen" as "done" would silently discard the only chance to
  // recover that work.
  const recorded = await prisma.webhookEvent.create({
    data: { deliveryId, eventType, rawJson: raw },
  }).catch(async (e: { code?: string }) => {
    if (e.code === "P2002") {
      const existing = await prisma.webhookEvent.findUnique({
        where: { deliveryId_eventType: { deliveryId, eventType } },
        select: { processedAt: true },
      });
      if (existing?.processedAt) {
        logger.debug("webhook-duplicate", { deliveryId, event: eventType });
        return "done" as const;
      }
      logger.info("webhook-retry-incomplete", { deliveryId, event: eventType });
      return "retry" as const;
    }
    throw e;
  });
  if (recorded === "done") return new NextResponse("ok", { status: 200 });

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

  // Enqueue BEFORE marking the delivery processed, and await it. If this throws
  // we answer 500 with `processedAt` still null, so GitHub's retry re-enters
  // the completed-delivery check above and the work is not lost.
  let result: Awaited<ReturnType<typeof dispatchEvent>>;
  try {
    result = await dispatchEvent(eventType, parsed.data);
  } catch (e) {
    logger.error("webhook-dispatch-failed", {
      event: eventType,
      deliveryId,
      error: e instanceof Error ? e.message : String(e),
    });
    return new NextResponse("dispatch failed", { status: 500 });
  }

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

  // Execute a small batch of the work this delivery just queued, in the same
  // invocation. The enqueue-then-wait-for-scheduler design meant a PR could sit
  // unclassified until the next cron tick — up to hours on a plan whose cron
  // cadence is coarse. GitHub expects a fast response, so the batch is small
  // and the drain is handed off with `after()`: the response is written
  // immediately and the work continues within the same function's budget.
  //
  // The event is already durably recorded and the jobs are already enqueued, so
  // this is strictly an optimization. Scheduling it must therefore never be able
  // to fail the request: `after()` throws outside a request scope, and letting
  // that escape would return 500 for a delivery we had in fact handled
  // successfully, making GitHub retry a webhook that needs no retry.
  if (result.jobs > 0) {
    const runInlineDrain = async (): Promise<void> => {
      try {
        await drainQueue({
          maxJobs: config.BATON_WEBHOOK_DRAIN_JOBS,
          budgetMs: config.BATON_WEBHOOK_DRAIN_BUDGET_MS,
          concurrency: 1,
          label: `webhook:${eventType}`,
        });
      } catch (e) {
        logger.error("webhook-drain-failed", {
          event: eventType,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    try {
      after(runInlineDrain);
    } catch (e) {
      // No request scope to defer into. Leave the work queued; the scheduled
      // drain will pick it up.
      logger.warn("webhook-drain-not-scheduled", {
        event: eventType,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new NextResponse("ok", { status: 200 });
}

async function isAllowed(ip: string): Promise<boolean> {
  // 120 webhook deliveries per second per IP. Generous; this is defense-in
  // depth against replay storms, not the primary control (idempotency is).
  return rateLimiter.check(`webhook:${ip}`, 120, 1000);
}