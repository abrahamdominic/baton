import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing",
  description:
    "Simple, transparent pricing for Baton: free for individuals, flat per-seat for teams, and a custom plan for organizations with many repos.",
};

const TIERS = [
  {
    name: "Individual",
    price: "$0",
    period: "forever",
    blurb: "For solo developers and open-source maintainers.",
    features: [
      "Up to 3 repos",
      "Live status card in every PR",
      "State labels + GitHub-native UX",
      "Your Move dashboard",
      "Community support",
    ],
    cta: "Install for free",
    featured: false,
  },
  {
    name: "Team",
    price: "$4",
    period: "per user / month",
    blurb: "For engineering teams that ship together.",
    features: [
      "Unlimited repos",
      "Per-repo nudge thresholds",
      "Reviewer @-mentions on stall",
      "Repo boards + Your Move",
      "Priority support",
      "SOX/GDPR-friendly data map",
    ],
    cta: "Start 14-day trial",
    featured: true,
  },
  {
    name: "Organization",
    price: "Custom",
    period: "annual commitment",
    blurb: "For large orgs that want SLAs, SSO, and audit logs.",
    features: [
      "Everything in Team",
      "SAML/SCIM SSO",
      "Audit log export (webhook/API)",
      "Highest GitHub API rate limits",
      "Dedicated onboarding",
      "95.99% uptime SLA",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-16">
        <h1 className="text-center text-4xl font-bold tracking-tight">Pricing</h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-300">
          Baton pays for itself the first time it prevents a 3-day PR from going stale. No credit
          card required.
        </p>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`card flex flex-col p-6 ${t.featured ? "border-brand-500/50 shadow-lift" : ""}`}
            >
              {t.featured ? (
                <span className="chip chip-info self-start">Most popular</span>
              ) : null}
              <h2 className="mt-3 text-lg font-semibold">{t.name}</h2>
              <p className="mt-1 text-3xl font-extrabold">{t.price}</p>
              <p className="text-xs text-ink-400">{t.period}</p>
              <p className="mt-3 text-sm text-ink-300">{t.blurb}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-200">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-signal-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/login?next=/dashboard"
                className={`${t.featured ? "btn-primary" : "btn-ghost"} mt-6`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-ink-400">
          Open-source maintainers get the Team plan free on public repos. Baton is AGPL-3.0; a
          self-hosted edition is in the works.
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}