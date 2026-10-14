// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as AnalyticsModule from "@/lib/billing/analytics";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  adminDashboardMetrics: vi.fn(),
  subscriptionStatusCounts: vi.fn(),
}));

// Keep the real `emptyAdminMetrics`; stub only the store reads.
vi.mock("@/lib/billing/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return {
    ...actual,
    adminDashboardMetrics: m.adminDashboardMetrics,
    subscriptionStatusCounts: m.subscriptionStatusCounts,
  };
});

vi.mock("@/lib/i18n/server-t", () => ({
  getTranslatorForRequest: async () => {
    const { createTranslator, createCountTranslator } = await import("@/lib/i18n/translate");
    const { englishFlat } = await import("@/lib/i18n/bundles");
    const fmt = await import("@/lib/i18n/format");
    const bundles = { en: englishFlat() };
    const locale = "en";
    return {
      t: createTranslator(bundles, locale),
      tc: createCountTranslator(bundles, locale),
      locale,
      direction: "ltr",
      tag: "en",
      formatDate: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => fmt.formatDate(v, locale, o),
      formatDateTime: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => fmt.formatDateTime(v, locale, o),
      formatTime: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => fmt.formatTime(v, locale, o),
    };
  },
}));

import AdminAnalyticsPage from "./page";
import { renderToStringWithI18n } from "@/lib/i18n/test-render";

const METRICS = {
  activeSubscriptions: 1,
  pendingSubscriptions: 0,
  pastDue: 0,
  canceledOrExpired: 0,
  payments: {
    byCurrency: { USD: { count: 1, amountMinor: 4900 } },
    byProvider: { stripe: { count: 1, amountMinor: 4900 } },
    byStatus: { confirmed: 1 },
    totalRows: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.subscriptionStatusCounts.mockResolvedValue({ active: 1 });
  m.adminDashboardMetrics.mockResolvedValue(METRICS);
});

async function render() {
  return renderToStringWithI18n(await AdminAnalyticsPage());
}

describe("admin analytics: billing store outage", () => {
  it("renders a notice instead of throwing when the store is unreachable", async () => {
    const outage = new Error("analytics.subs failed: TypeError: fetch failed");
    m.subscriptionStatusCounts.mockRejectedValue(outage);
    m.adminDashboardMetrics.mockRejectedValue(outage);

    const html = await render();

    expect(html).toContain("Billing store unavailable");
    expect(html).not.toContain("Technical details");
  });

  it("does not show the notice when the store reads succeed", async () => {
    const html = await render();
    expect(html).not.toContain("Billing store unavailable");
  });
});
