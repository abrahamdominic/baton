import { describe, it, expect } from "vitest";
import {
  annualFromMonthly,
  isAnnualDiscount,
  annualAmountDescription,
} from "./pricing";

describe("annual pricing: exactly two months free (monthly × 10)", () => {
  it("Team: $15/month → $150/year (1500 → 15000)", () => {
    expect(annualFromMonthly(1500)).toBe(15000);
    expect(isAnnualDiscount(1500, 15000)).toBe(true);
  });

  it("Organization: $49/month → $490/year (4900 → 49000)", () => {
    expect(annualFromMonthly(4900)).toBe(49000);
    expect(isAnnualDiscount(4900, 49000)).toBe(true);
  });

  it("charges ten monthly periods", () => {
    expect(annualFromMonthly(1)).toBe(10); // 12 * 0.8 = 9.6 → 10
    expect(annualFromMonthly(250)).toBe(2500);
    expect(annualFromMonthly(799)).toBe(7990);
  });

  it("rejects off-by-one discounts that are not exactly 20%", () => {
    expect(isAnnualDiscount(1500, 14999)).toBe(false);
    expect(isAnnualDiscount(1500, 15001)).toBe(false);
    expect(isAnnualDiscount(4900, 48999)).toBe(false);
  });

  it("rejects zero / negative / non-safe monthly inputs", () => {
    expect(() => annualFromMonthly(0)).not.toThrow(); // 0 → 0
    expect(() => annualFromMonthly(-5)).toThrow(/invalid monthly price/);
    expect(() => annualFromMonthly(Number.NaN)).toThrow(/invalid monthly price/);
    expect(() => annualFromMonthly(Number.MAX_SAFE_INTEGER)).toThrow(/overflows safe integer range/);
  });

  it("describes the expected annual amount", () => {
    expect(annualAmountDescription(1500)).toBe("$150.00/year for a $15.00/month plan");
  });
});
