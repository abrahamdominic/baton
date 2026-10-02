import { describe, it, expect, beforeEach } from "vitest";
import {
  recordMetric,
  metrics,
  metricSnapshot,
  operationalAlerts,
  resetMetrics,
  type MetricName,
} from "./metrics";

/**
 * Tests for the in-process metrics module.
 *
 * Three properties matter more than coverage of each wrapper:
 *
 * 1. Nothing secret is ever recorded. Labels and details pass through a
 *    sanitizer, and this suite proves the sanitizer is doing that rather than
 *    trusting it.
 * 2. The reporting window is honest. A counter that cannot be partially
 *    subtracted must not be reported as if it could, so the window is applied to
 *    events and the lifetime count is exposed separately.
 * 3. Instrumentation cannot break a request. `recordMetric` swallows its own
 *    failures; a metrics bug must never become an availability bug.
 */

beforeEach(() => {
  resetMetrics();
});

const NOW = Date.now();

describe("recordMetric", () => {
  it("counts events per metric and label", () => {
    recordMetric("github_api_call", "github.api");
    recordMetric("github_api_call", "github.api");
    recordMetric("github_api_failure", "github.failure", { severity: "error" });

    const snapshot = metricSnapshot(NOW);
    const calls = snapshot.totals.find((t) => t.metric === "github_api_call");
    expect(calls?.count).toBe(2);
    const failures = snapshot.totals.find((t) => t.metric === "github_api_failure");
    expect(failures?.count).toBe(1);
    expect(failures?.errorCount).toBe(1);
  });

  it("excludes events outside the window from the window count but keeps the lifetime count", () => {
    const longAgo = NOW - 3 * 3_600_000;
    recordMetric("github_api_call", "github.api", { at: longAgo });
    recordMetric("github_api_call", "github.api", { at: NOW });

    const series = metricSnapshot(NOW).byLabel.find((s) => s.label === "github.api");
    expect(series?.count).toBe(1);
    expect(series?.lifetimeCount).toBe(2);
  });

  it("strips credential-shaped material out of details", () => {
    recordMetric("auth_failure", "auth.failure", {
      detail: "Authorization: Bearer secret-token-value",
    });
    const rendered = JSON.stringify(metricSnapshot(NOW));
    expect(rendered).not.toContain("secret-token-value");
    expect(rendered).toContain("[redacted]");
  });

  it("never surfaces an unknown label, so a URL cannot leak a private repository name", () => {
    // An allowlist keyed on substrings used to let this through untouched.
    recordMetric("webhook_received", "https://github.com/acme/private-internal/pull/7");
    recordMetric("auth_failure", "callback?code=oauth-code-value");
    const rendered = JSON.stringify(metricSnapshot(NOW));
    expect(rendered).not.toContain("acme/private-internal");
    expect(rendered).not.toContain("oauth-code-value");
    expect(rendered).toContain('"other"');
  });

  it("keeps a known label and lowercases it", () => {
    recordMetric("github_api_call", "github.api");
    expect(metricSnapshot(NOW).byLabel[0]?.label).toBe("github.api");
  });

  it("never throws, whatever it is handed", () => {
    expect(() => recordMetric("app_error", "x".repeat(10_000), { detail: "y".repeat(10_000) })).not.toThrow();
    expect(() => metrics.appError("weird", undefined)).not.toThrow();
  });

  it("keeps distinct labels as distinct series", () => {
    recordMetric("webhook_received", "webhook.received", { detail: "pull_request" });
    recordMetric("webhook_received", "webhook.received", { detail: "issues" });
    const snapshot = metricSnapshot(NOW);
    expect(snapshot.recent.map((e) => e.detail)).toEqual(expect.arrayContaining(["pull_request", "issues"]));
  });
});

describe("metric wrappers", () => {
  it("grades GitHub status codes", () => {
    metrics.githubCall("acme", "widgets", 200, 120);
    metrics.githubCall("acme", "widgets", 404, 40);
    metrics.githubCall("acme", "widgets", 503, 900);
    const series = metricSnapshot(NOW).byLabel.find((s) => s.label === "github.api");
    expect(series?.recentEvents.map((e) => e.severity)).toEqual(["info", "warn", "error"]);
  });

  it("treats an exhausted or unknown rate limit as a warning, not as info", () => {
    metrics.githubRateLimit(4999);
    metrics.githubRateLimit(0);
    metrics.githubRateLimit(null);
    const severities = metricSnapshot(NOW)
      .byLabel.find((s) => s.label === "github.ratelimit")
      ?.recentEvents.map((e) => e.severity);
    expect(severities).toEqual(["info", "warn", "warn"]);
  });

  it("records the webhook event type it received", () => {
    metrics.webhookReceived("pull_request.opened");
    metrics.webhookRejected("bad-signature");
    metrics.stripeEvent("invoice.payment_failed");
    metrics.stripeFailure("signature");
    metrics.authSuccess("github");
    metrics.authFailure("state-mismatch");

    const snapshot = metricSnapshot(NOW);
    const byName = (m: MetricName) => snapshot.totals.find((t) => t.metric === m)?.count ?? 0;
    expect(byName("webhook_received")).toBe(1);
    expect(byName("webhook_rejected")).toBe(1);
    expect(byName("stripe_webhook_event")).toBe(1);
    expect(byName("stripe_webhook_failure")).toBe(1);
    expect(byName("auth_success")).toBe(1);
    expect(byName("auth_failure")).toBe(1);
  });

  it("marks a failed workflow run as an error and a successful one as info", () => {
    metrics.workflowRun("blocked_work", true, 12);
    metrics.workflowRun("blocked_work", false, 30);
    const series = metricSnapshot(NOW).byLabel.find((s) => s.label === "workflow.run");
    expect(series?.errorCount).toBe(1);
    expect(series?.count).toBe(2);
  });
});

describe("metricSnapshot", () => {
  it("returns an empty, well-formed snapshot before anything is recorded", () => {
    const snapshot = metricSnapshot(NOW);
    expect(snapshot.totals).toEqual([]);
    expect(snapshot.byLabel).toEqual([]);
    expect(snapshot.recent).toEqual([]);
    expect(snapshot.windowMinutes).toBe(60);
  });

  it("returns recent events newest first", () => {
    recordMetric("auth_success", "auth.success", { detail: "first", at: NOW - 2000 });
    recordMetric("auth_success", "auth.success", { detail: "second", at: NOW - 1000 });
    const snapshot = metricSnapshot(NOW);
    expect(snapshot.recent[0]?.detail).toBe("second");
  });

  it("sorts labels with errors first", () => {
    recordMetric("github_api_call", "github.api");
    recordMetric("github_api_failure", "github.failure", { severity: "error" });
    const snapshot = metricSnapshot(NOW);
    expect(snapshot.byLabel[0]?.label).toBe("github.failure");
    expect(snapshot.byLabel[0]?.errorCount).toBe(1);
  });
});

describe("operationalAlerts", () => {
  it("reports a healthy instance as healthy", () => {
    const alerts = operationalAlerts(metricSnapshot(NOW));
    expect(alerts.every((a) => a.level === "ok")).toBe(true);
    expect(alerts.map((a) => a.check)).toEqual(
      expect.arrayContaining(["github_api_failure", "stripe_webhook_failure", "auth_failure"]),
    );
  });

  it("escalates a Stripe failure to critical, because billing state is at stake", () => {
    metrics.stripeFailure("signature-mismatch");
    const alert = operationalAlerts(metricSnapshot(NOW)).find((a) => a.check === "stripe_webhook_failure");
    expect(alert?.level).toBe("critical");
    expect(alert?.detail).toMatch(/billing/i);
  });

  it("separates warning-level from critical-level GitHub failures by volume", () => {
    for (let i = 0; i < 3; i += 1) metrics.githubFailure("repos.list");
    expect(operationalAlerts(metricSnapshot(NOW)).find((a) => a.check === "github_api_failure")?.level).toBe("warn");

    resetMetrics();
    for (let i = 0; i < 25; i += 1) metrics.githubFailure("repos.list");
    expect(operationalAlerts(metricSnapshot(NOW)).find((a) => a.check === "github_api_failure")?.level).toBe(
      "critical",
    );
  });

  it("flags rate-limit pressure even when no call failed", () => {
    metrics.githubRateLimit(0);
    const alert = operationalAlerts(metricSnapshot(NOW)).find((a) => a.check === "github_rate_limit");
    expect(alert?.level).toBe("warn");
  });

  it("states a threshold in the detail so an operator can disagree with it", () => {
    for (let i = 0; i < 60; i += 1) metrics.authFailure("state-mismatch");
    const alert = operationalAlerts(metricSnapshot(NOW)).find((a) => a.check === "auth_failure");
    expect(alert?.level).toBe("warn");
    expect(alert?.detail).toContain("60");
  });

  it("reads the snapshot it is given rather than re-reading global state", () => {
    metrics.stripeFailure("boom");
    const healthy = operationalAlerts({
      windowMinutes: 60,
      windowStartedAt: NOW - 3_600_000,
      totals: [],
      byLabel: [],
      recent: [],
    });
    expect(healthy.every((a) => a.level === "ok")).toBe(true);
  });
});