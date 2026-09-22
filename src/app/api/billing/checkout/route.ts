import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { rateLimiter } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth/session";
import { config } from "@/lib/env-boot";
import { isStripeConfigured, isUsdcConfigured } from "@/lib/config";
import { getPlanById } from "@/lib/billing/plans";
import { prepareSubscriptionForCheckout } from "@/lib/billing/subscriptions";
import { createUsdcPayment, createStripePayment, patchPayment } from "@/lib/billing/payments";
import { createStripeCheckoutSession } from "@/lib/billing/stripe";
import { planPriceCents } from "@/lib/billing/pricing";
import { BillingInputError, BackendNotConfiguredError } from "@/lib/billing/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  planId: z.string().min(1),
  billing: z.enum(["monthly", "annual"]),
  provider: z.enum(["stripe", "usdc"]),
});

/**
 * Begin checkout for a plan. Creates (or reuses) a pending subscription and a
 * payment row, then returns either a Stripe Checkout URL or a USDC order the
 * client must pay (wallet address + exact amount shown on the checkout page).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!(await rateLimiter.check(`billing-checkout:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: "Too many checkout attempts. Try again shortly." }, { status: 429 });
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

  const plan = await getPlanById(parsed.planId).catch(() => null);
  if (!plan || !plan.is_active) {
    return NextResponse.json({ error: "That plan does not exist or is no longer available." }, { status: 404 });
  }

  const forbiddenCreate = parsed.provider === "stripe" && !isStripeConfigured(config);
  const forbiddenUsdc = parsed.provider === "usdc" && !isUsdcConfigured(config);
  if (forbiddenCreate || forbiddenUsdc) {
    return NextResponse.json(
      { error: "This payment method is not available right now. Please try another option." },
      { status: 501 },
    );
  }

  try {
    const prepared = await prepareSubscriptionForCheckout(user.id, plan.id, parsed.provider);
    const subscription = prepared.subscription;
    if (prepared.alreadyOnPlan) {
      return NextResponse.json(
        { error: "You're already on this plan." },
        { status: 409 },
      );
    }

    const amount = planPriceCents(plan, parsed.billing);
    if (amount <= 0 && parsed.provider === "usdc") {
      return NextResponse.json(
        { error: "This plan has no payable price (custom pricing). Choose a different plan." },
        { status: 400 },
      );
    }

    if (parsed.provider === "stripe") {
      const payment = await createStripePayment({
        userId: user.id,
        subscriptionId: subscription.id,
        planId: plan.id,
        amount,
        interval: parsed.billing,
      });
      const { url, sessionId } = await createStripeCheckoutSession({
        userId: user.id,
        plan,
        interval: parsed.billing,
        subscriptionId: subscription.id,
        paymentId: payment.id,
        successUrl: new URL(`/dashboard/billing/result?payment=${payment.id}`, config.SITE_URL).toString(),
        cancelUrl: new URL(`/dashboard/billing/checkout?plan=${plan.id}&billing=${parsed.billing}`, config.SITE_URL).toString(),
      });
      await patchPayment(payment.id, { stripe_checkout_session_id: sessionId });
      logger.info("billing-stripe-session-created", { userId: user.id, plan: plan.slug, provider: "stripe" });
      return NextResponse.json({ provider: "stripe", url, sessionId, paymentId: payment.id });
    }

    const payment = await createUsdcPayment({
      userId: user.id,
      subscriptionId: subscription.id,
      planId: plan.id,
      amount,
      interval: parsed.billing,
      paymentType: prepared.renewal ? "renewal" : "initial_subscription",
    });
    logger.info("billing-usdc-order-created", { userId: user.id, plan: plan.slug, provider: "usdc", renewal: prepared.renewal });
    return NextResponse.json({
      provider: "usdc",
      paymentId: payment.id,
      amountMinor: payment.amount,
      walletAddress: payment.crypto_wallet_address,
      network: payment.crypto_network,
      token: payment.crypto_token,
      txSubmitted: false,
      renewal: prepared.renewal,
    });
  } catch (err) {
    if (err instanceof BillingInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BackendNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    logger.error("billing-checkout-failed", { userId: user.id, error: String(err) });
    return NextResponse.json(
      { error: "Checkout could not be completed. Please try again or contact support." },
      { status: 500 },
    );
  }
}