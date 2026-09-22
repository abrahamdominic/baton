import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { config } from "@/lib/env-boot";
import { isStripeConfigured, isUsdcConfigured, usdcSettings } from "@/lib/config";
import { getPlanById } from "@/lib/billing/plans";
import { getEntitlement } from "@/lib/billing/entitlement";
import { planPriceCents } from "@/lib/billing/pricing";
import { CheckoutForm } from "./checkout-form";
import { PageHeader } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Checkout: Baton",
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string; billing?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect(`/auth/login?next=/dashboard/billing/checkout`);

  const params = searchParams ? await searchParams : undefined;
  const planId = params?.plan;
  const interval = params?.billing === "annual" ? "annual" : "monthly";

  const plan = planId ? await getPlanById(planId).catch(() => null) : null;
  if (!plan || !plan.is_active) redirect("/pricing");

  const entitlement = await getEntitlement(user.id);
  const amountMinor = planPriceCents(plan, interval);
  const walletAddress = isUsdcConfigured(config) ? usdcSettings().walletAddress : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="mb-2 flex items-center gap-2 font-mono text-xs text-ink-400">
        <Link
          href="/dashboard/billing"
          className="flex items-center gap-1 text-ink-400 transition-colors hover:text-white"
        >
          <IconArrowLeft className="h-3 w-3" />
          <span>Billing</span>
        </Link>
        <span className="text-ink-600">/</span>
        <span className="text-white">Checkout</span>
      </div>

      <PageHeader
        eyebrow="Secure Checkout"
        title={
          <span>
            {plan.name} &middot; <span className="capitalize">{interval}</span>
          </span>
        }
        description="Protected by server-verified billing. No card details ever touch Baton servers."
      />

      <CheckoutForm
        plan={{
          id: plan.id,
          slug: plan.slug,
          name: plan.name,
          description: plan.description,
          priceCustom: plan.price_custom,
        }}
        interval={interval}
        amountMinor={amountMinor}
        planFeatures={plan.features}
        providers={{
          stripe: isStripeConfigured(config),
          usdc: isUsdcConfigured(config),
        }}
        usdcWalletAddress={walletAddress}
        alreadySubscribed={Boolean(
          entitlement.subscription?.plan_id === plan.id &&
            entitlement.hasPaidAccess &&
            entitlement.subscription.payment_provider === "stripe",
        )}
        canRenewUsdc={Boolean(
          entitlement.subscription?.plan_id === plan.id &&
            entitlement.hasPaidAccess &&
            entitlement.subscription.payment_provider === "usdc",
        )}
      />
    </div>
  );
}