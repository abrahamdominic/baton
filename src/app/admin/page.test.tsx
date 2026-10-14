// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as AnalyticsModule from "@/lib/billing/analytics";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  adminDashboardMetrics: vi.fn(),
  listPaymentsAdmin: vi.fn(),
  recentSystemEvents: vi.fn(),
  userCount: vi.fn(),
  repoCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { count: m.userCount }, repo: { count: m.repoCount } },
}));
// Keep the real `emptyAdminMetrics` and `formatCurrencyTotal`; only the store
// read is stubbed so the test exercises the page's real fallback path.
vi.mock("@/lib/billing/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, adminDashboardMetrics: m.adminDashboardMetrics };
});
vi.mock("@/lib/billing/payments", () => ({ listPaymentsAdmin: m.listPaymentsAdmin }));
vi.mock("@/lib/billing/system-events", () => ({ recentSystemEvents: m.recentSystemEvents }));

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

import AdminOverviewPage from "./page";
import { renderToStringWithI18n } from "@/lib/i18n/test-render";

const METRICS = {
  activeSubscriptions: 2,
  pendingSubscriptions: 1,
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
  m.userCount.mockResolvedValue(3);
  m.repoCount.mockResolvedValue(1);
  m.adminDashboardMetrics.mockResolvedValue(METRICS);
  m.listPaymentsAdmin.mockResolvedValue([]);
  m.recentSystemEvents.mockResolvedValue([]);
});

async function render() {
  return renderToStringWithI18n(await AdminOverviewPage());
}

describe("admin overview: billing store outage", () => {
  it("renders a notice instead of throwing when the store is unreachable", async () => {
    const outage = new Error("payments.admin-list failed: TypeError: fetch failed");
    m.adminDashboardMetrics.mockRejectedValue(outage);
    m.listPaymentsAdmin.mockRejectedValue(outage);
    m.recentSystemEvents.mockRejectedValue(outage);

    const html = await render();

    expect(html).toContain("Billing store unavailable");
    expect(html).not.toContain("Technical details");
  });

  it("does not show the notice when the store reads succeed", async () => {
    const html = await render();
    expect(html).not.toContain("Billing store unavailable");
  });
});
