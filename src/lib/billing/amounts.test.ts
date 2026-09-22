import { describe, it, expect } from "vitest";
import { minorToUsdcOnchain, usdcOnchainToMinor, formatMoney } from "./amounts";

describe("amount conversions", () => {
  it("converts cents to 6-decimal on-chain units (factor 10^4)", () => {
    expect(minorToUsdcOnchain(1000)).toBe(10_000_000); // $10.00 → 10 USDC with 6 decimals
    expect(minorToUsdcOnchain(150)).toBe(1_500_000);
    expect(minorToUsdcOnchain(0)).toBe(0);
  });

  it("round-trips cents -> on-chain -> cents", () => {
    for (const cents of [0, 1, 25, 99, 1000, 79999]) {
      expect(usdcOnchainToMinor(minorToUsdcOnchain(cents))).toBe(cents);
    }
  });

  it("rejects sub-cent transfers (cannot match a 2-decimal price)", () => {
    expect(() => usdcOnchainToMinor(1)).toThrow(/non-decimal-cent/); // 0.000001 USDC
    expect(() => usdcOnchainToMinor(1234)).toThrow(/non-decimal-cent/);
  });

  it("rejects negative and unsafe values", () => {
    expect(() => minorToUsdcOnchain(-5)).toThrow(/invalid amount/);
    expect(() => minorToUsdcOnchain(Number.NaN)).toThrow(/invalid amount/);
  });
});

describe("formatMoney", () => {
  it("formats minor units with two decimals", () => {
    expect(formatMoney(1000, "USD")).toBe("$10.00");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(1500, "USD")).toBe("$15.00");
  });

  it("labels USDC", () => {
    expect(formatMoney(1000, "USDC")).toBe("$10.00 USDC");
  });

  it("handles negative amounts with a minus sign", () => {
    expect(formatMoney(-500, "USD")).toBe("-$5.00");
  });
});