import type { Metadata } from "next";
import Link from "next/link";
import { listAllSubscriptions } from "@/lib/billing/subscriptions";
import { listPlans } from "@/lib/billing/plans";
import { listPaymentsForSubscription } from "@/lib/billing/payments";
import { prisma } from "@/lib/db";
import { adminTargets } from "@/lib/billing/subscription-machine";
import type { SubscriptionRecord } from "@/lib/billing/types";
import { SubscriptionActions } from "./subscription-actions";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/lib/billing/types";
import { IconArrowLeft, IconLayers } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Subscriptions: Baton Admin",
};

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "active_until_period_end":
      return "border-signal-500/30 bg-signal-500/10 text-signal-300";
    case "pending":
      return "border-brand-500/30 bg-brand-500/10 text-brand-300";
    case "past_due":
    case "payment_failed":
      return "border-danger-500/30 bg-danger-500/10 text-danger-300";
    case "canceled":
    case "expired":
      return "border-white/[0.08] bg-white/[0.04] text-ink-400";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-ink-300";
  }
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; user?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const filterStatus = (params?.status as SubscriptionStatus | undefined) ?? null;
  const filterUser = params?.user ?? null;

  const plans = await listPlans().catch(() => []);
  let subscriptions = await listAllSubscriptions(100).catch(() => []);
  if (filterStatus) subscriptions = subscriptions.filter((s) => s.status === filterStatus);
  if (filterUser) subscriptions = subscriptions.filter((s) => s.user_id.includes(filterUser));
  const users = await prisma.user.findMany({
    where: { id: { in: subscriptions.map((subscription) => subscription.user_id) } },
    select: { id: true, login: true, name: true, email: true, avatarUrl: true },
  }).catch(() => []);
  const usersById = new Map(users.map((user) => [user.id, user]));

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Subscription Records"
        description="Lifecycle state machine and entitlement overrides. All administrative modifications are audited to the security log."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/admin/subscriptions"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !filterStatus
                ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            All Subscriptions
          </Link>
          {SUBSCRIPTION_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/subscriptions?status=${s}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === s
                  ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                  : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {s.replace(/_/g, " ")}
            </Link>
          ))}
        </div>

        <span className="font-mono text-[11px] text-ink-500">
          Showing newest records
        </span>
      </div>

      {/* Subscription List */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {subscriptions.length} Subscriptions on record
          </span>
        </div>

        {subscriptions.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={IconLayers}
              title="No subscriptions match this filter"
              hint="Try clearing your status filter to view all subscriptions on record."
              action={
                filterStatus ? (
                  <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
                    Clear filter
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {subscriptions.map((s) => (
              <SubscriptionRow key={s.id} subscription={s} plans={plans} user={usersById.get(s.user_id) ?? null} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface RowProps {
  subscription: SubscriptionRecord;
  plans: { id: string; slug: string; name: string }[];
  user: { id: string; login: string; name: string | null; email: string | null; avatarUrl: string | null } | null;
}

async function SubscriptionRow({ subscription: sub, plans, user }: RowProps) {
  const payments = await listPaymentsForSubscription(sub.id, 3).catch(() => []);
  const targets = adminTargets(sub.status);
  const canPlanChange = targets.includes("active");
  const canCancel = targets.includes("canceled");

  return (
    <li className="p-5 sm:p-6 transition-colors hover:bg-white/[0.015]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        {/* Subscription Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                sub.status,
              )}`}
            >
              {sub.status.replace(/_/g, " ")}
            </span>
            <span className="text-base font-bold text-white">
              {sub.plan?.name ?? sub.plan_id.slice(0, 8)}
            </span>
            <span className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase text-ink-400">
              {sub.payment_provider ?? "manual"}
            </span>
          </div>

          <div className="mt-2 flex min-w-0 items-center gap-2.5 text-xs text-ink-300">
            {user?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full ring-1 ring-white/10" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink-100">{user?.name ?? user?.login ?? "Unknown user"}</p>
              <p className="truncate font-mono text-[11px] text-ink-400">
                {user ? `@${user.login}${user.email ? ` · ${user.email}` : ""}` : `User ID: ${sub.user_id}`}
              </p>
            </div>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-500">
            Started: {sub.started_at?.slice(0, 10) ?? new Date(sub.created_at).toISOString().slice(0, 10)}
            {" · "}Subscription ID: <span className="text-ink-400">{sub.id}</span>
          </p>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-400">
            {sub.current_period_start ? (
              <span>
                Period: {sub.current_period_start.slice(0, 10)} &rarr; {sub.current_period_end?.slice(0, 10)}
              </span>
            ) : null}
            {sub.cancel_at_period_end ? (
              <span className="text-warn-300 font-semibold">(Cancels at period end)</span>
            ) : null}
            {sub.provider_subscription_id ? (
              <span>Provider ID: {sub.provider_subscription_id}</span>
            ) : null}
          </div>

          {/* Associated Recent Payments */}
          {payments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="font-mono text-[10px] uppercase text-ink-500 self-center">Payments:</span>
              {payments.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 rounded border border-white/[0.06] bg-ink-950/60 px-2 py-0.5 font-mono text-[10px] text-ink-300"
                >
                  <span className="uppercase text-ink-500">{p.payment_provider}</span>
                  <span>${(p.amount / 100).toFixed(2)}</span>
                  <span className="capitalize text-ink-500">{(p.metadata as { interval?: string } | null)?.interval ?? "—"}</span>
                  <span className="text-ink-500">({p.status.replace("_", " ")})</span>
                  {p.crypto_transaction_hash ? (
                    <a
                      href={`https://basescan.org/tx/${p.crypto_transaction_hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-300 hover:text-brand-200"
                    >
                      tx &rarr;
                    </a>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Administrative Override Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1 lg:pt-0">
          <SubscriptionActions
            subscription={sub}
            plans={plans}
            targets={targets}
            canPlanChange={canPlanChange}
            canCancel={canCancel}
          />
        </div>
      </div>
    </li>
  );
}
