// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({ recentSystemEvents: vi.fn() }));

vi.mock("@/lib/billing/system-events", () => ({ recentSystemEvents: m.recentSystemEvents }));

// No real database is needed: the queue reads are stubbed below and the page
// does not touch Prisma directly. Mocking `@/lib/db` also keeps its slow-query
// Prisma extension out of the import graph.
vi.mock("@/lib/db", () => ({ prisma: {} }));

// The page also reads the job queue and in-process metrics. Those are not the
// subject here, so they are stubbed to quiet, healthy values; only the billing
// store read (system events) is exercised.
vi.mock("@/lib/engine/queue-metrics", () => ({
  queueSnapshot: async () => ({
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    deferred: 0,
    runnable: 0,
    oldestPendingAgeSec: null,
    completedLast24h: 0,
    failedLast24h: 0,
    stalled: false,
  }),
  jobLatency: async () => ({ overall: null, byKind: [] }),
  recentJobFailures: async () => [],
  expiringLeases: async () => 0,
  automationCoverage: async () => ({
    enabledRepos: 0,
    analysedRepos: 0,
    neverAnalysed: 0,
    totalFindings: 0,
    mostRecent: null,
    oldestUnanalysed: [],
  }),
}));
vi.mock("@/lib/db-slow-queries", () => ({ recentSlowQueries: () => [] }));
vi.mock("@/lib/observability/metrics", () => ({
  metricSnapshot: () => ({ windowMinutes: 15, windowStartedAt: 0, totals: [] }),
  operationalAlerts: () => [],
}));
vi.mock("./requeue-button", () => ({ RequeueButton: () => null }));

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

import AdminHealthPage from "./page";
import { renderToStringWithI18n } from "@/lib/i18n/test-render";

function event(over: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    eventType: "billing.error",
    severity: "error",
    status: null,
    message: "boom",
    userId: null,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.recentSystemEvents.mockResolvedValue([event()]);
});

async function render() {
  return renderToStringWithI18n(await AdminHealthPage({ searchParams: Promise.resolve({}) }));
}

describe("admin health: billing store outage", () => {
  it("renders the health page with a notice instead of throwing when the store is unreachable", async () => {
    m.recentSystemEvents.mockRejectedValue(new Error("system_events.list failed: TypeError: fetch failed"));

    const html = await render();

    // The health page is exactly the page an operator reaches for during an
    // outage, so it must keep rendering even when the store it reports on is down.
    expect(html).toContain("Billing store unavailable");
    expect(html).toContain("System Health &amp; Queue Status");
    expect(html).not.toContain("Technical details");
  });

  it("does not show the notice when the store read succeeds", async () => {
    const html = await render();
    expect(html).not.toContain("Billing store unavailable");
    expect(html).toContain("billing.error");
  });
});
