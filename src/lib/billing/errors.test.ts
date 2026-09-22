import { describe, it, expect } from "vitest";
import {
  friendlyPaymentFailure,
  paymentErrorCode,
  FALLBACK_PAYMENT_FAILURE,
  BackendNotConfiguredError,
  BillingInputError,
} from "./errors";

describe("friendlyPaymentFailure", () => {
  it("maps known Stripe decline reasons to safe copy", () => {
    expect(friendlyPaymentFailure("Your card has insufficient funds. [code: insufficient_funds]")).toBe(
      "Your card has insufficient funds for this purchase.",
    );
    expect(friendlyPaymentFailure("card declined")).toBe(
      "Your card was declined. Please try another payment method or contact your bank.",
    );
    expect(friendlyPaymentFailure("expired_card")).toBe("Your card has expired. Please try another card.");
  });

  it("never leaks unknown provider details, always the fallback", () => {
    expect(friendlyPaymentFailure("some_internal_rpc_secret_error")).toBe(FALLBACK_PAYMENT_FAILURE);
    expect(friendlyPaymentFailure(null)).toBe(FALLBACK_PAYMENT_FAILURE);
    expect(friendlyPaymentFailure(undefined)).toBe(FALLBACK_PAYMENT_FAILURE);
    expect(friendlyPaymentFailure("")).toBe(FALLBACK_PAYMENT_FAILURE);
  });

  it("returns raw-sounding text containing secret strings is still mapped to fallback", () => {
    expect(friendlyPaymentFailure("authorization_required")).toBe(FALLBACK_PAYMENT_FAILURE);
  });
});

describe("paymentErrorCode", () => {
  it("classifies common failure reasons into stable codes", () => {
    expect(paymentErrorCode("duplicate transaction hash")).toBe("duplicate_transaction");
    expect(paymentErrorCode("amount_mismatch")).toBe("amount_mismatch");
    expect(paymentErrorCode("recipient mismatch")).toBe("recipient_mismatch");
    expect(paymentErrorCode("token mismatch")).toBe("token_mismatch");
    expect(paymentErrorCode("network mismatch")).toBe("network_mismatch");
    expect(paymentErrorCode("insufficient finality")).toBe("insufficient_finality");
  });

  it("returns null for unrecognized reasons", () => {
    expect(paymentErrorCode(null)).toBeNull();
    expect(paymentErrorCode("mystery failure")).toBeNull();
  });
});

describe("typed error classes", () => {
  it("carries name for server-side detection", () => {
    expect(new BackendNotConfiguredError("x").name).toBe("BackendNotConfiguredError");
    expect(new BillingInputError("x").name).toBe("BillingInputError");
    expect(new BillingInputError("x") instanceof Error).toBe(true);
  });
});