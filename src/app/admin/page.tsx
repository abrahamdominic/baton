import Link from "next/link";
import { prisma } from "@/lib/db";
import { adminDashboardMetrics } from "@/lib/billing/analytics";
import { listPaymentsAdmin } from "@/lib/billing/payments";
import { recentSystemEvents } from "@/lib/billing/system-events";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconUser,
  IconActivity,
  IconShield,
  IconAlertCircle,
  IconArrowRight,
  IconClock,
  IconLayers,
  IconGitHub,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function statusTone(status: string): string {
  switch (status) {
    case "confirmed":
      return "border-signal-500/30 bg-signal-500/10 text-signal-300";
    case "pending":
    case "pending_verification":
      return "border-brand-500/30 bg-brand-500/10 text-brand-300";
    case "failed":
    case "rejected":
    case "past_due":
      return "border-danger-500/30 bg-danger-500/10 text-danger-300";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-ink-400";
  }
}

export default async function AdminOverviewPage() {
  const [metrics, userCount, latestPayments, latestEvents, repoCount] = await Promise.all([
    adminDashboardMetrics(),
    prisma.user.count(),
    listPaymentsAdmin({ limit: 6 }),
    recentSystemEvents(6),
    prisma.repo.count().catch(() => 0),
  ]);

  const revenueUsd = metrics.payments.totalConfirmedMinor / 100;
  const errorEvents = latestEvents.filter((e) => e.severity === "error").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin Operations"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-signal-400">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
            Live Platform Services
          </span>
        }
        title="Control Panel Overview"
        description="Real-time administrative telemetry across user accounts, billing subscriptions, and background engine workers."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/admin/analytics" className="btn btn-ghost btn-sm">
              <IconActivity className="h-3.5 w-3.5" />
              <span>Deep Analytics</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>
        }
      />

      {/* 4 Executive Stat Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Registered Users"
          value={userCount}
          detail="Total authenticated GitHub users"
          icon={IconUser}
        />
        <StatCard
          label="Active Subscriptions"
          value={metrics.activeSubscriptions}
          detail="Accounts with paid access"
          tone="signal"
          icon={IconShield}
        />
        <StatCard
          label="Pending Checkouts"
          value={metrics.pendingSubscriptions}
          detail="Awaiting payment verification"
          tone={metrics.pendingSubscriptions > 0 ? "brand" : "default"}
          icon={IconClock}
        />
        <StatCard
          label="Past Due / Failed"
          value={metrics.pastDue}
          detail={metrics.pastDue > 0 ? "Requires manual review" : "Zero payment delinquencies"}
          tone={metrics.pastDue > 0 ? "danger" : "default"}
          icon={IconAlertCircle}
        />
      </section>

      {/* Revenue & Payments Breakdown */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Confirmed Volume */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Payment Volume &amp; Channels
            </span>
            <Link
              href="/admin/payments"
              className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
            >
              <span>Manage payments</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div>
              <span className="text-xs text-ink-400">Total Confirmed Revenue</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-extrabold tabular-nums tracking-tight text-white">
                  ${revenueUsd.toFixed(2)}
                </span>
                <span className="font-mono text-xs font-semibold text-ink-400">USD</span>
              </div>
            </div>

            <div className="space-y-3.5 border-t border-white/[0.06] pt-4">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Revenue by Provider
              </span>

              {Object.entries(metrics.payments.byProvider).map(([provider, details]) => {
                const provAmount = details.amountMinor / 100;
                const pct =
                  metrics.payments.totalConfirmedMinor > 0
                    ? Math.round((details.amountMinor / metrics.payments.totalConfirmedMinor) * 100)
                    : 0;

                return (
                  <div key={provider} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono uppercase text-ink-300">
                        {provider === "usdc" ? "USDC (Base)" : "Stripe (Card)"}
                      </span>
                      <span className="font-mono text-ink-200">
                        ${provAmount.toFixed(2)}{" "}
                        <span className="text-ink-500">
                          ({details.count} pay{details.count === 1 ? "" : "s"} &middot; {pct}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${
                          provider === "usdc" ? "bg-brand-400" : "bg-signal-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Latest Payments */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Latest Ingested Payments
            </span>
            <Link
              href="/admin/payments"
              className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
            >
              <span>View all</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {latestPayments.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-500">
              No payment transactions recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {latestPayments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-ink-200">
                        {p.id.slice(0, 8)}&hellip;
                      </span>
                      <span className="font-mono text-[10px] uppercase text-ink-500">
                        {p.payment_provider}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-ink-500">
                      {new Date(p.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                        p.status,
                      )}`}
                    >
                      {p.status.replace("_", " ")}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-white">
                      ${(p.amount / 100).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* System Events & Health Pulse */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              System Events Pulse
            </span>
            {errorEvents > 0 ? (
              <span className="rounded bg-danger-500/15 px-1.5 py-0.2 font-mono text-[10px] font-bold text-danger-300">
                {errorEvents} Error{errorEvents === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <Link
            href="/admin/health"
            className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
          >
            <span>System Health</span>
            <IconArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {latestEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-500">
            No system events recorded. Platform running cleanly.
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {latestEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 px-5 py-3 text-xs transition-colors hover:bg-white/[0.02]"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    e.severity === "error"
                      ? "bg-danger-400"
                      : e.severity === "warn"
                      ? "bg-warn-400"
                      : "bg-signal-400"
                  }`}
                />
                <span className="font-mono text-[11px] font-medium text-ink-300 min-w-[140px] truncate">
                  {e.eventType}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-400">{e.message}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-500">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Administrative Jump Links */}
      <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            href: "/admin/users",
            title: "User Management",
            desc: "Promote/demote admins, manage suspensions",
            icon: IconUser,
          },
          {
            href: "/admin/subscriptions",
            title: "Subscriptions",
            desc: "Lifecycle overrides, plan changes",
            icon: IconLayers,
          },
          {
            href: "/admin/plans",
            title: "Plan Catalog",
            desc: "Pricing tiers, feature matrix, limits",
            icon: IconLayers,
          },
          {
            href: "/admin/github",
            title: "GitHub Integrations",
            desc: `${repoCount} repos, app installs & webhooks`,
            icon: IconGitHub,
          },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-white/[0.08] bg-ink-900/60 p-4 transition-all hover:border-white/[0.14] hover:bg-ink-850"
          >
            <div className="flex items-center justify-between">
              <c.icon className="h-4 w-4 text-ink-400 group-hover:text-brand-300 transition-colors" />
              <IconArrowRight className="h-3.5 w-3.5 text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-300" />
            </div>
            <p className="mt-3 text-xs font-bold text-white group-hover:text-brand-200">
              {c.title}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-400">{c.desc}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}