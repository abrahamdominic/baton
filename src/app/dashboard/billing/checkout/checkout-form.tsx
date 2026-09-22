"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { IconArrowRight, IconCopy, IconShield, IconAlertCircle, IconCreditCard, IconCoins } from "@/components/icons";

interface CheckoutFormProps {
  plan: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    priceCustom: boolean;
  };
  interval: "monthly" | "annual";
  amountMinor: number;
  planFeatures: unknown;
  providers: { stripe: boolean; usdc: boolean };
  usdcWalletAddress: string | null;
  alreadySubscribed: boolean;
  canRenewUsdc: boolean;
}

type Step = "choose" | "usdc_order" | "usdc_pending";

type CheckoutState = "idle" | "creating" | "error" | "submitting_tx";

interface UsdcOrder {
  paymentId: string;
  amountMinor: number;
  walletAddress: string;
  network: string;
  token: string;
  renewal?: boolean;
}

export function CheckoutForm(props: CheckoutFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(props.providers.usdc && !props.providers.stripe ? "usdc_order" : "choose");
  const [state, setState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<UsdcOrder | null>(null);
  const [txHash, setTxHash] = useState("");
  const [copied, setCopied] = useState(false);

  if (props.alreadySubscribed) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-signal-500/25 bg-signal-500/[0.05] px-5 py-4 text-xs text-signal-300">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
        <div>
          You already have access to {props.plan.name}.{" "}
          <Link href="/dashboard/billing" className="font-medium text-brand-300 hover:text-brand-200">
            View your billing
          </Link>{" "}
          instead.
        </div>
      </div>
    );
  }

  if (props.canRenewUsdc) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-brand-500/25 bg-brand-500/[0.06] px-5 py-4 text-xs text-ink-300">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
        <div>
          Your USDC plan doesn&apos;t auto-renew. Pay again below to extend your{" "}
          {props.plan.name} subscription without losing access.
        </div>
      </div>
    );
  }

  async function startStripe() {
    setState("creating");
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: props.plan.id, billing: props.interval, provider: "stripe" }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) {
      setState("error");
      setError(body.error ?? "Something went wrong. Please try again or contact support.");
      return;
    }
    setState("idle");
    window.location.assign(body.url);
  }

  async function startUsdc() {
    setState("creating");
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: props.plan.id, billing: props.interval, provider: "usdc" }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<UsdcOrder> & { error?: string };
    if (!res.ok || !body.paymentId) {
      setState("error");
      setError(body.error ?? "Something went wrong. Please try again or contact support.");
      return;
    }
    setOrder({
      paymentId: body.paymentId,
      amountMinor: body.amountMinor ?? 0,
      walletAddress: body.walletAddress ?? props.usdcWalletAddress ?? "",
      network: body.network ?? "base",
      token: body.token ?? "USDC",
      renewal: Boolean(body.renewal),
    });
    setState("idle");
    setStep("usdc_order");
  }

  async function submitTxHash() {
    if (!order || txHash.trim().length === 0) return;
    setState("submitting_tx");
    setError(null);
    const res = await fetch("/api/billing/usdc/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: order.paymentId, transactionHash: txHash.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setState("error");
      setError(body.error ?? "We could not record that transaction. Check the hash and try again.");
      return;
    }
    router.push(`/dashboard/billing/result?payment=${order.paymentId}&sent=1`);
  }

  async function copyWallet() {
    if (!order) return;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(order.walletAddress);
    else {
      const el = document.createElement("textarea");
      el.value = order.walletAddress;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const priceLabel =
    props.plan.priceCustom || props.amountMinor <= 0
      ? "Custom"
      : `$${(props.amountMinor / 100).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* Order summary */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/60">
        <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
            Order summary
          </span>
        </div>
        <div className="space-y-3 px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">{props.plan.name}</span>
            <span className="font-mono text-sm font-extrabold tabular-nums text-white">
              {priceLabel}
              <span className="ml-1 text-[11px] font-medium text-ink-400">
                /{props.interval === "annual" ? "year" : "month"}
              </span>
            </span>
          </div>
          {props.plan.description ? (
            <p className="text-xs leading-relaxed text-ink-400">{props.plan.description}</p>
          ) : null}
          {props.interval === "annual" ? (
            <p className="font-mono text-[11px] text-brand-300">Billed annually.</p>
          ) : (
            <p className="font-mono text-[11px] text-ink-500">Billed monthly. Cancel anytime.</p>
          )}
          {props.plan.priceCustom ? (
            <div className="flex items-start gap-2 rounded-lg bg-warn-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-warn-200">
              <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This plan is custom-priced. Self-serve checkout is not available — email
              sales@baton.dev to get started.
            </div>
          ) : null}
        </div>
      </section>

      {step === "choose" ? (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {props.providers.stripe ? (
              <button
                type="button"
                onClick={startStripe}
                disabled={state === "creating" || props.plan.priceCustom}
                className="btn btn-primary btn-lg justify-center"
              >
                <IconCreditCard className="h-4 w-4" />
                <span>{state === "creating" ? "Processing..." : "Pay with Credit Card"}</span>
              </button>
            ) : null}
            {props.providers.usdc ? (
              <button
                type="button"
                onClick={startUsdc}
                disabled={state === "creating" || props.plan.priceCustom}
                className="btn btn-ghost btn-lg justify-center"
              >
                <IconCoins className="h-4 w-4 text-brand-300" />
                <span>{state === "creating" ? "Generating Order..." : "Pay with USDC on Base"}</span>
              </button>
            ) : null}
          </div>
          {(props.providers.stripe || props.providers.usdc ? null : (
            <p className="text-center text-xs text-ink-500">
              Checkout is temporarily unavailable. Contact support or try again shortly.
            </p>
          ))}
          <p className="text-center text-[11px] text-ink-500">
            Powered by Stripe Checkout and verified on-chain USDC. Cancel anytime.
          </p>
        </section>
      ) : null}

      {step === "usdc_order" && order ? (
        <section data-testid="usdc-order" className="overflow-hidden rounded-2xl border border-brand-500/25 bg-ink-900/60">
          <div className="border-b border-brand-500/20 bg-brand-500/[0.06] px-6 py-3.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              {order.renewal ? "Send USDC to extend your plan" : "Send USDC to activate your plan"}
            </span>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-ink-400">Exact amount to send</span>
              <span className="font-mono text-xl font-extrabold tabular-nums text-white">
                {order.amountMinor > 0 ? `${(order.amountMinor / 100).toFixed(2)} USDC` : "—"}
              </span>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                <IconShield className="h-3 w-3 text-signal-400" />
                Send to this {order.network} address (receiving wallet)
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-ink-950 px-3 py-2.5">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-white">{order.walletAddress}</code>
                <button
                  type="button"
                  onClick={copyWallet}
                  className="btn btn-ghost btn-sm shrink-0"
                  aria-label="Copy receiving wallet address"
                >
                  <IconCopy className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-400">
              <li>· Network must be {order.network} (mainnet); sending from another chain will lose funds.</li>
              <li>· Send the exact {order.token} amount shown — mismatches are rejected.</li>
              <li>· Confirm in your wallet, then paste the transaction hash below to mark it for verification.</li>
            </ul>

            <div>
              <label htmlFor="usdc-tx-hash" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Transaction hash (0x…)
              </label>
              <input
                id="usdc-tx-hash"
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x"
                spellCheck={false}
                className="input w-full font-mono"
              />
            </div>

            <button
              type="button"
              onClick={submitTxHash}
              disabled={state === "submitting_tx" || txHash.trim().length < 10}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              {state === "submitting_tx" ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Recording…
                </span>
              ) : (
                <>
                  I&apos;ve sent it — verify
                  <IconArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep("choose")}
              disabled={state === "submitting_tx"}
              className="w-full text-center text-[11px] font-medium text-ink-400 transition-colors hover:text-white"
            >
              ← Back to payment options
            </button>
          </div>
        </section>
      ) : null}

      {state === "error" && error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger-500/30 bg-danger-500/[0.06] px-4 py-3 text-xs text-danger-200" role="alert">
          <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {props.providers.usdc && props.usdcWalletAddress ? (
        <p className="text-center text-[11px] text-ink-500">
          Prefer to skip checkout? Send USDC directly and open a{" "}
          <Link href="/dashboard/billing" className="text-brand-300 hover:text-brand-200">
            support ticket
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}