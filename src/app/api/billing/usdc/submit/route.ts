import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { rateLimiter } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth/session";
import { submitUsdcTransactionHash } from "@/lib/billing/payments";
import { BillingInputError } from "@/lib/billing/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  paymentId: z.string().min(1),
  transactionHash: z.string().min(1).max(100),
});

/**
 * Accept the user's submitted Base transaction hash for a pending USDC order.
 * Validates shape, ownership and (app + DB) duplicate use, then flips the
 * payment to pending_verification for on-chain verification.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!(await rateLimiter.check(`billing-usdc-submit:${ip}`, 10, 60_000))) {
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

  try {
    const result = await submitUsdcTransactionHash({
      paymentId: parsed.paymentId,
      userId: user.id,
      transactionHash: parsed.transactionHash,
    });
    logger.info("billing-usdc-hash-submitted", { userId: user.id, paymentId: parsed.paymentId });
    return NextResponse.json({
      ok: true,
      paymentId: result.payment.id,
      status: result.payment.status,
      verified: result.verified,
    });
  } catch (err) {
    if (err instanceof BillingInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error("billing-usdc-submit-failed", { userId: user.id, paymentId: parsed.paymentId, error: String(err) });
    return NextResponse.json(
      { error: "Could not record your transaction. Please try again or contact support." },
      { status: 500 },
    );
  }
}