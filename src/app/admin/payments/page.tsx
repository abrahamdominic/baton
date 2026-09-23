import type { Metadata } from "next";
import Link from "next/link";
import { listPaymentsAdmin } from "@/lib/billing/payments";
import { runVerificationAction, manualDecisionAction } from "./actions";
import { PAYMENT_STATUSES, type PaymentStatus, type PaymentProvider } from "@/lib/billing/types";
import { IconArrowLeft, IconExternalLink, IconShield } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Payments: Baton Admin",
};

function statusTone(status: string): string {
  switch (status) {
    case "confirmed":
      return "border-signal-500/30 bg-signal-500/10 text-signal-300";
    case "pending":
    case "pending_verification":
      return "border-brand-500/30 bg-brand-500/10 text-brand-300";
    case "failed":
    case "rejected":
      return "border-danger-500/30 bg-danger-500/10 text-danger-300";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-ink-400";
  }
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; provider?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const status = (params?.status as PaymentStatus | undefined) ?? null;
  const provider = (params?.provider as PaymentProvider | undefined) ?? null;

  const payments = await listPaymentsAdmin({ status, provider, limit: 50 }).catch(() => []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Payment Transactions"
        description="Inspect credit card and on-chain cryptocurrency transactions. USDC orders require on-chain event verification on Base."
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
            href="/admin/payments"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !status
                ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            All Transactions
          </Link>
          {PAYMENT_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/payments?status=${s}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                status === s
                  ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                  : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {s.replace(/_/g, " ")}
            </Link>
          ))}
        </div>

        <span className="font-mono text-[11px] text-ink-500">
          Showing up to 50 latest transactions
        </span>
      </div>

      {/* Payments List */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {payments.length} Payments Recorded
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={IconShield}
              title="No payments match this filter"
              hint="Try clearing your status filter to view all payment records."
              action={
                status ? (
                  <Link href="/admin/payments" className="btn btn-ghost btn-sm">
                    Clear filter
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {payments.map((p) => (
              <li
                key={p.id}
                className="p-5 sm:p-6 transition-colors hover:bg-white/[0.015]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${statusTone(
                          p.status,
                        )}`}
                      >
                        {p.status.replace(/_/g, " ")}
                      </span>
                      <span className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase text-ink-400">
                        {p.payment_provider}
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums text-white">
                        ${(p.amount / 100).toFixed(2)} {p.currency}
                      </span>
                    </div>

                    <p className="mt-1 font-mono text-[11px] text-ink-400">
                      Payment ID: <span className="text-ink-200">{p.id}</span> &middot; User ID:{" "}
                      <span className="text-ink-200">{p.user_id}</span> &middot;{" "}
                      {new Date(p.created_at).toISOString()}
                    </p>

                    {p.crypto_transaction_hash ? (
                      <p className="mt-1.5 font-mono text-[11px] text-ink-400 break-all">
                        Tx Hash:{" "}
                        <a
                          href={`https://basescan.org/tx/${p.crypto_transaction_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
                        >
                          <span>{p.crypto_transaction_hash}</span>
                          <IconExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </p>
                    ) : (
                      <p className="mt-1 font-mono text-[11px] text-ink-500">
                        No on-chain transaction hash submitted yet
                      </p>
                    )}

                    {p.failure_reason ? (
                      <p className="mt-1 text-xs text-danger-300">
                        Failure reason: {p.failure_reason}
                      </p>
                    ) : null}
                  </div>

                  {/* Manual On-Chain Actions (USDC pending verification) */}
                  {p.status === "pending_verification" && p.payment_provider === "usdc" ? (
                    <div className="flex shrink-0 flex-col items-start lg:items-end gap-2 pt-1">
                      <form action={runVerificationAction}>
                        <input type="hidden" name="paymentId" value={p.id} />
                        <label className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
                          <input
                            type="checkbox"
                            name="confirm"
                            aria-label="Confirm on-chain verification"
                            className="h-3.5 w-3.5 accent-brand-500 rounded"
                          />
                          <span className="font-mono text-[11px]">confirm</span>
                          <button type="submit" className="btn btn-primary btn-sm h-7 text-xs ml-1">
                            Verify On-Chain Now
                          </button>
                        </label>
                      </form>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Manual Approve */}
                        <form action={manualDecisionAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="decision" value="confirmed" />
                          <label className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
                            <input
                              type="checkbox"
                              name="confirm"
                              aria-label="Confirm manual approval"
                              className="h-3.5 w-3.5 accent-brand-500 rounded"
                            />
                            <span className="font-mono text-[11px]">confirm</span>
                            <button
                              type="submit"
                              className="btn btn-ghost btn-sm h-7 text-xs text-signal-300 ml-1"
                            >
                              Force Approve
                            </button>
                          </label>
                        </form>

                        {/* Manual Reject */}
                        <form action={manualDecisionAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <label className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
                            <input
                              type="checkbox"
                              name="confirm"
                              aria-label="Confirm manual rejection"
                              className="h-3.5 w-3.5 accent-danger-500 rounded"
                            />
                            <span className="font-mono text-[11px]">confirm</span>
                            <button
                              type="submit"
                              className="btn btn-ghost btn-sm h-7 text-xs text-danger-300 hover:border-danger-500/40 ml-1"
                            >
                              Reject
                            </button>
                          </label>
                        </form>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}