import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/env-boot";
import {
  isSupabaseConfigured,
  isSupabasePublishableConfigured,
  isStripeConfigured,
  isUsdcConfigured,
  adminLogins,
  databaseUrlIssue,
} from "@/lib/config";
import { listPlans } from "@/lib/billing/plans";
import { Badge, PageHeader } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Environment & Settings: Baton Admin",
};

export default async function AdminSettingsPage() {
  const planCount = await listPlans({ includeInactive: true })
    .then((p) => p.length)
    .catch(() => 0);

  const dbIssue = databaseUrlIssue(config);

  const checks = [
    {
      category: "Database & Backend",
      items: [
        {
          label: "PostgreSQL Database Connection",
          ok: !dbIssue,
          note: dbIssue ?? "Prisma connection verified and responding",
        },
        {
          label: "Supabase Backend (Service Role)",
          ok: isSupabaseConfigured(config),
          note: isSupabaseConfigured(config)
            ? "Service role connected"
            : "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
        },
        {
          label: "Supabase Publishable Client",
          ok: isSupabasePublishableConfigured(config),
          note: isSupabasePublishableConfigured(config)
            ? "Publishable key present"
            : "SUPABASE_PUBLISHABLE_KEY missing",
        },
      ],
    },
    {
      category: "Payment Gateways",
      items: [
        {
          label: "Stripe Payment Gateway",
          ok: isStripeConfigured(config),
          note: isStripeConfigured(config)
            ? `Mode: ${config.STRIPE_MODE}`
            : "STRIPE_SECRET_KEY / WEBHOOK_SECRET missing",
        },
        {
          label: "USDC Base Smart Contract",
          ok: isUsdcConfigured(config),
          note: isUsdcConfigured(config)
            ? `${config.USDC_TOKEN} on ${config.USDC_NETWORK} (min ${config.USDC_MIN_CONFIRMATIONS} conf)`
            : "USDC_PAYMENT_WALLET_ADDRESS unset",
        },
      ],
    },
    {
      category: "Access & Security",
      items: [
        {
          label: "Bootstrap Administrator Accounts",
          ok: adminLogins(config).length > 0,
          note:
            adminLogins(config).length > 0
              ? adminLogins(config).join(", ")
              : "BATON_ADMIN_LOGINS unset",
        },
        {
          label: "Configured Plan Tiers",
          ok: planCount > 0,
          note: `${planCount} active/archived plan tiers in catalog`,
        },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin &middot; Environment"
        title="Environment &amp; Settings"
        description="Read-only deployment readiness checklist. Features degrade gracefully if optional external providers are unconfigured."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* Categorized Readiness Cards */}
      <div className="space-y-6">
        {checks.map((section) => (
          <section
            key={section.category}
            className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm"
          >
            <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                {section.category}
              </span>
            </div>

            <ul className="divide-y divide-white/[0.05]">
              {section.items.map((item) => (
                <li
                  key={item.label}
                  className="flex flex-wrap items-center justify-between gap-4 p-5 text-xs transition-colors hover:bg-white/[0.015]"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        item.ok ? "bg-signal-400" : "bg-warn-400"
                      }`}
                    />
                    <div>
                      <p className="font-semibold text-white">{item.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-400">{item.note}</p>
                    </div>
                  </div>

                  <Badge tone={item.ok ? "success" : "warn"}>
                    {item.ok ? "ready" : "unconfigured"}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Runtime Parameter Table */}
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Runtime Parameters
            </span>
          </div>

          <ul className="divide-y divide-white/[0.05]">
            <li className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
              <span className="font-medium text-ink-300">Canonical Site URL</span>
              <code className="font-mono text-[11px] text-ink-200">{config.SITE_URL}</code>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
              <span className="font-medium text-ink-300">USDC Token Address</span>
              <code className="font-mono text-[11px] text-ink-200">{config.USDC_TOKEN_ADDRESS}</code>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
              <span className="font-medium text-ink-300">USDC Base RPC Endpoint</span>
              <code className="max-w-[80%] truncate font-mono text-[11px] text-ink-200">
                {config.USDC_RPC_URL}
              </code>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
              <span className="font-medium text-ink-300">GitHub App Slug</span>
              <code className="font-mono text-[11px] text-ink-200">{config.GITHUB_APP_SLUG}</code>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}