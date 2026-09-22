import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { getPaymentById } from "@/lib/billing/payments";
import { friendlyPaymentFailure } from "@/lib/billing/errors";
import { IconCheckCircle, IconClock, IconAlertCircle, IconShield, IconArrowRight, IconExternalLink } from "@/components/icons";
import { PaymentResultClient } from "./payment-result";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Payment status: Baton",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string; sent?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard/billing");

  const params = searchParams ? await searchParams : undefined;
  const paymentId = params?.payment;
  if (!paymentId) redirect("/dashboard/billing");

  const payment = await getPaymentById(paymentId).catch(() => null);
  if (!payment || payment.user_id !== user.id) redirect("/dashboard/billing");

  const planName = payment.plan?.name ?? "Baton plan";
  const amountLabel = `${(payment.amount / 100).toFixed(2)} ${payment.currency}`;
  const txUrl = payment.crypto_transaction_hash
    ? `https://basescan.org/tx/${payment.crypto_transaction_hash}`
    : null;

  const header = (
    <div className="mb-8 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{planName}</h1>
      <p className="mt-1 text-xs text-ink-400">{amountLabel} · paid {formatDate(payment.paid_at ?? payment.created_at)}</p>
    </div>
  );

  if (payment.status === "confirmed") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="flex items-start gap-4 rounded-2xl border border-signal-500/30 bg-signal-500/[0.06] p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-signal-500/20 text-signal-400">
            <IconCheckCircle className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Payment confirmed</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
              Your {planName} plan is now active{payment.payment_provider === "usdc" ? " (verified on-chain)" : ""}.
              Your account has full access — go keep your pull requests moving.
            </p>
            {txUrl ? (
              <a href={txUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-300 hover:text-brand-200">
                View on Base <IconExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/dashboard" className="btn btn-primary btn-sm">
                Go to dashboard <IconArrowRight className="h-3 w-3" />
              </Link>
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
                View billing
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (payment.status === "failed" || payment.status === "rejected" || payment.status === "refunded") {
    const isRejected = payment.status === "rejected";
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="flex items-start gap-4 rounded-2xl border border-danger-500/30 bg-danger-500/[0.06] p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400">
            <IconAlertCircle className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">
              {payment.payment_provider === "usdc" ? "Payment not verified" : "Payment was not successful"}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
              {friendlyPaymentFailure(payment.failure_reason)}
            </p>
            {isRejected && payment.payment_provider === "usdc" ? (
              <p className="mt-3 rounded-lg bg-warn-500/10 px-3 py-2 text-[11px] leading-relaxed text-warn-200">
                Important: do not resend funds. If you believe this is a mistake, contact support with your
                transaction hash before sending anything else.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/pricing" className="btn btn-primary btn-sm">
                Choose another plan <IconArrowRight className="h-3 w-3" />
              </Link>
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
                View billing history
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (payment.status === "pending" && payment.payment_provider === "stripe") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="flex items-start gap-4 rounded-2xl border border-white/[0.1] bg-ink-900/60 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-ink-300">
            <IconClock className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Complete your card payment</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
              You were redirected back before finishing checkout with your card. Nothing has been charged and no
              subscription is active yet.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/dashboard/billing/checkout?plan=${payment.plan_id}`} className="btn btn-primary btn-sm">
                Return to checkout <IconArrowRight className="h-3 w-3" />
              </Link>
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">View billing</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (payment.status === "pending" && payment.payment_provider === "usdc") {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="flex items-start gap-4 rounded-2xl border border-white/[0.1] bg-ink-900/60 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-ink-300">
            <IconShield className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Send USDC to activate your plan</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
              You created a USDC order but haven&apos;t attached a transaction hash yet. Send{" "}
              <span className="font-mono font-bold text-white">{amountLabel}</span> to the receiving wallet below,
              then paste your transaction hash to begin verification.
            </p>
            <div className="mt-4 rounded-lg border border-white/[0.1] bg-ink-950 px-3.5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-ink-500">Receiving wallet ·{payment.crypto_network}</p>
              <code className="mt-1 block break-all font-mono text-xs text-white">{payment.crypto_wallet_address}</code>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/dashboard/billing/checkout?plan=${payment.plan_id}`} className="btn btn-primary btn-sm">
                Continue checkout <IconArrowRight className="h-3 w-3" />
              </Link>
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">View billing</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // pending_verification (USDC) — the live client verifies on-chain.
  return (
    <div className="mx-auto max-w-2xl">
      {header}
      <PaymentResultClient paymentId={payment.id} autoVerify />
    </div>
  );
}