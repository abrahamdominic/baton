import type { PaymentProvider, PaymentStatus, SubscriptionStatus } from "./types";

/**
 * Pure routing decision for "Continue / Retry payment" on a pending checkout.
 *
 * This exists so the resume flow is a testable pure function: given the
 * authoritative server state of the subscription + its open payment, decide
 * where the user should finish paying (or that the checkout is closed). It
 * never invents state; every rule derives from the subscription/payment rows.
 */

export interface ResumeRouteInput {
  /** Must be `pending` or `payment_failed` for the checkout to be continuable. */
  subscriptionStatus: SubscriptionStatus;
  /** Id of the checkout's plan (used to fall back to the checkout page/reuse the row). */
  planId: string | null;
  planSlug: string | null;
  /** Derived billing interval carried by the open payment. */
  interval: "monthly" | "annual";
  /** Provider of the open payment; null when there is no open payment. */
  paymentProvider: PaymentProvider | null;
  /** Status of the open payment; null when there is no open payment. */
  paymentStatus: PaymentStatus | null;
  /** True when a USDC transaction hash has already been submitted. */
  hasCryptoTxHash: boolean;
  /** Id of the open payment (for the "recheck" result page URL). */
  paymentId: string | null;
  /** Live Stripe Checkout Session state, when one exists. */
  stripeSession:
    | { status: "open" | "complete" | "expired" | "missing"; url?: string | null }
    | null;
}

export type ResumeRoute =
  | { kind: "stripe_session"; url: string }
  | { kind: "usdc_order"; url: string }
  | { kind: "recheck"; url: string }
  | { kind: "closed"; url?: undefined };

export function resolveResumeRoute(input: ResumeRouteInput): ResumeRoute {
  // A checkout that is no longer open (confirmed/activated, cancelled, expired)
  // must not be resumed. The billing page re-reads state on refresh.
  if (input.subscriptionStatus !== "pending" && input.subscriptionStatus !== "payment_failed") {
    return { kind: "closed" };
  }
  if (!input.planId) return { kind: "closed" };

  const checkoutUrl = `/dashboard/billing/checkout?plan=${input.planId}&billing=${input.interval}`;
  const resultUrl = input.paymentId
    ? `/dashboard/billing/result?payment=${input.paymentId}`
    : `/dashboard/billing/result`;

  // Stripe: revive the ORIGINAL Checkout Session when it is still open (never a
  // duplicate purchase); when it is complete the money already moved, so point
  // at the result page; otherwise re-enter checkout against the SAME pending
  // subscription row.
  if (input.paymentProvider === "stripe" && input.paymentStatus) {
    if (input.stripeSession?.status === "open" && input.stripeSession.url) {
      return { kind: "stripe_session", url: input.stripeSession.url };
    }
    if (input.stripeSession?.status === "complete") {
      return { kind: "recheck", url: resultUrl };
    }
    return { kind: "usdc_order", url: checkoutUrl };
  }

  // USDC: with a submitted hash the user is awaiting on-chain verification
  // (result page); with a plain open order they must (re-)submit from checkout.
  if (input.paymentProvider === "usdc") {
    if (input.paymentStatus === "pending_verification" || input.hasCryptoTxHash) {
      return { kind: "recheck", url: resultUrl };
    }
    return { kind: "usdc_order", url: checkoutUrl };
  }

  // No open payment at all: the checkout row is orphaned; re-enter checkout
  // which reuses the same pending subscription (never a duplicate).
  return { kind: "usdc_order", url: checkoutUrl };
}