import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { PricingView, type Tier } from "@/components/pricing-view";
import { isSupabaseConfigured } from "@/lib/config";
import { publicPlans } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing: Transparent, Per-Seat Plans for Engineering Teams",
  description:
    "Simple pricing for Baton: free for individuals and open-source public repos, $10/user/mo for teams ($8/user/mo billed annually), and custom enterprise plans.",
};

const CHECKOUT_PREFIX = "/dashboard/billing/checkout?plan=";

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
      overrides[plan.slug] = {
        name: plan.name,
        blurb: plan.description ?? "",
        features: features.length > 0 ? features : ["Everything in the free tier"],
        monthlyPrice: plan.price_custom ? "Custom" : `$${(plan.monthly_price_cents / 100).toFixed(0)}`,
        annualPrice: plan.price_custom ? "Custom" : `$${(plan.annual_price_cents / 100).toFixed(0)}`,
        ctaMonthly: plan.price_custom ? "Contact Enterprise Sales" : "Choose Team",
        ctaAnnual: plan.price_custom ? "Contact Enterprise Sales" : "Choose Team",
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
  const overrides = await planOverrides();

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />
      <main className="container-page py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center mb-14">
          <p className="eyebrow justify-center">Pricing &amp; Plans</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
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