import Link from "next/link";
import { prisma } from "@/lib/db";
import { adminDashboardMetrics, formatCurrencyTotal } from "@/lib/billing/analytics";
import { listPaymentsAdmin } from "@/lib/billing/payments";
import { recentSystemEvents } from "@/lib/billing/system-events";
import { StatCard, PageHeader } from "@/components/ui";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { paymentStatusLabel } from "@/lib/i18n/billing-label";
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
  const { t, locale, formatDateTime, formatTime } = await getTranslatorForRequest();
  const [metrics, userCount, latestPayments, latestEvents, repoCount] = await Promise.all([
    adminDashboardMetrics(),
    prisma.user.count(),
    listPaymentsAdmin({ limit: 6 }),
    recentSystemEvents(6),
    prisma.repo.count().catch(() => 0),
  ]);

  // Never summed across currencies: each currency is reported on its own.
  const revenueByCurrency = Object.entries(metrics.payments.byCurrency);
  const errorEvents = latestEvents.filter((e) => e.severity === "error").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-signal-400">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
            {t("admin:live_services")}
          </span>
        }
        title={t("admin:overview_title")}
        description={t("admin:overview_description")}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/admin/analytics" className="btn btn-ghost btn-sm">
              <IconActivity className="h-3.5 w-3.5" />
              <span>{t("admin:overview_deep_analytics")}</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>
        }
      />

      {/* 4 Executive Stat Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={t("admin:stat_users")}
          value={userCount}
          detail={t("admin:stat_users_detail")}
          icon={IconUser}
        />
        <StatCard
          label={t("admin:stat_active_subscriptions")}
          value={metrics.activeSubscriptions}
          detail={t("admin:stat_active_subscriptions_detail")}
          tone="signal"
          icon={IconShield}
        />
        <StatCard
          label={t("admin:stat_pending_checkouts")}
          value={metrics.pendingSubscriptions}
          detail={t("admin:stat_pending_checkouts_detail")}
          tone={metrics.pendingSubscriptions > 0 ? "brand" : "default"}
          icon={IconClock}
        />
        <StatCard
          label={t("admin:stat_past_due")}
          value={metrics.pastDue}
          detail={metrics.pastDue > 0 ? t("admin:stat_past_due_warn") : t("admin:stat_past_due_clear")}
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
              {t("admin:payment_volume")}
            </span>
            <Link
              href="/admin/payments"
              className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
            >
              <span>{t("admin:manage_payments")}</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div>
              <span className="text-xs text-ink-400">{t("admin:total_confirmed_revenue")}</span>
              {revenueByCurrency.length === 0 ? (
                <div className="mt-1 font-mono text-3xl font-extrabold tabular-nums tracking-tight text-ink-500">
                  &mdash;
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {revenueByCurrency.map(([currency, total]) => (
                    <div key={currency} className="flex items-baseline gap-2">
                      <span className="font-mono text-3xl font-extrabold tabular-nums tracking-tight text-white">
                        {formatCurrencyTotal(currency, total.amountMinor, locale).split(" ")[1]}
                      </span>
                      <span className="font-mono text-xs font-semibold text-ink-400">
                        {currency}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {revenueByCurrency.length > 1 && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                  {t("admin:revenue_per_currency_note")}
                </p>
              )}
            </div>

            <div className="space-y-3.5 border-t border-white/[0.06] pt-4">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {t("admin:revenue_by_provider")}
              </span>

              {/* `byProvider` is only populated for confirmed payments, unlike
                  `byStatus` which is pre-seeded from PAYMENT_STATUSES. With no
                  confirmed payments this section previously rendered a label
                  above nothing, so it gets the same em-dash treatment as the
                  revenue total above. */}
              {Object.keys(metrics.payments.byProvider).length === 0 ? (
                <div className="font-mono text-sm text-ink-500">&mdash;</div>
              ) : (
              Object.entries(metrics.payments.byProvider).map(([provider, details]) => {
                // Each provider settles in exactly one currency, so the share
                // is computed within that provider's own currency rather than
                // against a cross-currency total.
                const currency =
                  provider === "usdc" ? "USDC" : "USD";
                const providerTotal = metrics.payments.byCurrency[currency]?.amountMinor ?? 0;
                const pct =
                  providerTotal > 0
                    ? Math.round((details.amountMinor / providerTotal) * 100)
                    : 0;

                return (
                  <div key={provider} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono uppercase text-ink-300">
                        {t(provider === "usdc" ? "admin:provider_usdc" : "admin:provider_stripe")}
                      </span>
                      <span className="font-mono text-ink-200">
                        {formatCurrencyTotal(currency, details.amountMinor, locale)}{" "}
                        <span className="text-ink-500">
                          {t("admin:provider_payments", { count: details.count, pct })}
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
              })
              )}
            </div>
          </div>
        </div>

        {/* Latest Payments */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {t("admin:latest_payments")}
            </span>
            <Link
              href="/admin/payments"
              className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
            >
              <span>{t("admin:view_all")}</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {latestPayments.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-500">
              {t("admin:no_payments")}
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
                      {formatDateTime(p.created_at, {
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
                      {paymentStatusLabel(p.status, t)}
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
              {t("admin:system_events_pulse")}
            </span>
            {errorEvents > 0 ? (
              <span className="rounded bg-danger-500/15 px-1.5 py-0.2 font-mono text-[10px] font-bold text-danger-300">
                {t("admin:system_events_errors", { count: errorEvents })}
              </span>
            ) : null}
          </div>
          <Link
            href="/admin/health"
            className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
          >
            <span>{t("admin:system_health")}</span>
            <IconArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {latestEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-500">
            {t("admin:no_system_events")}
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
                  {formatTime(e.createdAt)}
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
            title: t("admin:nav_users_title"),
            desc: t("admin:nav_users_desc"),
            icon: IconUser,
          },
          {
            href: "/admin/subscriptions",
            title: t("admin:nav_subscriptions_title"),
            desc: t("admin:nav_subscriptions_desc"),
            icon: IconLayers,
          },
          {
            href: "/admin/plans",
            title: t("admin:nav_plans_title"),
            desc: t("admin:nav_plans_desc"),
            icon: IconLayers,
          },
          {
            href: "/admin/github",
            title: t("admin:nav_github_title"),
            desc: t("admin:nav_github_desc", { count: repoCount }),
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