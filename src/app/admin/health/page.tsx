import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { recentSystemEvents } from "@/lib/billing/system-events";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconGauge,
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

  const [events, jobCounts, queueAge] = await Promise.all([
    recentSystemEvents(100),
    prisma.job
      .groupBy({ by: ["status"], _count: { _all: true } })
      .then((rows) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]))),
    prisma.job.aggregate({ _min: { createdAt: true } }).then((r) => r._min.createdAt),
  ]);

  const errorCount = events.filter((e) => e.severity === "error").length;
  const warnCount = events.filter((e) => e.severity === "warn").length;
  const infoCount = events.filter((e) => e.severity === "info").length;
  const staleJobs = (jobCounts.stale ?? 0) + (jobCounts.failed ?? 0);

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
        eyebrow="Admin &middot; Operations"
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
          label="Failed / Stale Jobs"
          value={staleJobs}
          detail={staleJobs > 0 ? "Jobs requiring retry" : "All worker jobs healthy"}
          tone={staleJobs > 0 ? "danger" : "signal"}
          icon={IconGauge}
        />
        <StatCard
          label="Earliest Pending Job"
          value={queueAge ? new Date(queueAge).toISOString().slice(0, 10) : "All Clear"}
          detail={queueAge ? "Queue latency indicator" : "Zero backlogged jobs"}
          icon={IconClock}
        />
      </section>

      {/* Worker Job Queue Distribution */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Background Worker Job Distribution
          </span>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {["pending", "running", "completed", "failed", "stale"].map((st) => {
              const count = jobCounts[st] ?? 0;
              const isDanger = st === "failed" || st === "stale";
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