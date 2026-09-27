import type { Metadata } from "next";
import Link from "next/link";
import { recentSystemEvents } from "@/lib/billing/system-events";
import { queueSnapshot } from "@/lib/engine/queue-metrics";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconAlertCircle,
  IconClock,
  IconArrowLeft,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "System Health: Baton Admin",
};

export default async function AdminHealthPage({
  searchParams,
}: {
  searchParams?: Promise<{ severity?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const severityFilter = params?.severity ?? "all";

  const [events, queue] = await Promise.all([
    recentSystemEvents(100),
    queueSnapshot(),
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
        title="System Health &amp; Queue Status"
        description="Real-time error logs, warning telemetry, and background worker queue metrics for continuous operation."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Recent Errors (100 Evts)"
          value={errorCount}
          detail={errorCount > 0 ? "Requires operator review" : "Zero errors recorded"}
          tone={errorCount > 0 ? "danger" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label="Warnings"
          value={warnCount}
          detail={warnCount > 0 ? "Degraded operation notes" : "Zero warning flags"}
          tone={warnCount > 0 ? "warn" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label="Failed Jobs (24h)"
          value={queue.failedLast24h}
          detail={queue.failedLast24h > 0 ? "Dead-lettered; see job log" : "No job failures"}
          tone={queue.failedLast24h > 0 ? "danger" : "signal"}
          icon={IconAlertCircle}
        />
        <StatCard
          label="Oldest Unfinished Job"
          value={
            queue.oldestPendingAgeSec === null
              ? "All Clear"
              : `${Math.floor(queue.oldestPendingAgeSec / 60)}m`
          }
          detail={
            queue.pending === 0
              ? "Zero backlogged jobs"
              : `${queue.runnable} runnable · ${queue.processing} in flight`
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
              <h2 className="font-semibold text-danger-300">Job queue is stalled</h2>
              <p className="mt-1 text-sm text-danger-200/80">
                {queue.pending} job{queue.pending === 1 ? "" : "s"} pending, nothing in flight, and the
                oldest has waited {Math.floor((queue.oldestPendingAgeSec ?? 0) / 60)} minutes. No
                executor is draining the queue, so PRs are not being classified or nudged.
              </p>
              <p className="mt-2 text-sm text-danger-200/70">
                Check that <code className="font-mono">CRON_SECRET</code> is set and that the
                crons in <code className="font-mono">vercel.json</code> are active, then call{" "}
                <code className="font-mono">GET /api/cron/drain</code> manually.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Worker Job Queue Distribution */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Background Worker Job Distribution
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
                  <span className="font-mono text-[10px] uppercase font-semibold text-ink-500">{st}</span>
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
              All Events ({events.length})
            </Link>
            <Link
              href="/admin/health?severity=error"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "error"
                  ? "bg-danger-500/15 text-danger-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              Errors ({errorCount})
            </Link>
            <Link
              href="/admin/health?severity=warn"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "warn"
                  ? "bg-warn-500/15 text-warn-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              Warnings ({warnCount})
            </Link>
            <Link
              href="/admin/health?severity=info"
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === "info"
                  ? "bg-signal-500/15 text-signal-300 font-semibold shadow-sm"
                  : "text-ink-400 hover:text-white"
              }`}
            >
              Info ({infoCount})
            </Link>
          </div>

          <span className="font-mono text-[11px] text-ink-500">
            {filteredEvents.length} events matching filter
          </span>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-500">
            No system events recorded matching this filter.
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
                  {new Date(e.createdAt).toLocaleTimeString()} &middot;{" "}
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