"use client";

import React, { useState } from "react";
import Link from "next/link";
import { IconCheck, IconArrowRight, IconGitHub } from "@/components/icons";

export interface Tier {
  slug: string;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  monthlyPeriod: string;
  annualPeriod: string;
  monthlyNote?: string;
  annualNote?: string;
  blurb: string;
  features: string[];
  ctaMonthly: string;
  ctaAnnual: string;
  checkoutUrlMonthly: string;
  checkoutUrlAnnual: string;
  featured: boolean;
  highlightBadge?: string;
}

const TIERS: Tier[] = [
  {
    slug: "individual",
    name: "Individual",
    monthlyPrice: "$0",
    annualPrice: "$0",
    monthlyPeriod: "free forever",
    annualPeriod: "free forever",
    monthlyNote: "Free forever for individuals & public repos",
    annualNote: "Free forever for individuals & public repos",
    blurb: "For solo developers and open-source contributors.",
    features: [
      "Up to 3 repositories",
      "Pinned live status card in every PR",
      "Automatic baton:* GitHub state labels",
      "Your Move personal review queue",
      "Standard webhook ingestion",
      "Community GitHub discussions support",
    ],
    ctaMonthly: "Start Free",
    ctaAnnual: "Start Free",
    checkoutUrlMonthly: "/auth/login?next=/dashboard",
    checkoutUrlAnnual: "/auth/login?next=/dashboard",
    featured: false,
  },
  {
    slug: "team",
    name: "Team",
    monthlyPrice: "$10",
    annualPrice: "$8",
    monthlyPeriod: "per user / month",
    annualPeriod: "per user / month",
    monthlyNote: "Billed monthly at $10/user/month",
    annualNote: "Billed annually at $96/user/year (save 20%)",
    blurb: "For engineering teams that want to ship fast and stop PR stalls.",
    features: [
      "Unlimited repositories",
      "Deterministic state classifier",
      "Per-repo customizable nudge thresholds",
      "Automated @-mention reviewer nudges",
      "Team-wide repository boards",
      "Your Move queue with priority sorting",
      "Slack notifications roadmap preview",
      "Priority email and GitHub support",
    ],
    ctaMonthly: "Start 14-Day Free Trial (Monthly)",
    ctaAnnual: "Start 14-Day Free Trial (Annual)",
    checkoutUrlMonthly: "/auth/login?next=%2Fdashboard%3Fplan%3Dteam%26billing%3Dmonthly",
    checkoutUrlAnnual: "/auth/login?next=%2Fdashboard%3Fplan%3Dteam%26billing%3Dannual",
    featured: true,
    highlightBadge: "Most Popular",
  },
  {
    slug: "organization",
    name: "Organization",
    monthlyPrice: "$50",
    annualPrice: "$40",
    monthlyPeriod: "per month",
    annualPeriod: "per month, billed annually",
    monthlyNote: "Billed monthly at $50/month",
    annualNote: "Billed annually at $480/year (save 20%)",
    blurb: "For scaling engineering organizations with compliance, unlimited repos, and priority SLAs.",
    features: [
      "Everything in Team",
      "Unlimited repositories & team members",
      "Organization-wide review stall policies",
      "SAML 2.0 and SCIM SSO integration",
      "Audit log export via streaming webhook or API",
      "Dedicated Customer Success Engineer",
      "Custom SLA with 99.9% uptime guarantee",
    ],
    ctaMonthly: "Choose Organization (Monthly)",
    ctaAnnual: "Choose Organization (Annual)",
    checkoutUrlMonthly: "/dashboard/billing/checkout?plan=plan_org_default&billing=monthly",
    checkoutUrlAnnual: "/dashboard/billing/checkout?plan=plan_org_default&billing=annual",
    featured: false,
  },
];

const MATRIX = [
  {
    category: "Core State Engine",
    rows: [
      { feature: "Deterministic PR state machine", free: "Included", team: "Included", org: "Included" },
      { feature: "Live pinned status comment", free: "Included", team: "Included", org: "Included" },
      { feature: "Real-time baton:* labels", free: "Included", team: "Included", org: "Included" },
      { feature: "Whose-turn resolution", free: "Included", team: "Included", org: "Included" },
      { feature: "Metadata-only access guarantee (no code read)", free: "Included", team: "Included", org: "Included" },
    ],
  },
  {
    category: "Nudges & Thresholds",
    rows: [
      { feature: "Automated polite reviewer nudges", free: "Not included", team: "Configurable per repo", org: "Configurable + Org policies" },
      { feature: "Per-state grace periods (hours)", free: "Default (24h/48h)", team: "Full customization", org: "Full customization" },
      { feature: "Bounded nudges (max 1 per state)", free: "Included", team: "Included", org: "Included" },
      { feature: "Safety net scheduled sweeps", free: "Standard", team: "High-frequency", org: "Real-time dedicated" },
    ],
  },
  {
    category: "Management & Security",
    rows: [
      { feature: "Repositories tracked", free: "Up to 3 repos", team: "Unlimited", org: "Unlimited" },
      { feature: "Your Move personal dashboard", free: "Included", team: "Included", org: "Included" },
      { feature: "Repo-level boards", free: "Not included", team: "Included", org: "Included" },
      { feature: "SAML SSO and SCIM", free: "Not included", team: "Not included", org: "Included" },
      { feature: "Audit log export API", free: "Not included", team: "Not included", org: "Included" },
      { feature: "Uptime SLA", free: "Best effort", team: "99.5%", org: "99.9% financially backed" },
    ],
  },
];

export function PricingView({
  overrides = {},
}: {
  /** Server-fetched plan overrides keyed by tier slug (e.g. "team"). */
  overrides?: Record<string, Partial<Tier>>;
}) {
  const [annual, setAnnual] = useState(false);

  const tiers: Tier[] = TIERS.map((t) => (overrides[t.slug] ? { ...t, ...overrides[t.slug] } : t));

  return (
    <div className="space-y-16">
      {/* Billing toggle */}
      <div className="flex flex-col items-center justify-center gap-3">
        <div
          role="tablist"
          aria-label="Billing frequency selection"
          className="inline-flex items-center rounded-full border border-white/[0.1] bg-ink-900/90 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!annual}
            onClick={() => setAnnual(false)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              !annual
                ? "bg-brand-500 text-white shadow-sm"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            Monthly billing
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={annual}
            onClick={() => setAnnual(true)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              annual
                ? "bg-brand-500 text-white shadow-sm"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <span>Annual billing</span>
            <span className="rounded-full bg-signal-500/20 px-2 py-0.5 text-[10px] font-bold text-signal-400">
              Save 20%
            </span>
          </button>
        </div>
        <p className="text-xs text-ink-400 font-mono">
          Free for public open-source repos. No credit card required to start.
        </p>
      </div>

      {/* Tier Cards */}
      <div className="grid gap-8 lg:grid-cols-3">
        {tiers.map((t) => {
          const price = annual ? t.annualPrice : t.monthlyPrice;
          const period = annual ? t.annualPeriod : t.monthlyPeriod;
          const note = annual ? t.annualNote : t.monthlyNote;
          const cta = annual ? t.ctaAnnual : t.ctaMonthly;
          const checkoutUrl = annual ? t.checkoutUrlAnnual : t.checkoutUrlMonthly;
          const isExternal = checkoutUrl.startsWith("mailto:") || checkoutUrl.startsWith("http");

          return (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
                t.featured
                  ? "border-brand-500/50 bg-ink-900"
                  : "border-white/[0.08] bg-ink-900/70 hover:border-white/[0.14]"
              }`}
            >
              {t.highlightBadge ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-brand-400/50 bg-brand-500 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">
                  {t.highlightBadge}
                </div>
              ) : null}

              <div>
                <h3 className="text-lg font-bold text-white">{t.name}</h3>
                <p className="mt-2 text-xs text-ink-400 min-h-[32px] leading-relaxed">
                  {t.blurb}
                </p>

                <div className="mt-6 border-b border-white/[0.08] pb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold tracking-tight text-white font-mono">
                      {price}
                    </span>
                    <span className="text-xs text-ink-400">{period}</span>
                  </div>
                  {note ? (
                    <p className="mt-2 text-[11px] font-mono text-brand-300">
                      {note}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 flex-1">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  Included features:
                </span>
                <ul className="mt-3.5 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-xs text-ink-200">
                      <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                {isExternal ? (
                  <a
                    href={checkoutUrl}
                    className={`w-full ${
                      t.featured ? "btn-primary" : "btn-ghost"
                    } btn-lg flex items-center justify-center gap-2 text-center`}
                  >
                    <span>{cta}</span>
                    <IconArrowRight className="h-4 w-4 shrink-0" />
                  </a>
                ) : (
                  <Link
                    href={checkoutUrl}
                    className={`w-full ${
                      t.featured ? "btn-primary" : "btn-ghost"
                    } btn-lg flex items-center justify-center gap-2 text-center`}
                  >
                    <span>{cta}</span>
                    <IconArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Open Source Pledge Banner */}
      <div className="rounded-xl border border-signal-500/30 bg-signal-500/[0.04] p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-signal-500/30 bg-signal-500/10 text-signal-400">
              <IconGitHub className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Open Source Commitment: 100% Free for Public Repositories
              </h3>
              <p className="mt-1 text-xs text-ink-300">
                Any public GitHub repository automatically receives all Team plan features at zero cost.
                Baton is itself licensed under AGPL-3.0 and can be self-hosted.
              </p>
            </div>
          </div>

          <a
            href="https://github.com/baton-pr/baton"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            Inspect AGPL-3.0 Source
          </a>
        </div>
      </div>

      {/* Feature Comparison Matrix */}
      <div className="pt-8">
        <div className="text-center max-w-xl mx-auto mb-10">
          <h2 className="text-2xl font-bold text-white">Compare plans in detail</h2>
          <p className="mt-2 text-xs text-ink-400">
            Every feature, capability, and limit explained line by line.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/60">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                <th className="py-4 pl-6 pr-4 font-semibold">Features</th>
                <th className="py-4 px-4 font-semibold text-white">Individual ($0)</th>
                <th className="py-4 px-4 font-semibold text-brand-300">
                  Team ({annual ? "$8/mo billed annually" : "$10/mo"})
                </th>
                <th className="py-4 pr-6 pl-4 font-semibold text-white">
                  Organization ({annual ? "$40/mo billed annually" : "$50/mo"})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {MATRIX.map((sec) => (
                <React.Fragment key={sec.category}>
                  <tr className="bg-ink-950/90">
                    <td
                      colSpan={4}
                      className="py-2.5 pl-6 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-400"
                    >
                      {sec.category}
                    </td>
                  </tr>
                  {sec.rows.map((r) => (
                    <tr key={r.feature} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 pl-6 pr-4 font-medium text-ink-200">{r.feature}</td>
                      <td className="py-3.5 px-4 text-ink-400">{r.free}</td>
                      <td className="py-3.5 px-4 font-medium text-brand-200 bg-brand-500/[0.02]">
                        {r.team}
                      </td>
                      <td className="py-3.5 pr-6 pl-4 text-ink-300">{r.org}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
