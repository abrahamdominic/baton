import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement } from "@/lib/billing/entitlement";
import {
  getCurrentSubscription,
  listSubscriptionsForUser,
} from "@/lib/billing/subscriptions";
import {
  listPaymentsForUser,
  findOpenPaymentForSubscription,
} from "@/lib/billing/payments";
import { readBillingStore } from "@/lib/billing/store-read";
import { publicPlans } from "@/lib/billing/plans";
import { listSubscriptionEvents } from "@/lib/billing/events";
import {
  cryptoNetworkLabel,
  paymentStatusLabel,
  subscriptionStatusLabel,
} from "@/lib/i18n/billing-label";
import {
  IconCheck,
  IconClock,
  IconAlertCircle,
  IconShield,
  IconExternalLink,
  IconCreditCard,
  IconGift,
} from "@/components/icons";
import { LinkArrow } from "@/components/marketing/arrow";
import { PendingCheckoutControls } from "./pending-checkout-controls";
import { ManageBillingButton } from "./manage-billing-button";
import { billingPortalAvailability } from "@/lib/billing/billing-portal";
import { CancelPlanButton, ReactivateButton } from "./billing-buttons";
import { ResumeCheckoutButton } from "./resume-checkout-button";
import { PageHeader } from "@/components/ui";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { config } from "@/lib/env-boot";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    robots: { index: false, follow: false },
    title: t("billing:meta_title"),
  };
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
      return "border-hairline bg-surface-2 text-ink-400";
    default:
      return "border-hairline bg-surface-2 text-ink-300";
  }
}

export default async function BillingPage() {
  const {
    t,
    tc,
    formatDateTime: formatDate,
    formatCurrency,
  } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard/billing");

  const [entitlement, paymentsRead, eventsRead] = await Promise.all([
    getEntitlement(user.id),
    // The payment ledger is an optional history section. Its store (Supabase) is
    // a separate service, so a failed read is degraded to an "unavailable"
    // notice rather than allowed to replace the whole page with a fatal error.
    readBillingStore("payments.list", () => listPaymentsForUser(user.id, 20), []),
    readBillingStore(
      "subscription-events.list",
      () => listSubscriptionEvents(user.id, 20),
      [],
    ),
  ]);
  const payments = paymentsRead.value;
  const events = eventsRead.value;

  const subscriptionRead = entitlement.subscription
    ? { value: entitlement.subscription, ok: true }
    : await readBillingStore(
        "subscription.current",
        () => getCurrentSubscription(user.id),
        null,
      );
  const subscription = subscriptionRead.value;
  const plan = subscription?.plan ?? null;

  // A pending checkout is any still-open pre-payment subscription: `pending`
  // (mid-checkout / orphaned-but-visible) or `payment_failed` (its payment did
  // not clear). We surface it separately so the user can continue or cancel it;
  // a cancelled checkout never permanently blocks a new purchase.
  const subscriptionsRead = await readBillingStore(
    "subscriptions.list",
    () => listSubscriptionsForUser(user.id),
    [],
  );
  const allSubs = subscriptionsRead.value;
  const pendingCheckout =
    allSubs.find(
      (s) => s.status === "pending" || s.status === "payment_failed",
    ) ?? null;
  const pendingPaymentRead = pendingCheckout
    ? await readBillingStore(
        "payments.open-for-subscription",
        () => findOpenPaymentForSubscription(pendingCheckout.id),
        null,
      )
    : { value: null, ok: true };
  const pendingPayment = pendingPaymentRead.value;
  const pendingInterval =
    (pendingPayment?.metadata as { interval?: string } | null)?.interval ===
    "annual"
      ? "annual"
      : "monthly";

  const periodEnd = subscription?.current_period_end ?? null;
  const cancelRequested = subscription?.cancel_at_period_end ?? false;
  const status = subscription?.status ?? "none";
  const isGifted = subscription?.payment_provider === "gift";

  const availablePlans = await publicPlans();

  // Offered only where it can work: a Stripe-backed subscription has a customer
  // to open the portal for, a USDC or gifted one does not.
  const portalRead = await readBillingStore(
    "billing-portal.availability",
    () => billingPortalAvailability(user.id),
    { available: false, reason: "no_subscription" as const, subscriptionId: null },
  );
  const portal = portalRead.value;

  // Any failed read means the billing store could not be reached. Surface it
  // once, explicitly, instead of letting an empty history read as "no payments".
  const billingStoreAvailable =
    paymentsRead.ok &&
    eventsRead.ok &&
    subscriptionRead.ok &&
    subscriptionsRead.ok &&
    pendingPaymentRead.ok &&
    portalRead.ok;

  // Stripe needs the customer to act on their card before the plan can renew.
  // This is shown instead of, not in addition to, the generic failure notice,
  // because the required action is completely different.
  const actionRequired = Boolean(subscription?.payment_action_required);

  // Plan prices in the catalog are always USD. Payments are not: the ledger
  // stores whichever rail was used, so a payment amount must carry its own
  // currency rather than inheriting this default.
  const formatMoney = (cents: number, currency = "USD") =>
    formatCurrency(cents, currency);

  const pendingStatusLabel = pendingCheckout
    ? pendingCheckout.status === "payment_failed"
      ? subscriptionStatusLabel("payment_failed", t)
      : subscriptionStatusLabel("pending", t)
    : null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        title={t("billing:page_title")}
        description={t("billing:page_description")}
        actions={
          <Link href="/pricing" className="btn btn-primary btn-sm">
            <span>
              {t(
                status === "none"
                  ? "billing:upgrade_to_team"
                  : "billing:view_plans",
              )}
            </span>
            <LinkArrow className="h-3 w-3" />
          </Link>
        }
      />

      {/* Billing store outage. The plan card below still renders from the
          entitlement we could resolve; this makes the missing history and plan
          controls an explicit, honest state instead of a silent gap. */}
      {!billingStoreAvailable ? (
        <section
          role="alert"
          className="flex items-start gap-3 rounded-panel border border-warn-500/30 bg-warn-500/10 p-4"
        >
          <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
          <div>
            <h2 className="text-sm font-semibold text-warn-200">
              {t("billing:store_unavailable_title")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-warn-200/80">
              {t("billing:store_unavailable_body")}
            </p>
          </div>
        </section>
      ) : null}

      {/* Active Plan Card */}
      <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-hairline bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {t("billing:active_plan_status")}
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            {t(
              entitlement.hasPaidAccess
                ? "billing:paid_enabled"
                : "billing:free_tier",
            )}
          </span>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  {plan?.name ?? t("billing:individual_free")}
                </h2>
                <span
                  className={`inline-flex items-center rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                    status,
                  )}`}
                >
                  {subscriptionStatusLabel(status, t)}
                </span>
                {cancelRequested ? (
                  <span className="inline-flex items-center rounded-md border border-warn-500/30 bg-warn-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-warn-300">
                    {t("billing:cancels_at_period_end")}
                  </span>
                ) : null}
                {isGifted ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300">
                    <IconGift className="h-3 w-3" />
                    {t("billing:admin_gifted")}
                  </span>
                ) : null}
              </div>

              <p className="text-xs leading-relaxed text-ink-300 sm:text-sm">
                {status === "none"
                  ? t("billing:desc_free_tier")
                  : isGifted
                    ? t("billing:desc_gifted", {
                        plan: plan?.name ?? t("billing:desc_this"),
                      })
                    : (plan?.description ?? t("billing:desc_team"))}
              </p>

              {periodEnd ? (
                <p className="flex items-center gap-1.5 pt-1 font-mono text-xs text-ink-400">
                  <IconClock className="h-3.5 w-3.5 text-ink-500" />
                  {isGifted ? (
                    <>
                      <span>{t("billing:gifted_access_ends")}</span>
                      <span className="font-bold text-white">
                        {formatDate(periodEnd)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{t("billing:period_ends")}</span>
                      <span className="font-bold text-white">
                        {formatDate(periodEnd)}
                      </span>
                      {cancelRequested ? (
                        <span className="text-warn-300 font-semibold">
                          ({t("billing:access_ends_on_this_date")})
                        </span>
                      ) : null}
                    </>
                  )}
                </p>
              ) : null}

              {subscription?.payment_provider === "usdc" ? (
                <p className="flex items-center gap-1.5 pt-1 font-mono text-xs text-brand-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  <span>{t("billing:paid_via_usdc")}</span>
                </p>
              ) : null}

              {actionRequired ? (
                <div className="flex flex-col gap-3 rounded-control border border-warn-500/30 bg-warn-500/10 p-3 text-xs font-medium text-warn-200 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-start gap-2.5">
                    <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {subscription?.payment_action_reason ??
                        t("billing:action_required_banner")}
                    </span>
                  </span>
                  {portal.available ? (
                    <ManageBillingButton
                      className="btn btn-sm shrink-0 border-warn-500/40 bg-warn-500/15 text-warn-100 hover:bg-warn-500/25"
                      returnPath={`${config.SITE_URL}/dashboard/billing`}
                      label={t("billing:update_payment_method")}
                    />
                  ) : null}
                </div>
              ) : null}

              {!actionRequired && (status === "payment_failed" || status === "past_due") ? (
                <div className="flex items-start gap-2.5 rounded-control border border-danger-500/30 bg-danger-500/10 p-3 text-xs font-medium text-danger-300">
                  <IconAlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{t("billing:payment_not_cleared")}</span>
                </div>
              ) : null}

              {/* Plan Features Checklist */}
              <div className="pt-2">
                <p className="font-mono text-[10px] uppercase font-semibold text-ink-500 mb-2">
                  {t("billing:plan_entitlements")}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 text-xs text-ink-300">
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>
                      {t(
                        entitlement.hasPaidAccess
                          ? "billing:ent_unlimited_repos"
                          : "billing:ent_three_repos",
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>{t("billing:ent_status_cards")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>{t("billing:ent_custom_thresholds")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <IconCheck className="h-3.5 w-3.5 text-signal-400 shrink-0" />
                    <span>{t("billing:ent_kanban")}</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Plan Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 lg:flex-col lg:items-end lg:pt-0">
              {status === "active_until_period_end" ? (
                <ReactivateButton subscriptionId={subscription!.id} />
              ) : null}

              {status !== "none" && portal.available ? (
                <ManageBillingButton
                  returnPath={`${config.SITE_URL}/dashboard/billing`}
                />
              ) : (
                <Link href="/pricing" className="btn btn-ghost btn-sm">
                  <span>
                    {t(
                      status === "none"
                        ? "billing:upgrade_to_team"
                        : "billing:change_plan",
                    )}
                  </span>
                  <LinkArrow className="h-3 w-3" />
                </Link>
              )}

              {!isGifted &&
              plan &&
              subscription?.payment_provider === "usdc" &&
              ["active", "active_until_period_end"].includes(status) ? (
                <Link
                  href={`/dashboard/billing/checkout?plan=${plan.id}&billing=monthly`}
                  className="btn btn-ghost btn-sm"
                >
                  <span>{t("billing:renew_usdc")}</span>
                  <LinkArrow className="h-3 w-3" />
                </Link>
              ) : null}

              {!isGifted && status === "active" ? (
                <CancelPlanButton
                  subscriptionId={subscription!.id}
                  planName={plan?.name ?? t("billing:this_plan")}
                  periodEnd={periodEnd}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Pending Checkout Card */}
      {pendingCheckout ? (
        <section className="rounded-panel border border-warn-500/25 bg-ink-900/60 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-ink-950/70 px-5 py-3">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-warn-300">
              <IconAlertCircle className="h-3.5 w-3.5" />
              {pendingStatusLabel}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
              <IconClock className="h-3 w-3" />
              {t("billing:started", {
                date: formatDate(pendingCheckout.created_at),
              })}
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-lg font-bold text-white">
                    {pendingCheckout.plan?.name ?? t("billing:plan_fallback")}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                      pendingCheckout.status,
                    )}`}
                  >
                    {subscriptionStatusLabel(pendingCheckout.status, t)}
                  </span>
                  {pendingPayment ? (
                    <span
                      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                        pendingPayment.status,
                      )}`}
                    >
                      {paymentStatusLabel(pendingPayment.status, t)}
                    </span>
                  ) : null}
                </div>

                <p className="max-w-xl text-xs leading-relaxed text-ink-300">
                  {pendingCheckout.status === "payment_failed" ? (
                    <>{t("billing:pending_failed")}</>
                  ) : pendingPayment?.status === "confirmed" ? (
                    <>{t("billing:pending_activating")}</>
                  ) : (
                    <>
                      {t("billing:pending_unfinished_before", {
                        interval: t(`billing:interval_${pendingInterval}`),
                      })}{" "}
                      <span className="font-mono text-ink-200">
                        {formatDate(pendingCheckout.created_at)}
                      </span>{" "}
                      {t("billing:pending_unfinished_after", {
                        plan:
                          pendingCheckout.plan?.name ?? t("billing:your_plan"),
                      })}
                    </>
                  )}
                </p>

                {pendingPayment ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-sm tabular-nums text-white">
                    <span className="font-bold">
                      {formatMoney(
                        pendingPayment.amount,
                        pendingPayment.currency,
                      )}
                    </span>
                    <span className="text-[11px] font-normal text-ink-400">
                      {pendingPayment.payment_provider === "usdc" ? (
                        <>
                          {t("billing:via_usdc", {
                            network: cryptoNetworkLabel(pendingPayment.crypto_network),
                          })}{" "}, {t(`billing:interval_${pendingInterval}`)}
                        </>
                      ) : (
                        <>
                          {t("billing:via_card")}, {" "}
                          {t(`billing:interval_${pendingInterval}`)}
                        </>
                      )}
                    </span>
                    {pendingPayment.crypto_transaction_hash ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                        {t("billing:hash_submitted")}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="font-mono text-[11px] text-ink-500">
                    {t("billing:no_payment_created")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:w-56 lg:flex-col lg:items-stretch xl:w-64">
                <ResumeCheckoutButton
                  subscriptionId={pendingCheckout.id}
                  isPaymentFailed={pendingCheckout.status === "payment_failed"}
                />
                <PendingCheckoutControls
                  subscriptionId={pendingCheckout.id}
                  planName={
                    pendingCheckout.plan?.name ?? t("billing:this_plan")
                  }
                  interval={pendingInterval}
                  hasSubmittedCryptoTx={Boolean(
                    pendingPayment?.crypto_transaction_hash,
                  )}
                  paymentSummary={
                    pendingPayment
                      ? `${formatMoney(pendingPayment.amount, pendingPayment.currency)}, ${
                          pendingPayment.payment_provider === "usdc"
                            ? t("billing:via_usdc_short", {
                                network: cryptoNetworkLabel(
                                  pendingPayment.crypto_network,
                                ),
                              })
                            : t("billing:stripe")
                        }, ${t(`billing:interval_${pendingInterval}`)}`
                      : null
                  }
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
              className={`flex flex-col rounded-panel border p-5 ${
                isCurrent
                  ? "border-brand-500/30 bg-brand-500/[0.04]"
                  : "border-hairline bg-ink-900/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{p.name}</h3>
                {isCurrent ? (
                  <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
                    {t("billing:current")}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-white">
                  {monthly}
                </span>
                <span className="text-xs text-ink-400">
                  {t("billing:per_month")}
                </span>
                <span className="ml-2 font-mono text-xs text-ink-400">
                  {annual}/{t("billing:per_year")}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-400">
                {p.description?.trim() ? p.description : null}
              </p>
              <div className="mt-4">
                <Link
                  href={`/dashboard/billing/checkout?plan=${p.id}&billing=monthly`}
                  className={`btn btn-sm ${isCurrent ? "btn-ghost" : "btn-primary"}`}
                >
                  <span>
                    {t(
                      isCurrent
                        ? "billing:your_plan"
                        : "billing:choose_this_plan",
                    )}
                  </span>
                  <LinkArrow className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </section>

      {/* Assurance and Support Cards */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3.5 rounded-panel border border-hairline bg-ink-900/60 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-hairline bg-ink-850 text-signal-400">
            <IconShield className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold text-white">
              {t("billing:security_title")}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {t("billing:security_body")}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3.5 rounded-panel border border-hairline bg-ink-900/60 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-hairline bg-ink-850 text-brand-300">
            <IconCreditCard className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-bold text-white">
              {t("billing:support_title")}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {t("billing:support_body_before")}{" "}
              <a
                href="mailto:billing@baton.dev"
                className="font-medium text-brand-300 underline hover:text-brand-200"
              >
                billing@baton.dev
              </a>
              {t("billing:support_body_after")}
            </p>
          </div>
        </div>
      </section>

      {/* Payment & Invoice History Table */}
      <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-hairline bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {t("billing:history_title")}
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            {tc("billing:history_records", payments.length)}
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-xs text-ink-500">{t("billing:history_empty")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-1"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-white">
                      {p.plan?.name ?? t("billing:team_plan")}, {" "}
                      {t(`billing:payment_type_${p.payment_type}`)}
                    </p>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                    {formatDate(p.created_at)}, {" "}
                    {t(
                      p.payment_provider === "usdc"
                        ? "billing:usdc_network"
                        : "billing:credit_card_stripe",
                      p.payment_provider === "usdc"
                        ? { network: cryptoNetworkLabel(p.crypto_network) }
                        : undefined,
                    )}
                    {p.crypto_transaction_hash ? (
                      <span className="ml-1 inline-flex items-center gap-1">, {" "}
                        <a
                          href={`https://basescan.org/tx/${p.crypto_transaction_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-300 hover:text-brand-200 inline-flex items-center gap-0.5"
                        >
                          <span>{t("billing:basescan")}</span>
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
                    {paymentStatusLabel(p.status, t)}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">
                    {formatCurrency(p.amount, p.currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Subscription Lifecycle History */}
      {events.length > 0 ? (
        <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60 shadow-sm">
          <div className="border-b border-hairline bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {t("billing:lifecycle_log")}
            </span>
          </div>
          <ul className="divide-y divide-hairline">
            {events.slice(0, 8).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between px-5 py-3 text-xs"
              >
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-300">
                  {t(
                    `billing:event_${e.eventType}`,
                    e.newStatus
                      ? { status: subscriptionStatusLabel(e.newStatus, t) }
                      : undefined,
                  )}
                </span>
                {e.newStatus ? (
                  <span className="font-mono text-[11px] text-ink-400">
                    {t("billing:status_arrow")}{" "}
                    <span className="text-white font-semibold">
                      {subscriptionStatusLabel(e.newStatus, t)}
                    </span>
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
