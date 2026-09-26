import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/env-boot";
import {
  isSupabaseConfigured,
  isSupabasePublishableConfigured,
  isUsdcConfigured,
  adminLogins,
  databaseUrlIssue,
  diagnoseStripe,
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
  const stripe = diagnoseStripe(config);

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
          ok: stripe.configured,
          note: stripe.configured
            ? `Mode: ${stripe.mode} — API key and webhook signing secret accepted`
            : `Blocked: ${stripe.issues.map((i) => i.split(".")[0]).join("; ")}`,
          detail: stripe.configured ? null : stripe.issues,
          fixes: stripe.configured ? null : stripe.fixes,
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
              {section.items.map((item) => {
                const detail = "detail" in item ? (item.detail as string[] | null) : null;
                const fixes = "fixes" in item ? (item.fixes as string[] | null) : null;
                return (
                  <li key={item.label} className="p-5 text-xs transition-colors hover:bg-white/[0.015]">
                    <div className="flex flex-wrap items-center justify-between gap-4">
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
                    </div>

                    {detail && detail.length > 0 ? (
                      <ul className="mt-3 space-y-1.5 border-l-2 border-warn-500/40 pl-3">
                        {detail.map((line) => (
                          <li key={line} className="text-[11px] leading-relaxed text-ink-300">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {fixes && fixes.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-brand-500/20 bg-brand-500/[0.06] p-3">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-brand-300">
                          Required deployment variables
                        </p>
                        <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
                          {fixes.map((step) => (
                            <li key={step} className="text-[11px] leading-relaxed text-ink-200">
                              {step}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
                          Set these in the deployment platform&rsquo;s environment settings (they are
                          read server-side at boot). Never commit them to the repository.
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
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