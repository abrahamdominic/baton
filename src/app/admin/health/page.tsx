import type { Metadata } from "next";
import Link from "next/link";
import { recentSystemEvents } from "@/lib/billing/system-events";
import { queueSnapshot, jobLatency, recentJobFailures } from "@/lib/engine/queue-metrics";
import { recentSlowQueries } from "@/lib/db-slow-queries";
import { StatCard, PageHeader } from "@/components/ui";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { formatTime } from "@/lib/i18n/format";
import {
  IconAlertCircle,
  IconClock,
  IconArrowLeft,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    robots: { index: false, follow: false },
    title: `${t("admin:health_title")}: Baton Admin`,
  };
}

export default async function AdminHealthPage({
  searchParams,
}: {
  searchParams?: Promise<{ severity?: string }>;
}) {
  const { t, locale } = await getTranslatorForRequest();
  const params = searchParams ? await searchParams : undefined;
  const severityFilter = params?.severity ?? "all";

  const [events, queue, latency, failures, slowQueries] = await Promise.all([
    recentSystemEvents(100),
    queueSnapshot(),
    jobLatency(),
    recentJobFailures(),
    Promise.resolve(recentSlowQueries()),
  ]);

  const errorCount = events.filter((e) => e.severity === "error").length;
  const warnCount = events.filter((e) => e.severity === "warn").length;
  const infoCount = events.filter((e) => e.severity === "info").length;
  const jobCounts: Record<string, number> = {
    pending: queue.pending,
    processing: queue.processing,
    done: queue.done,
    failed: queue.failed,
  };

  const filteredEvents =
    severityFilter === "error"
      ? events.filter((e) => e.severity === "error")
      : severityFilter === "warn"
      ? events.filter((e) => e.severity === "warn")
      : severityFilter === "info"
      ? events.filter((e) => e.severity === "info")
      : events;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title={t("admin:health_title")}
        description={t("admin:health_description")}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>{t("admin:back_to_control_panel")}</span>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={t("admin:health_recent_errors")}
          value={errorCount}
          detail={errorCount > 0 ? t("admin:health_recent_errors_warn") : t("admin:health_recent_errors_clear")}
          tone={errorCount > 0 ? "danger" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label={t("admin:health_warnings")}
          value={warnCount}
          detail={warnCount > 0 ? t("admin:health_warnings_warn") : t("admin:health_warnings_clear")}
          tone={warnCount > 0 ? "warn" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label={t("admin:health_failed_jobs")}
          value={queue.failedLast24h}
          detail={queue.failedLast24h > 0 ? t("admin:health_failed_jobs_warn") : t("admin:health_failed_jobs_clear")}
          tone={queue.failedLast24h > 0 ? "danger" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label={t("admin:health_oldest_job")}
          value={
            queue.oldestPendingAgeSec === null
              ? t("admin:health_all_clear")
              : `${Math.floor(queue.oldestPendingAgeSec / 60)}m`
          }
          detail={
            queue.pending === 0
              ? t("admin:health_zero_backlog")
              : t("admin:health_queue_detail", {
                  runnable: queue.runnable,
                  processing: queue.processing,
                })
          }
          tone={queue.stalled ? "danger" : queue.oldestPendingAgeSec && queue.oldestPendingAgeSec > 300 ? "warn" : "signal"}
          icon={IconClock}
        />
      </section>

      {/* A queue with work and nothing in flight is the one state that means
          "nothing is draining the queue" — the original symptom of the missing
          worker. It must be impossible to miss. */}
      {queue.stalled && (
        <div
          role="alert"
          className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-5"
        >
          <div className="flex items-start gap-3">
            <IconAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-400" />
            <div>
              <h2 className="font-semibold text-danger-300">{t("admin:health_stalled_title")}</h2>
              <p className="mt-1 text-sm text-danger-200/80">
                {t("admin:health_stalled_body", {
                  count: queue.pending,
                  minutes: Math.floor((queue.oldestPendingAgeSec ?? 0) / 60),
                })}
              </p>
              <p className="mt-2 text-sm text-danger-200/70">
                {t("admin:health_stalled_hint_before")} <code className="font-mono">CRON_SECRET</code>{" "}
                {t("admin:health_stalled_hint_mid")} <code className="font-mono">vercel.json</code>{" "}
                {t("admin:health_stalled_hint_after")}{" "}
                <code className="font-mono">GET /api/cron/drain</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Worker Job Queue Distribution */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {t("admin:health_queue_distribution")}
          </span>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {["pending", "processing", "done", "failed"].map((st) => {
              const count = jobCounts[st] ?? 0;
              const isDanger = st === "failed";
              return (
                <div
                  key={st}
                  className="rounded-lg border border-white/[0.06] bg-ink-950/60 p-3.5"
                >
                  <span className="font-mono text-[10px] uppercase font-semibold text-ink-500">
                    {t(`admin:health_queue_${st}`)}
                  </span>
                  <p
                    className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                      isDanger && count > 0 ? "text-danger-400" : "text-white"
                    }`}
                  >
                    {count}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Job latency (aa.md §26) */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {t("admin:health_latency")}
          </span>
          {latency.overall ? (
            <span className="font-mono text-[10px] text-ink-500">
              {t("admin:health_latency_summary", {
                count: latency.overall.samples,
                p50: latency.overall.p50Ms === null ? "—" : `${latency.overall.p50Ms}ms`,
                p95: latency.overall.p95Ms === null ? "—" : `${latency.overall.p95Ms}ms`,
              })}
            </span>
          ) : null}
        </div>
        {latency.byKind.length === 0 ? (
          <p className="px-5 py-4 text-xs text-ink-500">
            {t("admin:health_latency_empty")}
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.05] text-ink-500">
              <tr>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_kind")}</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_samples")}</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">p50</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">p95</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_max")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {latency.byKind.map((l) => (
                <tr key={l.kind}>
                  <td className="px-5 py-2 font-mono text-brand-300">{l.kind}</td>
                  <td className="px-5 py-2 font-mono tabular-nums text-ink-300">{l.samples}</td>
                  <td className="px-5 py-2 font-mono tabular-nums text-ink-300">
                    {l.p50Ms === null ? "—" : `${l.p50Ms}ms`}
                  </td>
                  <td
                    className={`px-5 py-2 font-mono tabular-nums ${
                      (l.p95Ms ?? 0) > 10_000 ? "text-danger-400" : "text-ink-300"
                    }`}
                  >
                    {l.p95Ms === null ? "—" : `${l.p95Ms}ms`}
                  </td>
                  <td className="px-5 py-2 font-mono tabular-nums text-ink-400">
                    {l.maxMs === null ? "—" : `${l.maxMs}ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Why jobs failed, not just how many */}
      {failures.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-danger-500/20 bg-danger-500/[0.03]">
          <div className="flex items-center gap-2 border-b border-danger-500/20 bg-danger-500/[0.08] px-5 py-3">
            <IconAlertCircle className="h-4 w-4 text-danger-300" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-danger-300">
              {t("admin:health_failures_title")}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {failures.map((f) => (
              <li key={f.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-danger-300">{f.kind}</span>
                  <span className="font-mono text-[10px] text-ink-500">
                    {t("admin:health_attempts", { attempts: f.attempts, max: f.maxAttempts })}
                  </span>
                  <span className="font-mono text-[10px] text-ink-500">
                    {f.updatedAt.toISOString().replace("T", " ").slice(0, 19)}Z
                  </span>
                </div>
                {f.error ? (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded border border-white/[0.06] bg-ink-950/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-ink-300">
                    {f.error}
                  </pre>
                ) : (
                  <p className="mt-1 text-[10px] text-ink-500">{t("admin:health_no_error")}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Slow queries */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {t("admin:health_slow_queries")}
          </span>
          <p className="mt-0.5 text-[11px] text-ink-500">
            {t("admin:health_slow_queries_desc_before")}{" "}
            <code className="font-mono text-ink-400">db-slow-query</code>{" "}
            {t("admin:health_slow_queries_desc_after")}
          </p>
        </div>
        {slowQueries.length === 0 ? (
          <p className="px-5 py-4 text-xs text-ink-500">
            {t("admin:health_slow_queries_empty")}
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.05] text-ink-500">
              <tr>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_model")}</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_operation")}</th>
                <th className="px-5 py-2 font-mono text-[10px] uppercase font-semibold">{t("admin:health_col_duration")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {slowQueries.slice(0, 15).map((q, i) => (
                <tr key={`${q.at}-${i}`}>
                  <td className="px-5 py-2 font-mono text-ink-300">{q.model ?? t("admin:health_raw_model")}</td>
                  <td className="px-5 py-2 font-mono text-ink-300">{q.operation}</td>
                  <td
                    className={`px-5 py-2 font-mono tabular-nums ${
                      q.durationMs > 5000 ? "text-danger-400" : "text-warn-300"
                    }`}
                  >
                    {q.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* System Events Table */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        {/* Severity Filter Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <div className="flex items-center gap-1.5">
            <Link
              href="/admin/health"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "all"
                  ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              {t("admin:health_filter_all", { count: events.length })}
            </Link>
            <Link
              href="/admin/health?severity=error"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "error"
                  ? "bg-danger-500/15 text-danger-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              {t("admin:health_filter_error", { count: errorCount })}
            </Link>
            <Link
              href="/admin/health?severity=warn"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "warn"
                  ? "bg-warn-500/15 text-warn-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              {t("admin:health_filter_warn", { count: warnCount })}
            </Link>
            <Link
              href="/admin/health?severity=info"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "info"
                  ? "bg-signal-500/15 text-signal-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              {t("admin:health_filter_info", { count: infoCount })}
            </Link>
          </div>

          <span className="font-mono text-[11px] text-ink-500">
            {t("admin:health_filter_count", { count: filteredEvents.length })}
          </span>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-500">
            {t("admin:health_no_events")}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {filteredEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-4 p-4 text-xs transition-colors hover:bg-white/[0.015]"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      e.severity === "error"
                        ? "bg-danger-400"
                        : e.severity === "warn"
                        ? "bg-warn-400"
                        : "bg-signal-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold text-white">
                        {e.eventType}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 font-mono text-[10px] uppercase font-bold ${
                          e.severity === "error"
                            ? "bg-danger-500/15 text-danger-300"
                            : e.severity === "warn"
                            ? "bg-warn-500/15 text-warn-300"
                            : "bg-signal-500/15 text-signal-300"
                        }`}
                      >
                        {e.severity}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-400">{e.message}</p>
                  </div>
                </div>

                <span className="shrink-0 font-mono text-[11px] text-ink-500">
                  {formatTime(e.createdAt, locale)} &middot;{" "}
                  {new Date(e.createdAt).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}