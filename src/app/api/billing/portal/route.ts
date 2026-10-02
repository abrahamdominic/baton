import { NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/net";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { currentUser } from "@/lib/auth/session";
import { config } from "@/lib/env-boot";
import { isStripeConfigured } from "@/lib/config";
import { createBillingPortalSession } from "@/lib/billing/billing-portal";
import { BackendNotConfiguredError, BillingInputError } from "@/lib/billing/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Open a Stripe Billing Portal session so the user can upgrade, downgrade, update
 * their card, or download an invoice.
 *
 * The return URL is validated against the app's own origin. A portal session
 * carries the user to Stripe and back, and an open redirect on the way out would
 * hand anyone who can influence the `returnUrl` parameter a trusted-looking link
 * out of the billing page.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const ip = clientIpFromHeaders(req.headers);

  if (!(await rateLimiter.check(`billing-portal:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const user = await currentUser();
  if (!user || user.suspendedAt) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!isStripeConfigured(config)) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  let returnUrl: string | null = null;
  try {
    const body = (await req.json()) as { returnUrl?: unknown };
    if (typeof body.returnUrl === "string") returnUrl = body.returnUrl;
  } catch {
    // Fall through to the default below; a missing body is not an error.
  }

  const origin = config.APP_URL || new URL(req.url).origin;
  const target = returnUrl ?? `${origin}/dashboard/billing`;

  let parsedTarget: URL;
  let parsedOrigin: URL;
  try {
    parsedTarget = new URL(target);
    parsedOrigin = new URL(origin);
  } catch {
    return NextResponse.json({ error: "Invalid return URL." }, { status: 400 });
  }
  if (parsedTarget.origin !== parsedOrigin.origin) {
    logger.warn("billing-portal-redirect-rejected", {
      userId: user.id,
      target: parsedTarget.origin,
    });
    return NextResponse.json({ error: "Invalid return URL." }, { status: 400 });
  }

  try {
    const session = await createBillingPortalSession({ userId: user.id, returnUrl: parsedTarget.toString() });
    return NextResponse.json(session, { status: 200 });
  } catch (err) {
    if (err instanceof BillingInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BackendNotConfiguredError) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    logger.error("billing-portal-session-failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not open the billing portal." }, { status: 500 });
  }
}
