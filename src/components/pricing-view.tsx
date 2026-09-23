"use client";

import React, { useState } from "react";
import Link from "next/link";
import { IconCheck, IconX, IconArrowRight, IconGitHub } from "@/components/icons";
import type { PlanRecord } from "@/lib/billing/types";

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
    annualPrice: "$96",
    monthlyPeriod: "per user / month",
    annualPeriod: "per user / year",
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
      "Priority email and GitHub support",
    ],
    ctaMonthly: "Start 14-Day Free Trial (Monthly)",
    ctaAnnual: "Start 14-Day Free Trial (Annual)",
    checkoutUrlMonthly: "/dashboard/billing/checkout?plan=plan_team_default&billing=monthly",
    checkoutUrlAnnual: "/dashboard/billing/checkout?plan=plan_team_default&billing=annual",
    featured: true,
    highlightBadge: "Most Popular",
  },
  {
    slug: "organization",
    name: "Organization",
    monthlyPrice: "$50",
    annualPrice: "$480",
    monthlyPeriod: "per month",
    annualPeriod: "per year, billed annually",
    monthlyNote: "Billed monthly at $50/month",
    annualNote: "Billed annually at $480/year (save 20%)",
    blurb: "For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.",
    features: [
      "Everything in Team",
      "Unlimited repositories & team members",
      "Organization-wide review stall policies",
      "Team roles, invitations & permissions with audit trail",
      "Audit log export (CSV/JSON)",
    ],
    ctaMonthly: "Choose Organization (Monthly)",
    ctaAnnual: "Choose Organization (Annual)",
    checkoutUrlMonthly: "/dashboard/billing/checkout?plan=plan_org_default&billing=monthly",
    checkoutUrlAnnual: "/dashboard/billing/checkout?plan=plan_org_default&billing=annual",
    featured: false,
  },
];

/**
 * Capabilities the compare matrix can talk about. One source of truth: the
 * plan rows in the `plans` table (limits.features gates + maxRepos/maxMembers),
 * exactly what the entitlement resolver enforces at runtime. The matrix can
 * therefore never promise capabilities the backend does not grant.
 */
interface Caps {
  maxRepos: number | null;
  maxMembers: number | null;
  features: string[];
}

const FREE_CAPS: Caps = { maxRepos: 3, maxMembers: 0, features: [] };

function capsOf(plan: PlanRecord | null, isFree: boolean): Caps {
  if (isFree || !plan) return FREE_CAPS;
  const limits = (plan.limits ?? {}) as {
    maxRepos?: number | null;
    maxMembers?: number | null;
    features?: unknown;
  };
  const features = Array.isArray(limits.features)
    ? (limits.features as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  return {
    maxRepos: typeof limits.maxRepos === "number" && limits.maxRepos > 0 ? limits.maxRepos : null,
    maxMembers:
      typeof limits.maxMembers === "number" && limits.maxMembers > 0 ? limits.maxMembers : 0,
    features,
  };
}

interface MatrixRow {
  feature: string;
  resolve: (c: Caps) => boolean | string;
}

const hasGate =
  (key: string): MatrixRow["resolve"] =>
  (c) =>
    c.features.includes(key);

const MATRIX_SECTIONS: { category: string; intro?: string; rows: MatrixRow[] }[] = [
  {
    category: "Core State Engine",
    intro: "Every repository Baton tracks gets the full deterministic state machine, on every plan.",
    rows: [
      { feature: "Deterministic PR state machine", resolve: () => true },
      { feature: "Live pinned status card in every PR", resolve: () => true },
      { feature: "Automatic baton:* state labels", resolve: () => true },
      { feature: "Whose-turn resolution (author vs reviewer)", resolve: () => true },
      { feature: "Metadata-only operation, never reads your code", resolve: () => true },
    ],
  },
  {
    category: "Scale & Capacity",
    rows: [
      {
        feature: "Active repositories tracked",
        resolve: (c) => (c.maxRepos === null ? "Unlimited" : `Up to ${c.maxRepos}`),
      },
      {
        feature: "Members included in your plan",
        resolve: (c) =>
          c.maxMembers === 0
            ? "Not included"
            : c.maxMembers === null
              ? "Unlimited"
              : `${c.maxMembers.toLocaleString("en-US")} seats`,
      },
      { feature: "Your Move personal review queue", resolve: () => true },
      { feature: "Repository board per repo", resolve: () => true },
    ],
  },
  {
    category: "Automation & Nudges",
    rows: [
      { feature: "Automated polite @-mention reviewer nudges", resolve: () => true },
      { feature: "Bounded nudges (max 1 per state)", resolve: () => true },
      {
        feature: "Per-repo customizable thresholds & grace periods",
        resolve: hasGate("custom_thresholds"),
      },
    ],
  },
  {
    category: "Workspaces, Roles & Compliance",
    rows: [
      { feature: "Team workspaces (shared board, invites, member roles)", resolve: hasGate("team_workspace") },
      { feature: "Organization workspaces (multiple teams & roles)", resolve: hasGate("organization_workspace") },
      { feature: "Organization-wide review stall policies", resolve: hasGate("organization_policies") },
      { feature: "Audit log export (CSV/JSON)", resolve: hasGate("audit_export") },
    ],
  },
];

export function PricingView({
  overrides = {},
  plans = [],
}: {
  /** Server-fetched plan overrides keyed by tier slug (e.g. "team"). */
  overrides?: Record<string, Partial<Tier>>;
  /** Server-fetched plan rows from the `plans` table (compare matrix source of truth). */
  plans?: PlanRecord[];
}) {
  const [annual, setAnnual] = useState(false);

  const tiers: Tier[] = TIERS.map((t) => (overrides[t.slug] ? { ...t, ...overrides[t.slug] } : t));

  const columns: { slug: string; label: string; plan: PlanRecord | null; featured: boolean }[] = [
    {
      slug: "free",
      label: overrides.individual?.name ?? TIERS[0].name,
      plan: null,
      featured: TIERS[0].featured,
    },
    ...plans.map((p, i) => ({
      slug: p.slug,
      label: p.name,
      plan: p,
      featured: p.slug === "team" || (plans.length === 1 && i === 0),
    })),
  ];

  const headPrice = (plan: PlanRecord | null) => {
    if (!plan || plan.price_custom) return "Custom";
    const cents = annual ? plan.annual_price_cents : plan.monthly_price_cents;
    return `$${(cents / 100).toFixed(0)}`;
  };
  const headPeriod = (plan: PlanRecord | null) =>
    !plan ? "free forever" : annual ? "/year" : "/month";

  const cellView = (value: boolean | string) => {
    if (value === true) return <IconCheck className="h-4 w-4 text-signal-400" />;
    if (value === false) return <IconX className="h-4 w-4 text-ink-600" />;
    return <span className="text-ink-300">{value}</span>;
  };

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
            Every capability below comes from the product&apos;s enforcement layer, so the matrix
            always reflects exactly what a plan unlocks.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/60">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                <th className="py-4 pl-6 pr-4 font-semibold">Capability</th>
                {columns.map((col) => (
                  <th
                    key={col.slug}
                    className={`py-4 px-4 font-semibold ${
                      col.featured ? "text-brand-300" : "text-white"
                    }`}
                  >
                    <span className="block">{col.label}</span>
                    <span className="block text-[10px] font-normal normal-case text-ink-400">
                      {headPrice(col.plan)} <span className="text-ink-500">{headPeriod(col.plan)}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {MATRIX_SECTIONS.map((sec) => (
                <React.Fragment key={sec.category}>
                  <tr className="bg-ink-950/90">
                    <td colSpan={columns.length + 1} className="py-2.5 pl-6 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-400">
                      {sec.category}
                    </td>
                  </tr>
                  {sec.intro ? (
                    <tr className="bg-ink-950/40">
                      <td colSpan={columns.length + 1} className="py-2 pl-6 pr-6 text-[11px] leading-relaxed text-ink-500">
                        {sec.intro}
                      </td>
                    </tr>
                  ) : null}
                  {sec.rows.map((r) => (
                    <tr key={r.feature} className="hover:bg-white/[0.02]">
                      <td className="sticky left-0 bg-ink-900 py-3.5 pl-6 pr-4 font-medium text-ink-200 shadow-[1px_0_0_0_rgba(255,255,255,0.04)]">
                        {r.feature}
                      </td>
                      {columns.map((col) => {
                        const value = r.resolve(capsOf(col.plan, col.slug === "free"));
                        return (
                          <td
                            key={col.slug}
                            className={`py-3.5 px-4 ${
                              col.featured ? "bg-brand-500/[0.025]" : ""
                            }`}
                          >
                            <span className="flex items-center justify-center">{cellView(value)}</span>
                          </td>
                        );
                      })}
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
