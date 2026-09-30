import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from "./format";

describe("locale-aware formatters (lan.md §13)", () => {
  describe("numbers", () => {
    it("groups digits per locale", () => {
      expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
      expect(formatNumber(1234567, "de-DE")).toBe("1.234.567");
      expect(formatNumber(1234567, "fr-FR")).toBe("1 234 567");
    });

    it("uses the locale's decimal separator", () => {
      expect(formatNumber(1234.5, "en-US")).toBe("1,234.5");
      expect(formatNumber(1234.5, "de-DE")).toBe("1.234,5");
    });

    it("compacts large counts using CLDR patterns", () => {
      expect(formatCompact(1200, "en-US")).toBe("1.2K");
      expect(formatCompact(1500000, "en-US")).toBe("1.5M");
    });

    it("formats percentages from human-facing units, not ratios", () => {
      // 12.5 means "12.5%", so the value must not be divided twice.
      expect(formatPercent(12.5, "en-US")).toBe("12.5%");
      // de-DE puts a non-breaking space before the percent sign.
      expect(formatPercent(12.5, "de-DE")).toBe("12,5\u00A0%");
    });
  });

  describe("currency", () => {
    it("converts minor units to major units exactly once", () => {
      expect(formatCurrency(123456, "USD", "en-US")).toBe("$1,234.56");
      expect(formatCurrency(0, "USD", "en-US")).toBe("$0.00");
      expect(formatCurrency(5, "USD", "en-US")).toBe("$0.05");
    });

    it("places the symbol per locale", () => {
      // de-DE separates the symbol with a non-breaking space (U+00A0).
      expect(formatCurrency(123456, "EUR", "de-DE")).toBe("1.234,56\u00A0€");
      expect(formatCurrency(123456, "JPY", "ja-JP")).toContain("1,235");
    });

    it("respects currencies that have no minor unit", () => {
      // 123456 minor units is 1234.56 major units, and JPY has no minor unit,
      // so Intl rounds rather than rendering fractional yen.
      expect(formatCurrency(123456, "JPY", "en-US")).toBe("¥1,235");
      expect(formatCurrency(123456, "USD", "en-US")).toBe("$1,234.56");
    });
  });

  describe("dates and times", () => {
    const when = new Date("2026-03-09T14:05:00Z");

    it("defaults to a medium date and respects an explicit style", () => {
      expect(formatDate(when, "en-US")).toBe("Mar 9, 2026");
      expect(formatDate(when, "en-US", { dateStyle: "full" })).toContain(
        "2026",
      );
    });

    it("orders date parts per locale", () => {
      const iso = formatDate(when, "en-CA", { dateStyle: "short" });
      const jp = formatDate(when, "ja-JP", { dateStyle: "short" });
      expect(iso).toBe("2026-03-09");
      expect(jp).not.toBe(iso);
    });

    it("accepts ISO strings and epoch numbers", () => {
      expect(
        formatDate("2026-03-09T14:05:00Z", "en-CA", { dateStyle: "short" }),
      ).toBe("2026-03-09");
      expect(formatDate(when.getTime(), "en-CA", { dateStyle: "short" })).toBe(
        "2026-03-09",
      );
    });

    it("formats times and combined date-times", () => {
      expect(formatTime(when, "en-US")).toMatch(/\d/);
      const both = formatDateTime(when, "en-US");
      expect(both).toContain("2026");
    });
  });

  describe("relative time", () => {
    const now = new Date("2026-03-09T12:00:00Z");

    it("describes past and future in the target language", () => {
      expect(formatRelative("2026-03-06T12:00:00Z", "en-US", now)).toBe(
        "3 days ago",
      );
      expect(formatRelative("2026-03-12T12:00:00Z", "en-US", now)).toBe(
        "in 3 days",
      );
    });

    it("does not concatenate the unit into an English-shaped phrase", () => {
      // A hand-rolled `${n} days ago` cannot produce this ordering.
      const es = formatRelative("2026-03-06T12:00:00Z", "es", now);
      expect(es).not.toBe("3 days ago");
      expect(es).toContain("3");
    });

    it("picks the largest sensible unit", () => {
      expect(formatRelative("2025-03-09T12:00:00Z", "en-US", now)).toBe(
        "last year",
      );
      expect(formatRelative("2026-03-09T11:59:00Z", "en-US", now)).toBe(
        "1 minute ago",
      );
    });
  });

  describe("currency codes the ledger actually stores", () => {
    // Regression: the payments table stores "usdc" for the Base/USDC rail, which
    // is a ticker and not an ISO-4217 code. Passing it to Intl as a currency
    // throws `RangeError: Invalid currency code : USDC`, and because that throw
    // happened while the billing Server Component rendered, it replaced the
    // whole /dashboard/billing page with an error boundary for every user who
    // had ever paid in USDC.
    it("does not throw on a stablecoin ticker", () => {
      expect(() => formatCurrency(9600, "USDC", "en-US")).not.toThrow();
    });

    it("does not throw on the lowercase form stored in the database", () => {
      expect(() => formatCurrency(9600, "usdc", "en-US")).not.toThrow();
    });

    it("renders the amount with the ticker, at the correct magnitude", () => {
      // 9600 is 96.00. Dividing by 100 is what keeps this from reading 9600.
      expect(formatCurrency(9600, "USDC", "en-US")).toBe("USDC 96.00");
    });

    it("keeps two decimal places for a sub-unit amount", () => {
      expect(formatCurrency(1000, "usdc", "en-US")).toBe("USDC 10.00");
    });

    it("still formats real ISO currencies through Intl", () => {
      expect(formatCurrency(9600, "USD", "en-US")).toBe("$96.00");
    });

    it("is not fooled by whitespace or casing in the stored value", () => {
      expect(formatCurrency(9600, "  usdc  ", "en-US")).toBe("USDC 96.00");
    });

    it("does not throw on any other non-ISO value a rail might introduce", () => {
      for (const code of ["ETH", "MATIC", "", "not-a-code"]) {
        expect(() => formatCurrency(100, code, "en-US")).not.toThrow();
      }
    });
  });

  describe("bytes", () => {
    it("scales to a readable unit and keeps integers byte-exact", () => {
      expect(formatBytes(512, "en-US")).toBe("512 B");
      expect(formatBytes(1500, "en-US")).toBe("1.5 kB");
      expect(formatBytes(4_200_000, "en-US")).toBe("4.2 MB");
    });
  });

  it("does not invent a currency code when the ledger row has none", () => {
    // A blank code is a data defect, not a ticker. " 96.00" with a leading space
    // would read like a truncated currency symbol.
    expect(formatCurrency(9600, "", "en-US")).toBe("96.00");
    expect(formatCurrency(9600, "   ", "en-US")).toBe("96.00");
  });

  it("accepts a lowercase ticker from the ledger", () => {
    expect(formatCurrency(9600, "usdc", "en-US")).toBe("USDC 96.00");
  });

  it("formats an ISO code through Intl as usual", () => {
    expect(formatCurrency(9600, "USD", "en-US")).toBe("$96.00");
    expect(formatCurrency(9600, "EUR", "de-DE")).toContain("96,00");
  });
});
