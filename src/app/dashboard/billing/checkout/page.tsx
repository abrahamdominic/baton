import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { config } from "@/lib/env-boot";
import { isStripeConfigured, isUsdcConfigured, usdcSettings } from "@/lib/config";
import { getPlanById } from "@/lib/billing/plans";
import { getEntitlement } from "@/lib/billing/entitlement";
import { listSubscriptionsForUser } from "@/lib/billing/subscriptions";
import { planPriceCents } from "@/lib/billing/pricing";
import { CheckoutForm } from "./checkout-form";
import { PageHeader } from "@/components/ui";
import { IconArrowLeft, IconAlertCircle } from "@/components/icons";

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

  // Surface an existing pending checkout so the user finishes or cancels it
  // instead of hitting a hard "already pending" error (never a permanent block).
  const openSubs = await listSubscriptionsForUser(user.id);
  const pendingCheckout =
    openSubs.find((s) => s.status === "pending" || s.status === "payment_failed") ?? null;
  const blocksPlanChange = pendingCheckout && pendingCheckout.plan_id !== plan.id;

  const monthlyPrice = planPriceCents(plan, "monthly");
  const annualPrice = planPriceCents(plan, "annual");

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

      {blocksPlanChange && pendingCheckout ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn-500/25 bg-warn-500/[0.06] px-4 py-3 text-xs text-warn-200">
          <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
          <span>
            You have a pending checkout for{" "}
            <span className="font-semibold text-white">{pendingCheckout.plan?.name ?? "another plan"}</span>.
            Finish or cancel that checkout first, or continue it from your{" "}
            <Link href="/dashboard/billing" className="font-medium text-brand-300 hover:text-brand-200">
              billing page
            </Link>{" "}
            before switching plans.
          </span>
        </div>
      ) : null}

      {/* Monthly / Annual switch — both links re-render the server page with a
          recomputed server-authoritative amount (the UI can never drift from it). */}
      {!plan.price_custom ? (
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {(["monthly", "annual"] as const).map((opt) => {
              const active = interval === opt;
              return (
                <Link
                  key={opt}
                  href={`/dashboard/billing/checkout?plan=${plan.id}&billing=${opt}`}
                  className={`flex flex-col items-center rounded-lg px-3 py-2 text-center transition-colors ${
                    active
                      ? "bg-brand-500/15 text-white ring-1 ring-brand-500/30"
                      : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200"
                  }`}
                >
                  <span className="text-sm font-semibold capitalize">{opt}</span>
                  <span className="mt-0.5 font-mono text-[11px] text-ink-400">
                    ${((opt === "monthly" ? monthlyPrice : annualPrice) / 100).toFixed(2)}
                    {opt === "annual" ? "/year" : "/month"}
                  </span>
                </Link>
              );
            })}
          </div>
          {monthlyPrice > 0 && annualPrice > 0 && annualPrice < monthlyPrice * 12 ? (
            <p className="px-2 pb-1.5 pt-1 text-center text-[11px] text-signal-300">
              Choose annual and save ${((monthlyPrice * 12 - annualPrice) / 100).toFixed(2)} a year.
            </p>
          ) : null}
        </div>
      ) : null}

      <PageHeader
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