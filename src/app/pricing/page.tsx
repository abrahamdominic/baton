import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { PricingView, type Tier } from "@/components/pricing-view";
import { currentUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/config";
import { publicPlans } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing: Transparent, Per-Seat Plans for Engineering Teams",
  description:
    "Simple pricing for Baton: free for individuals and open-source public repos, Team at $10/user/mo ($96/user/yr billed annually), and Organization at $50/mo ($480/yr billed annually).",
};

const CHECKOUT_PREFIX = "/dashboard/billing/checkout?plan=";

const FALLBACK_CHECKOUT = {
  team: {
    monthly: `${CHECKOUT_PREFIX}plan_team_default&billing=monthly`,
    annual: `${CHECKOUT_PREFIX}plan_team_default&billing=annual`,
  },
  organization: {
    monthly: `${CHECKOUT_PREFIX}plan_org_default&billing=monthly`,
    annual: `${CHECKOUT_PREFIX}plan_org_default&billing=annual`,
  },
} as const;

/**
 * Drive the public pricing page from the same `plans` table the admin
 * dashboard edits. When Supabase is not configured (local/dev), the
 * hardcoded marketing tiers are shown instead.
 */
async function planOverrides(): Promise<Record<string, Partial<Tier>>> {
  try {
    if (!isSupabaseConfigured()) return {};
    const plans = await publicPlans();
    const overrides: Record<string, Partial<Tier>> = {};
    for (const plan of plans) {
      const features = Array.isArray(plan.features)
        ? (plan.features as unknown[]).filter((f): f is string => typeof f === "string")
        : [];
      const choose = (interval: string) => `Choose ${plan.name} (${interval})`;
      overrides[plan.slug] = {
        name: plan.name,
        blurb: plan.description ?? "",
        features: features.length > 0 ? features : ["Everything in the free tier"],
        monthlyPrice: plan.price_custom ? "Custom" : `$${(plan.monthly_price_cents / 100).toFixed(0)}`,
        annualPrice: plan.price_custom ? "Custom" : `$${(plan.annual_price_cents / 100).toFixed(0)}`,
        ctaMonthly: plan.price_custom ? "Contact Enterprise Sales" : choose("Monthly"),
        ctaAnnual: plan.price_custom ? "Contact Enterprise Sales" : choose("Annual"),
        checkoutUrlMonthly: `${CHECKOUT_PREFIX}${plan.id}&billing=monthly`,
        checkoutUrlAnnual: `${CHECKOUT_PREFIX}${plan.id}&billing=annual`,
      };
    }
    return overrides;
  } catch {
    return {};
  }
}

export default async function PricingPage() {
  const user = await currentUser();
  const signedIn = Boolean(user);

  const overrides = await planOverrides();

  const authAware = (path: string) =>
    signedIn ? path : `/auth/login?next=${encodeURIComponent(path)}`;

  // Free tier: signed-in users go straight to the dashboard.
  overrides.individual = {
    ...overrides.individual,
    checkoutUrlMonthly: signedIn ? "/dashboard" : "/auth/login?next=%2Fdashboard",
    checkoutUrlAnnual: signedIn ? "/dashboard" : "/auth/login?next=%2Fdashboard",
  };

  // Paid tiers: direct checkout for signed-in users, GitHub login first otherwise.
  for (const slug of ["team", "organization"] as const) {
    const prev = overrides[slug] ?? {};
    overrides[slug] = {
      ...prev,
      checkoutUrlMonthly: authAware(prev.checkoutUrlMonthly ?? FALLBACK_CHECKOUT[slug].monthly),
      checkoutUrlAnnual: authAware(prev.checkoutUrlAnnual ?? FALLBACK_CHECKOUT[slug].annual),
    };
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />
      <main className="container-page py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center mb-14">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Simple, honest pricing. No seat games.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-300 leading-relaxed">
            Free forever for individuals and public open-source repos. Flat, predictable per-user
            pricing for teams.
          </p>
        </div>

        <PricingView overrides={overrides} />
      </main>
      <MarketingFooter />
    </div>
  );
}