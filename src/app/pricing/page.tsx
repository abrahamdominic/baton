import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { PricingView } from "@/components/pricing-view";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing: Transparent, Per-Seat Plans for Engineering Teams",
  description:
    "Simple pricing for Baton: free for individuals and open-source public repos, $10/user/mo for teams ($8/user/mo billed annually), and custom enterprise plans.",
};

export default function PricingPage() {
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

        <PricingView />
      </main>
      <MarketingFooter />
    </div>
  );
}