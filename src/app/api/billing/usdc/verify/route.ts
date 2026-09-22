import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { rateLimiter } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth/session";
import { getPaymentById, verifyUsdcPaymentNow } from "@/lib/billing/payments";
import { BillingInputError, BackendNotConfiguredError } from "@/lib/billing/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ paymentId: z.string().min(1) });

/**
 * Trigger on-chain verification for a USDC payment (owner-only). Returns a
 * stable `code` the result page can map to a friendly payment outcome.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!(await rateLimiter.check(`billing-usdc-verify:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const user = await currentUser();
  if (!user || user.suspendedAt) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payment = await getPaymentById(parsed.paymentId).catch(() => null);
  if (!payment || payment.user_id !== user.id) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  try {
    const outcome = await verifyUsdcPaymentNow(payment.id);
    return NextResponse.json({
      ok: outcome.ok,
      code: outcome.code,
      status: outcome.payment.status,
      paymentId: outcome.payment.id,
      ...(outcome.ok ? {} : { detail: outcome.detail ?? null }),
    });
  } catch (err) {
    if (err instanceof BillingInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BackendNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    logger.error("billing-usdc-verify-failed", { userId: user.id, paymentId: parsed.paymentId, error: String(err) });
    return NextResponse.json(
      { error: "Verification could not complete right now. Try again in a minute." },
      { status: 500 },
    );
  }
}