import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement } from "@/lib/billing/entitlement";
import { getCurrentSubscription, listSubscriptionsForUser } from "@/lib/billing/subscriptions";
import { listPaymentsForUser, findOpenPaymentForSubscription } from "@/lib/billing/payments";
import { publicPlans } from "@/lib/billing/plans";
import { listSubscriptionEvents } from "@/lib/billing/events";
import { SUBSCRIPTION_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/billing/types";
import {
  IconCheck,
  IconClock,
  IconAlertCircle,
  IconShield,
  IconArrowRight,
  IconExternalLink,
  IconCreditCard,
  IconGift,
} from "@/components/icons";
import { PendingCheckoutControls } from "./pending-checkout-controls";
import { CancelPlanButton, ReactivateButton } from "./billing-buttons";
import { ResumeCheckoutButton } from "./resume-checkout-button";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Billing & Plans: Baton",
};

function formatDate(iso: string | null): string {
  if (!iso) return "N/A";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "active_until_period_end":
    case "confirmed":
      return "border-signal-500/30 bg-signal-500/10 text-signal-300";
    case "pending":
    case "pending_verification":
      return "border-brand-500/30 bg-brand-500/10 text-brand-300";
    case "failed":
    case "rejected":
    case "past_due":
    case "payment_failed":
      return "border-danger-500/30 bg-danger-500/10 text-danger-300";
    case "expired":
    case "canceled":
    case "refunded":
    case "cancelled":
      return "border-white/[0.08] bg-white/[0.04] text-ink-400";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-ink-300";
  }
}

export default async function BillingPage() {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard/billing");

  const [entitlement, payments, events] = await Promise.all([
    getEntitlement(user.id),
    listPaymentsForUser(user.id, 20),
    listSubscriptionEvents(user.id, 20),
  ]);

  const subscription = entitlement.subscription ?? (await getCurrentSubscription(user.id));
  const plan = subscription?.plan ?? null;

  // A pending checkout is any still-open pre-payment subscription: `pending`
  // (mid-checkout / orphaned-but-visible) or `payment_failed` (its payment did
  // not clear). We surface it separately so the user can continue or cancel it;
  // a cancelled checkout never permanently blocks a new purchase.
  const allSubs = await listSubscriptionsForUser(user.id);
  const pendingCheckout =
    allSubs.find((s) => s.status === "pending" || s.status === "payment_failed") ?? null;
  const pendingPayment = pendingCheckout ? await findOpenPaymentForSubscription(pendingCheckout.id) : null;
  const pendingInterval =
    (pendingPayment?.metadata as { interval?: string } | null)?.interval === "annual" ? "annual" : "monthly";

  const periodEnd = subscription?.current_period_end ?? null;
  const cancelRequested = subscription?.cancel_at_period_end ?? false;
  const status = subscription?.status ?? "none";
  const isGifted = subscription?.payment_provider === "gift";

  const availablePlans = await publicPlans();

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const pendingStatusLabel = pendingCheckout
    ? pendingCheckout.status === "payment_failed"
      ? "Payment failed"
      : "Pending checkout"
    : null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        title="Billing &amp; Subscription"
        description="Manage your Baton subscription plan, invoice history, and crypto payment options."
        actions={
          <Link href="/pricing" className="btn btn-primary btn-sm">
            <span>{status === "none" ? "Upgrade to Team" : "View Plans"}</span>
            <IconArrowRight className="h-3 w-3" />
          </Link>
        }
      />

      {/* Active Plan Card */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Active Plan Status
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            {entitlement.hasPaidAccess ? "Paid Access Enabled" : "Free Individual Tier"}
          </span>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  {plan?.name ?? "Individual Free"}
                </h2>
                <span
                  className={`inline-flex items-center rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                    status,
                  )}`}
                >
                  {SUBSCRIPTION_STATUS_LABELS[status] ?? status}
                </span>
                {cancelRequested ? (
                  <span className="inline-flex items-center rounded-md border border-warn-500/30 bg-warn-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-warn-300">
                    Cancels at period end
                  </span>
                ) : null}
                {isGifted ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300">
                    <IconGift className="h-3 w-3" />
                    Admin-gifted
                  </span>
                ) : null}
              </div>

              <p className="text-xs leading-relaxed text-ink-300 sm:text-sm">
                {status === "none"
                  ? "You are on the free tier (up to 3 repositories with status cards, labels, and personal queue)."
                  : isGifted
                    ? `${plan?.name ?? "This"} plan was granted to you by an administrator — no payment is collected and it never renews automatically.`
                    : plan?.description ?? "Baton Team subscription."}
              </p>

              {periodEnd ? (
                <p className="flex items-center gap-1.5 pt-1 font-mono text-xs text-ink-400">
                  <IconClock className="h-3.5 w-3.5 text-ink-500" />
                  {isGifted ? (
                    <>
                      <span>Gifted access ends</span>
                      <span className="font-bold text-white">{formatDate(periodEnd)}</span>
                    </>
                  ) : (
                    <>
                      <span>Current billing period ends</span>
                      <span className="font-bold text-white">{formatDate(periodEnd)}</span>
                      {cancelRequested ? (
                        <span className="text-warn-300 font-semibold">(access ends on this date)</span>
                      ) : null}
                    </>
                  )}
                </p>
              ) : null}

              {subscription?.payment_provider === "usdc" ? (
                <p className="flex items-center gap-1.5 pt-1 font-mono text-xs text-brand-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  <span>Paid via USDC on Base &middot; renews manually per billing period.</span>
                </p>
              ) : null}

              {status === "payment_failed" || status === "past_due" ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-danger-500/30 bg-danger-500/10 p-3 text-xs font-medium text-danger-300">
                  <IconAlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Your previous payment did not clear. Please renew your subscription to prevent
                    service interruption.
                  </span>
                </div>
              ) : null}

              {/* Plan Features Checklist */}
              <div className="pt-2">
                <p className="font-mono text-[10px] uppercase font-semibold text-ink-500 mb-2">
                  Plan Entitlements:
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 text-xs text-ink-300">
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>{entitlement.hasPaidAccess ? "Unlimited tracked repositories" : "Up to 3 tracked repositories"}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>Automated status cards on pull requests</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>Custom per-repo inactivity nudge thresholds</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>Real-time repo board Kanban lanes</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Plan Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 lg:flex-col lg:items-end lg:pt-0">
              {status === "active_until_period_end" ? (
                <ReactivateButton subscriptionId={subscription!.id} />
              ) : null}

              <Link href="/pricing" className="btn btn-ghost btn-sm">
                <span>{status === "none" ? "Upgrade to Team" : "Change Plan"}</span>
                <IconArrowRight className="h-3 w-3" />
              </Link>

              {!isGifted &&
              plan &&
              subscription?.payment_provider === "usdc" &&
              ["active", "active_until_period_end"].includes(status) ? (
                <Link
                  href={`/dashboard/billing/checkout?plan=${plan.id}&billing=monthly`}
                  className="btn btn-ghost btn-sm"
                >
                  <span>Renew (USDC)</span>
                  <IconArrowRight className="h-3 w-3" />
                </Link>
              ) : null}

              {!isGifted && status === "active" ? (
                <CancelPlanButton
                  subscriptionId={subscription!.id}
                  planName={plan?.name ?? "this plan"}
                  periodEnd={periodEnd}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Pending Checkout Card */}
      {pendingCheckout ? (
        <section className="overflow-hidden rounded-xl border border-warn-500/25 bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {pendingStatusLabel}
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              started {formatDate(pendingCheckout.created_at)}
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-lg font-bold text-white">
                    {pendingCheckout.plan?.name ?? "Plan"}
                  </h3>
                  <span
                    className={`rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                      pendingCheckout.status,
                    )}`}
                  >
                    {SUBSCRIPTION_STATUS_LABELS[pendingCheckout.status] ?? pendingCheckout.status}
                  </span>
                  {pendingPayment ? (
                    <span
                      className={`rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                        pendingPayment.status,
                      )}`}
                    >
                      {PAYMENT_STATUS_LABELS[pendingPayment.status] ?? pendingPayment.status}
                    </span>
                  ) : null}
                </div>

                <p className="text-xs leading-relaxed text-ink-300">
                  {pendingCheckout.status === "payment_failed" ? (
                    <>
                      Your payment for this checkout did not clear. Retry it now or cancel it and
                      start fresh — this never blocks you from switching plans.
                    </>
                  ) : pendingPayment?.status === "confirmed" ? (
                    <>This checkout is being activated. If it does not resolve, contact support.</>
                  ) : (
                    <>
                      You started this {pendingInterval} checkout but have not finished paying yet.
                      Continue it to activate {pendingCheckout.plan?.name ?? "your plan"}, or cancel it
                      and choose something different.
                    </>
                  )}
                </p>

                {pendingPayment ? (
                  <p className="font-mono text-sm font-bold tabular-nums text-white">
                    {formatMoney(pendingPayment.amount)} {pendingPayment.currency}{" "}
                    <span className="text-[11px] font-normal text-ink-400">
                      {pendingPayment.payment_provider === "usdc" ? (
                        <>
                          via USDC on {pendingPayment.crypto_network ?? "Base"} · saved as{" "}
                          {pendingInterval}
                        </>
                      ) : (
                        <>via card (Stripe) · saved as {pendingInterval}</>
                      )}
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                <ResumeCheckoutButton
                  subscriptionId={pendingCheckout.id}
                  isPaymentFailed={pendingCheckout.status === "payment_failed"}
                />
                <PendingCheckoutControls
                  subscriptionId={pendingCheckout.id}
                  planName={pendingCheckout.plan?.name ?? "this plan"}
                  hasSubmittedCryptoTx={Boolean(
                    pendingPayment?.status === "pending_verification" && pendingPayment?.crypto_transaction_hash,
                  )}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Available Plans */}
      <section className="grid gap-4 lg:grid-cols-2">
        {availablePlans.map((p) => {
          const isCurrent = plan?.id === p.id;
          const monthly = formatMoney(p.monthly_price_cents);
          const annual = formatMoney(p.annual_price_cents);
          return (
            <div
              key={p.id}
              className={`flex flex-col rounded-xl border p-5 ${
                isCurrent ? "border-brand-500/30 bg-brand-500/[0.04]" : "border-white/[0.08] bg-ink-900/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{p.name}</h3>
                {isCurrent ? (
                  <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
                    current
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-white">{monthly}</span>
                <span className="text-xs text-ink-400">/month</span>
                <span className="ml-2 font-mono text-xs text-ink-400">{annual}/year</span>
              </div>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-400">
                {p.description?.trim() ? p.description : null}
              </p>
              <div className="mt-4">
                <Link
                  href={`/dashboard/billing/checkout?plan=${p.id}&billing=monthly`}
                  className={`btn btn-sm ${isCurrent ? "btn-ghost" : "btn-primary"}`}
                >
                  <span>{isCurrent ? "Your plan" : "Choose this plan"}</span>
                  <IconArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </section>

      {/* Assurance and Support Cards */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-signal-400">
            <IconShield className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold text-white">Payment Security &amp; Privacy</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              Card checkouts are processed directly via Stripe; card details never touch Baton servers.
              USDC checkouts are verified deterministically on Base.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-brand-300">
            <IconCreditCard className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold text-white">Billing &amp; Invoice Support</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              Need custom invoicing, VAT exemption, or enterprise agreements? Contact our team at{" "}
              <a
                href="mailto:billing@baton.dev"
                className="font-medium text-brand-300 underline hover:text-brand-200"
              >
                billing@baton.dev
              </a>.
            </p>
          </div>
        </div>
      </section>

      {/* Payment & Invoice History Table */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Payment &amp; Invoice History
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            {payments.length} record{payments.length === 1 ? "" : "s"}
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-xs text-ink-500">
              No payment transactions on record. Free individual tier requires no payment method.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-white">
                      {p.plan?.name ?? "Team Plan"} &middot; {p.payment_type.replace("_", " ")}
                    </p>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                    {formatDate(p.created_at)} &middot;{" "}
                    {p.payment_provider === "usdc" ? `USDC (${p.crypto_network})` : "Credit Card (Stripe)"}
                    {p.crypto_transaction_hash ? (
                      <span className="ml-1 inline-flex items-center gap-1">
                        &middot;{" "}
                        <a
                          href={`https://basescan.org/tx/${p.crypto_transaction_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-300 hover:text-brand-200 inline-flex items-center gap-0.5"
                        >
                          <span>BaseScan</span>
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      </span>
                    ) : null}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                      p.status,
                    )}`}
                  >
                    {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">
                    ${(p.amount / 100).toFixed(2)} {p.currency}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Subscription Lifecycle History */}
      {events.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Subscription Lifecycle Log
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {events.slice(0, 8).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between px-5 py-3 text-xs"
              >
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-300">
                  {e.eventType.replace(/_/g, " ")}
                </span>
                {e.newStatus ? (
                  <span className="font-mono text-[11px] text-ink-400">
                    status &rarr; <span className="text-white font-semibold">{e.newStatus}</span>
                  </span>
                ) : null}
                <span className="font-mono text-[11px] text-ink-500">
                  {formatDate(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}