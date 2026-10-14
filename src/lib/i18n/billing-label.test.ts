import { describe, it, expect } from "vitest";
import {
  cryptoNetworkLabel,
  paymentStatusLabel,
  subscriptionStatusLabel,
  DEFAULT_CRYPTO_NETWORK,
} from "./billing-label";
import { createTranslator } from "./translate";
import { englishFlat } from "./bundles";

const t = createTranslator({ en: englishFlat() }, "en");

describe("cryptoNetworkLabel", () => {
  it("passes a real network through untouched", () => {
    expect(cryptoNetworkLabel("base")).toBe("base");
    expect(cryptoNetworkLabel("Base")).toBe("Base");
  });

  it("falls back to the settled network for null or undefined", () => {
    expect(cryptoNetworkLabel(null)).toBe(DEFAULT_CRYPTO_NETWORK);
    expect(cryptoNetworkLabel(undefined)).toBe(DEFAULT_CRYPTO_NETWORK);
  });

  /**
   * Regression: an empty `USDC_NETWORK` in the deployment baked `""` into
   * payment rows. Interpolating that into `{{network}}` throws in
   * non-production, so the billing page hit its error boundary.
   */
  it("falls back for an empty string rather than returning it", () => {
    expect(cryptoNetworkLabel("")).toBe(DEFAULT_CRYPTO_NETWORK);
  });

  it("falls back for whitespace-only values", () => {
    expect(cryptoNetworkLabel("   ")).toBe(DEFAULT_CRYPTO_NETWORK);
    expect(cryptoNetworkLabel("base\n")).toBe("base");
  });

  it("never produces a blank value the translator would reject", () => {
    for (const value of [null, undefined, "", " ", "\n", "base"]) {
      expect(cryptoNetworkLabel(value).trim()).not.toBe("");
    }
  });
});

describe("paymentStatusLabel", () => {
  it("translates a known status from the real bundle", () => {
    expect(paymentStatusLabel("pending", t)).not.toBe("pending");
    expect(paymentStatusLabel("pending", t)).toMatch(/pending/i);
  });

  it("falls back to the raw slug for an unrecognised status", () => {
    expect(paymentStatusLabel("something_new", t)).toBe("something_new");
  });
});

describe("subscriptionStatusLabel", () => {
  it("translates a known status from the real bundle", () => {
    expect(subscriptionStatusLabel("active", t)).toMatch(/active/i);
  });

  it("falls back to the raw slug for an unrecognised status", () => {
    expect(subscriptionStatusLabel("something_new", t)).toBe("something_new");
  });
});
