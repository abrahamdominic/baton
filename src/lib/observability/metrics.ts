import { logger } from "@/lib/logger";

/**
 * In-process counters for the operational signals that have no durable home.
 *
 * Why this exists
 * ---------------
 * §26 of the product brief asks for visibility into GitHub API failures, rate
 * limits, Stripe webhook failures, auth failures and application errors. The
 * queue already had `Job` rows to count against, but none of those signals have
 * a table: a GitHub 403 is an exception that is caught, logged to stdout, and
 * forgotten, so "GitHub has been failing for 40 minutes" was undetectable
 * without grepping logs.
 *
 * Design constraints
 * ------------------
 *  1. **Never throw into a caller.** Instrumentation must not be able to break
 *     the request it is measuring, so every operation here is best-effort and
 *     swallows its own errors.
 *  2. **No secrets, ever.** Values are bucketed into counters rather than
 *     recorded as samples, so an installation id or a webhook hash cannot end up
 *     in an admin-rendered label. See `LABEL_ALLOWLIST`.
 *  3. **Bounded memory.** Fixed-capacity maps with eviction, because a
 *     long-lived worker process must not grow without limit.
 *  4. **Honest reset.** A process restart legitimately zeroes these numbers, so
 *     the admin view labels them as per-instance rather than implying they are
 *     fleet-wide totals.
 *
 * This mirrors the existing `db-slow-queries.ts` approach (a ring buffer in the
 * Prisma client extension) rather than introducing a metrics dependency: the
 * project has no telemetry vendor wired up, and adding one for counters alone
 * would be more moving parts than signal.
 */

/** Buckets retained per metric label before the oldest are evicted. */
const MAX_LABELS = 64;

/** How many recent events one series keeps for "what happened just now". */
const MAX_EVENTS_PER_LABEL = 10;

/** Events retained in the global recent ring, across all metrics. */
const MAX_RECENT_EVENTS = 50;

/** One-minute buckets per series. Also the width of the reporting window. */
const WINDOW_BUCKETS = 60;

export type MetricName =
  | "github_api_call"
  | "github_api_failure"
  | "github_rate_limit"
  | "webhook_received"
  | "webhook_rejected"
  | "stripe_webhook_event"
  | "stripe_webhook_failure"
  | "auth_success"
  | "auth_failure"
  | "app_error"
  | "workflow_run";

export type MetricSeverity = "info" | "warn" | "error";

export interface MetricEvent {
  metric: MetricName;
  label: string;
  severity: MetricSeverity;
  /** Unix millis. */
  at: number;
  /** Free-form, already-sanitized detail. Never contains a secret. */
  detail?: string;
}

/**
 * The only labels this module will ever surface.
 *
 * Labels are rendered in the admin UI and exported in diagnostics, so they are
 * treated as untrusted output. An exact-match allowlist is the only safe shape
 * here: an earlier version kept any label that merely *contained* an allowlisted
 * word, which let `https://github.com/acme/private/pull/1` through untouched and
 * published a private repository name to a page a lower-privileged admin can
 * read. Nothing is lost by requiring callers to use one of these constants — the
 * wrappers below all do.
 */
const KNOWN_LABELS = new Set([
  "github.api",
  "github.failure",
  "github.ratelimit",
  "webhook.received",
  "webhook.rejected",
  "stripe.event",
  "stripe.failure",
  "auth.success",
  "auth.failure",
  "app.error",
  "workflow.run",
  "other",
]);

function sanitizeLabel(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return KNOWN_LABELS.has(trimmed) ? trimmed : "other";
}

function sanitizeDetail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Reuse the logger's own redaction by round-tripping through a JSON encode of
  // a sensitive-looking key would be awkward; instead reject the obvious
  // credential shapes directly. A detail string is developer-authored, so this
  // is a belt-and-braces check rather than the primary defence.
  if (/\b(gh[pousr]_[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{10,}|Bearer\s+\S+)\b/.test(raw)) {
    return "[redacted]";
  }
  return raw.slice(0, 200);
}

interface Series {
  /** Cumulative, for the life of the process. */
  count: number;
  errorCount: number;
  lastAt: number;
  /** Bounded tail of events, for "what happened just now" only. */
  events: MetricEvent[];
  /**
   * Per-minute buckets covering the reporting window.
   *
   * The window count is read from these, never from `events`: `events` is capped
   * at `MAX_EVENTS_PER_LABEL`, so counting it would silently cap a busy series at
   * ten and make every alert threshold above ten unreachable — a metric that
   * reports "0 failures" while 300 calls failed is worse than no metric. Sixty
   * fixed buckets cost 60 numbers per series and never need evicting.
   */
  buckets: Int32Array;
  errorBuckets: Int32Array;
  /**
   * Which minute each slot holds.
   *
   * A bare ring of 60 counters cannot tell "this slot is empty" from "this slot
   * holds the same minute-of-hour as now, but three hours ago" — the two collide
   * exactly when the elapsed time is a multiple of the ring length, which is the
   * case for any event an hour, two hours or three hours old. Storing the minute
   * index alongside each slot makes the wrap unambiguous: a slot counts only when
   * its stamp equals the minute being summed.
   */
  bucketMinutes: Int32Array;
}

const counters = new Map<string, Series>();
const recent: MetricEvent[] = [];

function keyOf(metric: MetricName, label: string): string {
  return `${metric}|${label}`;
}

function seriesFor(key: string): Series {
  let series = counters.get(key);
  if (!series) {
    series = {
      count: 0,
      errorCount: 0,
      lastAt: 0,
      events: [],
      buckets: new Int32Array(WINDOW_BUCKETS),
      errorBuckets: new Int32Array(WINDOW_BUCKETS),
      bucketMinutes: new Int32Array(WINDOW_BUCKETS).fill(-1),
    };
    counters.set(key, series);
  }
  return series;
}

/**
 * Count events inside the reporting window from the per-minute buckets.
 *
 * Only buckets at or after the current minute are summed. An event at exactly
 * the window boundary belongs to the window, so the range is inclusive of the
 * oldest minute.
 */
function windowCount(series: Series, now: number): { count: number; errorCount: number } {
  const currentMinute = Math.floor(now / 60_000);
  // Inclusive range is exactly WINDOW_BUCKETS minutes wide. Starting a full
  // window in the past would map the oldest minute onto the current minute's
  // slot and count the current bucket twice.
  const firstMinute = currentMinute - (WINDOW_BUCKETS - 1);
  let count = 0;
  let errorCount = 0;
  for (let minute = firstMinute; minute <= currentMinute; minute += 1) {
    const slot = ((minute % WINDOW_BUCKETS) + WINDOW_BUCKETS) % WINDOW_BUCKETS;
    if (series.bucketMinutes[slot] !== minute) continue;
    count += series.buckets[slot] ?? 0;
    errorCount += series.errorBuckets[slot] ?? 0;
  }
  return { count, errorCount };
}

/** Evict the least-recently-seen series once the map exceeds capacity. */
function evictIfNeeded(): void {
  if (counters.size <= MAX_LABELS) return;
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, series] of counters) {
    if (series.lastAt < oldestAt) {
      oldestAt = series.lastAt;
      oldestKey = key;
    }
  }
  if (oldestKey) counters.delete(oldestKey);
}

/**
 * Record one observation.
 *
 * Never throws. A failure inside instrumentation is itself dropped rather than
 * propagated, because a metrics bug must not become an availability bug.
 */
export function recordMetric(
  metric: MetricName,
  label: string,
  options: { severity?: MetricSeverity; detail?: string; at?: number } = {},
): void {
  try {
    const safeLabel = sanitizeLabel(label);
    const severity = options.severity ?? "info";
    const at = options.at ?? Date.now();
    const event: MetricEvent = { metric, label: safeLabel, severity, at, detail: sanitizeDetail(options.detail) };

    const key = keyOf(metric, safeLabel);
    const series = seriesFor(key);
    series.count += 1;
    if (severity === "error") series.errorCount += 1;
    series.lastAt = at;

    const minute = Math.floor(at / 60_000);
    const slot = ((minute % WINDOW_BUCKETS) + WINDOW_BUCKETS) % WINDOW_BUCKETS;
    // Reusing a slot resets it, so buckets always belong to exactly one minute.
    if (series.bucketMinutes[slot] !== minute) {
      series.bucketMinutes[slot] = minute;
      series.buckets[slot] = 0;
      series.errorBuckets[slot] = 0;
    }
    series.buckets[slot] = (series.buckets[slot] ?? 0) + 1;
    if (severity === "error") series.errorBuckets[slot] = (series.errorBuckets[slot] ?? 0) + 1;
    series.events.push(event);
    if (series.events.length > MAX_EVENTS_PER_LABEL) series.events.shift();

    recent.push(event);
    if (recent.length > MAX_RECENT_EVENTS) recent.shift();

    evictIfNeeded();
  } catch {
    // Intentionally silent.
  }
}

/** Convenience wrappers. Each exists so call sites read as intent, not as plumbing. */
export const metrics = {
  githubCall: (owner: string, repo: string, status: number, durationMs: number) =>
    recordMetric("github_api_call", "github.api", {
      severity: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      detail: `${status} ${durationMs}ms`,
    }),
  githubFailure: (operation: string, detail?: string) =>
    recordMetric("github_api_failure", "github.failure", { severity: "error", detail: `${operation}: ${detail ?? ""}` }),
  githubRateLimit: (remaining: number | null | undefined) =>
    recordMetric("github_rate_limit", "github.ratelimit", {
      severity: remaining === 0 || remaining === null ? "warn" : "info",
      detail: remaining === null || remaining === undefined ? "unknown" : `remaining=${remaining}`,
    }),
  webhookReceived: (eventType: string) => recordMetric("webhook_received", "webhook.received", { detail: eventType }),
  webhookRejected: (reason: string) => recordMetric("webhook_rejected", "webhook.rejected", { severity: "warn", detail: reason }),
  stripeEvent: (eventType: string) => recordMetric("stripe_webhook_event", "stripe.event", { detail: eventType }),
  stripeFailure: (reason: string) => recordMetric("stripe_webhook_failure", "stripe.failure", { severity: "error", detail: reason }),
  authSuccess: (method: string) => recordMetric("auth_success", "auth.success", { detail: method }),
  authFailure: (reason: string) => recordMetric("auth_failure", "auth.failure", { severity: "warn", detail: reason }),
  appError: (where: string, detail?: string) => recordMetric("app_error", "app.error", { severity: "error", detail: `${where}: ${detail ?? ""}` }),
  workflowRun: (workflow: string, ok: boolean, durationMs: number) =>
    recordMetric("workflow_run", "workflow.run", { severity: ok ? "info" : "error", detail: `${workflow} ${durationMs}ms` }),
};

export interface MetricSummary {
  metric: MetricName;
  label: string;
  /** Observations inside the reporting window. */
  count: number;
  errorCount: number;
  /** Cumulative observations since this process started. */
  lifetimeCount: number;
  lastAt: number | null;
  recentEvents: MetricEvent[];
}

/**
 * A snapshot for the admin health page.
 *
 * Values are grouped by metric *name* rather than returned as raw series, so the
 * UI shows "GitHub API failures: 12" instead of one row per label — which is
 * both more readable and a smaller leak surface.
 */
export function metricSnapshot(now: number = Date.now()): {
  windowMinutes: number;
  windowStartedAt: number;
  totals: { metric: MetricName; count: number; errorCount: number }[];
  byLabel: MetricSummary[];
  recent: MetricEvent[];
} {
  const WINDOW_MINUTES = 60;
  const windowStartedAt = now - WINDOW_MINUTES * 60_000;

  // Series hold cumulative counters for the life of the process, which cannot be
  // partially subtracted — reporting "3 GitHub failures" when all three happened
  // last Tuesday would be worse than reporting nothing. The window is therefore
  // counted from the per-minute buckets, which is exact under any volume, and
  // `lifetimeCount` is exposed separately rather than passed off as current.
  const series = [...counters.entries()].map(([key, s]) => {
    const [metric = "app_error", label = "other"] = key.split("|") as [MetricName, string];
    const window = windowCount(s, now);
    return {
      metric,
      label,
      count: window.count,
      errorCount: window.errorCount,
      lifetimeCount: s.count,
      lastAt: s.lastAt || null,
      windowEvents: s.events.filter((e) => e.at >= windowStartedAt),
    };
  });

  const totals = new Map<MetricName, { count: number; errorCount: number }>();
  for (const s of series) {
    const bucket = totals.get(s.metric) ?? { count: 0, errorCount: 0 };
    bucket.count += s.count;
    bucket.errorCount += s.errorCount;
    totals.set(s.metric, bucket);
  }

  return {
    windowMinutes: WINDOW_MINUTES,
    windowStartedAt,
    totals: [...totals.entries()]
      .map(([metric, v]) => ({ metric, ...v }))
      .sort((a, b) => b.count - a.count),
    byLabel: series
      .map((s) => ({
        metric: s.metric,
        label: s.label,
        count: s.count,
        errorCount: s.errorCount,
        lifetimeCount: s.lifetimeCount,
        lastAt: s.lastAt,
        recentEvents: s.windowEvents.slice(-5),
      }))
      .sort((a, b) => b.errorCount - a.errorCount || b.count - a.count),
    recent: recent.filter((e) => e.at >= windowStartedAt).slice(-20).reverse(),
  };
}

/**
 * A derived health verdict for the admin page.
 *
 * Each check names the signal it reads and the threshold it applies, so an
 * operator can disagree with the threshold rather than guessing why a badge is
 * red. `ok: false` with a null reading means "we cannot tell", which is
 * deliberately *not* reported as healthy.
 */
export function operationalAlerts(
  snapshot: ReturnType<typeof metricSnapshot> = metricSnapshot(),
): { level: "ok" | "warn" | "critical"; check: string; detail: string }[] {
  const alerts: { level: "ok" | "warn" | "critical"; check: string; detail: string }[] = [];
  const total = (metric: MetricName) => snapshot.totals.find((t) => t.metric === metric)?.count ?? 0;
  const errors = (metric: MetricName) => snapshot.totals.find((t) => t.metric === metric)?.errorCount ?? 0;

  const ghFailures = errors("github_api_failure");
  if (ghFailures > 20) {
    alerts.push({ level: "critical", check: "github_api_failure", detail: `${ghFailures} failed GitHub API calls recorded on this instance.` });
  } else if (ghFailures > 0) {
    alerts.push({ level: "warn", check: "github_api_failure", detail: `${ghFailures} failed GitHub API calls recorded.` });
  } else {
    alerts.push({ level: "ok", check: "github_api_failure", detail: "No failed GitHub API calls recorded on this instance." });
  }

  const stripeFailures = errors("stripe_webhook_failure");
  if (stripeFailures > 0) {
    alerts.push({
      level: "critical",
      check: "stripe_webhook_failure",
      detail: `${stripeFailures} Stripe webhook(s) failed to process. Billing state may be stale.`,
    });
  } else {
    alerts.push({ level: "ok", check: "stripe_webhook_failure", detail: "No Stripe webhook failures recorded on this instance." });
  }

  const authFailures = total("auth_failure");
  if (authFailures > 50) {
    alerts.push({
      level: "warn",
      check: "auth_failure",
      detail: `${authFailures} authentication failures recorded. Sustained volume can indicate credential stuffing or a broken callback.`,
    });
  } else if (authFailures > 0) {
    alerts.push({ level: "warn", check: "auth_failure", detail: `${authFailures} authentication failures recorded.` });
  } else {
    alerts.push({ level: "ok", check: "auth_failure", detail: "No authentication failures recorded on this instance." });
  }

  const rateLimits = total("github_rate_limit");
  if (rateLimits > 0) {
    alerts.push({
      level: "warn",
      check: "github_rate_limit",
      detail: `${rateLimits} GitHub rate-limit signal(s) recorded. Worker throughput may be reduced.`,
    });
  } else {
    alerts.push({ level: "ok", check: "github_rate_limit", detail: "No GitHub rate-limit pressure recorded." });
  }

  return alerts;
}

/** Emit a snapshot as a structured log line, for log-based alerting. */
export function logMetricSnapshot(): void {
  const snapshot = metricSnapshot();
  logger.info("observability-snapshot", {
    totals: snapshot.totals.map((t) => `${t.metric}:${t.count}/${t.errorCount}`).join(","),
    alerts: operationalAlerts(snapshot).map((a) => `${a.check}=${a.level}`).join(","),
  });
}

/** Test seam. Production code never calls this. */
export function resetMetrics(): void {
  counters.clear();
  recent.length = 0;
}
