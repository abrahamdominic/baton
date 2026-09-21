import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconCheck } from "@/components/icons";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing",
  description:
    "Simple pricing for Baton: free for individuals, a flat per-seat plan for teams, and a custom plan for organizations with many repositories.",
};

const TIERS = [
  {
    name: "Individual",
    price: "$0",
    period: "free forever",
    blurb: "For solo developers and open-source maintainers.",
    features: [
      "Up to 3 repositories",
      "Live status card in every PR",
      "State labels on GitHub",
      "Your Move dashboard",
      "Community support",
    ],
    cta: "Start for free",
    featured: false,
  },
  {
    name: "Team",
    price: "$4",
    period: "per user, per month",
    blurb: "For engineering teams that ship together.",
    features: [
      "Unlimited repositories",
      "Per-repo nudge thresholds",
      "Reviewer @-mentions on stall",
      "Repo boards and Your Move",
      "Priority support",
    ],
    cta: "Start a 14-day trial",
    featured: true,
  },
  {
    name: "Organization",
    price: "Custom",
    period: "annual commitment",
    blurb: "For large orgs that want SAML, SLAs, and audit exports.",
    features: [
      "Everything in Team",
      "SAML and SCIM SSO",
      "Audit log export via webhook or API",
      "Dedicated onboarding",
      "99.5% uptime SLA",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-20">
        <div className="max-w-2xl">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
            Simple pricing, no seat games
          </h1>
          <p className="mt-3 text-ink-300">
            Free to start, and only billed for people who actually use it. No credit card required
            on the free plan.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-xl border bg-ink-900 p-7 ${
                t.featured ? "border-brand-500/50 shadow-lift" : "border-ink-800"
              }`}
            >
              {t.featured ? (
                <span className="absolute -top-3 left-6 rounded-md border border-brand-500/30 bg-ink-900 px-2.5 py-0.5 text-xs font-semibold text-brand-300">
                  Recommended
                </span>
              ) : null}
              <h2 className="text-base font-semibold text-ink-100">{t.name}</h2>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight text-ink-50">{t.price}</span>
                <span className="text-sm text-ink-400">{t.period}</span>
              </div>
              <p className="mt-3 text-sm text-ink-400">{t.blurb}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-ink-200">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-500" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/login?next=/dashboard"
                className={`${t.featured ? "btn-primary" : "btn-ghost"} mt-8 w-full`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-ink-400">
          Open-source maintainers get the Team plan free on public repositories. Baton is published
          as AGPL-3.0 open source, and a self-hosted edition is available for teams that need full
          control of their data.
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}