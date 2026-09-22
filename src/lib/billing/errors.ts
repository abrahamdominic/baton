/**
 * Safe, human-readable payment errors.
 *
 * Raw provider errors (Stripe decline codes, RPC payloads, DB constraints)
 * are NEVER surfaced to the user. This module maps known conditions to
 * friendly copy and provides a safe fallback.
 */

/** Raised when a sensitive operation requires a backend that is not configured. */
export class BackendNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendNotConfiguredError";
  }
}

/** Raised when a server-side operation rejects an input (untrusted values). */
export class BillingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingInputError";
  }
}

const STRIPE_FRIENDLY: Record<string, string> = {
  card_declined:
    "Your card was declined. Please try another payment method or contact your bank.",
  expired_card: "Your card has expired. Please try another card.",
  insufficient_funds: "Your card has insufficient funds for this purchase.",
  incorrect_number: "The card number you entered was incorrect.",
  incorrect_cvc: "The card security code (CVC) was incorrect.",
  incorrect_zip: "The postal code you entered was incorrect.",
  processing_error: "There was a processing error. Please try again in a moment.",
  authentication_required: "Your bank requires additional authentication to complete this payment.",
  "fraudulent":
    "This payment was declined for security reasons. Please use a different payment method.",
  transaction_not_allowed: "This card cannot be used for this type of purchase.",
  amount_too_large: "The amount exceeds your card’s limit.",
  invalid_expiry_month: "The card expiry date was invalid.",
};

export const FALLBACK_PAYMENT_FAILURE =
  "We couldn’t complete your payment. No subscription has been activated.";

export function friendlyPaymentFailure(reason: string | null | undefined, fallback = FALLBACK_PAYMENT_FAILURE): string {
  if (!reason) return fallback;
  const lowered = reason.toLowerCase().trim();
  // Also match loosely (e.g. "card declined" -> "card_declined").
  const normalized = lowered.replace(/[^a-z0-9]+/g, "_");
  for (const [code, copy] of Object.entries(STRIPE_FRIENDLY)) {
    if (lowered.includes(code) || normalized.includes(code)) return copy;
  }
  return fallback;
}

/** Safe internal code for a failure reason (never user-facing). */
export function paymentErrorCode(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const lowered = reason.toLowerCase();
  if (lowered.includes("duplicate")) return "duplicate_transaction";
  if (lowered.includes("amount")) return "amount_mismatch";
  if (lowered.includes("recipient") || lowered.includes("wallet")) return "recipient_mismatch";
  if (lowered.includes("token") || lowered.includes("usdc")) return "token_mismatch";
  if (lowered.includes("network")) return "network_mismatch";
  if (lowered.includes("finality") || lowered.includes("confirmation")) return "insufficient_finality";
  if (lowered.includes("cancel")) return "canceled";
  return null;
}