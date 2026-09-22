import Link from "next/link";
import { adminDashboardMetrics, subscriptionStatusCounts } from "@/lib/billing/analytics";
import { SUBSCRIPTION_STATUSES } from "@/lib/billing/types";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconActivity,
  IconShield,
  IconClock,
  IconArrowLeft,
  IconLayers,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const [counts, metrics] = await Promise.all([
    subscriptionStatusCounts(),
    adminDashboardMetrics(),
  ]);

  const totalSubscriptions = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalPayments = Object.values(metrics.payments.byStatus).reduce((a, b) => a + b, 0);
  const revenueUsd = metrics.payments.totalConfirmedMinor / 100;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Analytics &amp; Conversion Funnels"
        description="Lifecycle distribution for customer subscriptions, conversion checkpoints, and payment confirmation status."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Subscriptions"
          value={totalSubscriptions}
          detail={`${metrics.activeSubscriptions} active entitlements`}
          tone="signal"
          icon={IconShield}
        />
        <StatCard
          label="Pending Checkout"
          value={metrics.pendingSubscriptions}
          detail="Incomplete checkout flow"
          tone={metrics.pendingSubscriptions > 0 ? "brand" : "default"}
          icon={IconClock}
        />
        <StatCard
          label="Confirmed Revenue"
          value={`$${revenueUsd.toFixed(2)}`}
          detail="Across all payment providers"
          tone="brand"
          icon={IconActivity}
        />
        <StatCard
          label="Total Payment Events"
          value={totalPayments}
          detail="Processed transactions"
          icon={IconLayers}
        />
      </section>

      {/* Funnels & Status Breakdowns */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Subscriptions by Status */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Subscriptions by Status
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              {totalSubscriptions} total records
            </span>
          </div>

          <ul className="divide-y divide-white/[0.05]">
            {SUBSCRIPTION_STATUSES.map((s) => {
              const count = counts[s] ?? 0;
              const pct = totalSubscriptions > 0 ? Math.round((count / totalSubscriptions) * 100) : 0;
              const isGood = s === "active" || s === "active_until_period_end";
              const isWarn = s === "pending";
              const isBad = s === "past_due" || s === "payment_failed";

              return (
                <li
                  key={s}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isGood ? "bg-signal-400" : isWarn ? "bg-brand-400" : isBad ? "bg-danger-400" : "bg-ink-600"
                        }`}
                      />
                      <span className="font-mono text-xs uppercase tracking-wider text-ink-200">
                        {s.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-28 sm:w-36 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${
                          isGood ? "bg-signal-400" : isWarn ? "bg-brand-400" : isBad ? "bg-danger-400" : "bg-ink-600"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="min-w-[48px] text-right font-mono font-bold tabular-nums text-white">
                      {count}{" "}
                      <span className="text-[10px] font-normal text-ink-500">({pct}%)</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Payments by Status */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Payments by Status
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              {totalPayments} transaction{totalPayments === 1 ? "" : "s"}
            </span>
          </div>

          <ul className="divide-y divide-white/[0.05]">
            {Object.entries(metrics.payments.byStatus).map(([status, count]) => {
              const pct = totalPayments > 0 ? Math.round((count / totalPayments) * 100) : 0;
              const isConfirmed = status === "confirmed";
              const isPending = status === "pending" || status === "pending_verification";
              const isFailed = status === "failed" || status === "rejected";

              return (
                <li
                  key={status}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isConfirmed ? "bg-signal-400" : isPending ? "bg-brand-400" : isFailed ? "bg-danger-400" : "bg-ink-600"
                        }`}
                      />
                      <span className="font-mono text-xs uppercase tracking-wider text-ink-200">
                        {status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-28 sm:w-36 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${
                          isConfirmed ? "bg-signal-400" : isPending ? "bg-brand-400" : isFailed ? "bg-danger-400" : "bg-ink-600"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="min-w-[48px] text-right font-mono font-bold tabular-nums text-white">
                      {count}{" "}
                      <span className="text-[10px] font-normal text-ink-500">({pct}%)</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}