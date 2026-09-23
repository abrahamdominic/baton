import { describe, it, expect } from "vitest";
import {
  annualFromMonthly,
  isAnnualDiscount,
  annualAmountDescription,
} from "./pricing";

describe("annual pricing: exactly 20% off the monthly rate", () => {
  it("Team: $10/user/month → $96/user/year (1200 → 9600)", () => {
    expect(annualFromMonthly(1000)).toBe(9600);
    expect(isAnnualDiscount(1000, 9600)).toBe(true);
  });

  it("Organization: $50/user/month → $480/user/year (6000 → 48000)", () => {
    expect(annualFromMonthly(5000)).toBe(48000);
    expect(isAnnualDiscount(5000, 48000)).toBe(true);
  });

  it("multiplies 12 periods and applies exactly 80%", () => {
    expect(annualFromMonthly(1)).toBe(10); // 12 * 0.8 = 9.6 → 10
    expect(annualFromMonthly(250)).toBe(2400); // 12 * 250 * 0.8 = 2400
    expect(annualFromMonthly(799)).toBe(7670); // 12*799*0.8 = 7670.4 → 7670
  });

  it("rejects off-by-one discounts that are not exactly 20%", () => {
    expect(isAnnualDiscount(1000, 9599)).toBe(false);
    expect(isAnnualDiscount(1000, 9601)).toBe(false);
    expect(isAnnualDiscount(5000, 47999)).toBe(false);
  });

  it("rejects zero / negative / non-safe monthly inputs", () => {
    expect(() => annualFromMonthly(0)).not.toThrow(); // 0 → 0
    expect(() => annualFromMonthly(-5)).toThrow(/invalid monthly price/);
    expect(() => annualFromMonthly(Number.NaN)).toThrow(/invalid monthly price/);
    expect(() => annualFromMonthly(Number.MAX_SAFE_INTEGER)).toThrow(/overflows safe integer range/);
  });

  it("describes the expected annual amount", () => {
    expect(annualAmountDescription(1000)).toBe("$96.00/year for a $10.00/month plan");
  });
});