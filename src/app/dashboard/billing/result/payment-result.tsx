"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { IconRefresh, IconCheckCircle, IconAlertCircle, IconClock } from "@/components/icons";

interface PaymentResultClientProps {
  paymentId: string;
  autoVerify?: boolean;
}

interface VerifyResponse {
  ok: boolean;
  code: string;
  status: string;
  detail?: string | null;
}

type ViewState =
  | { status: "verifying" }
  | { status: "done" }
  | { status: "error"; message: string };

interface Copy {
  tone: "good" | "warn" | "bad";
  title: string;
  body: string;
  extra?: string;
}

function copyFor(result: VerifyResponse | null): Copy | null {
  if (!result) return null;
  if (result.ok && (result.status === "confirmed" || result.code === "verified" || result.code === "already_confirmed")) {
    return {
      tone: "good",
      title: "Payment confirmed",
      body: "Your payment was verified on-chain and your plan is now active. Head to the dashboard to start using Baton.",
    };
  }
  if (result.code === "rpc_unavailable") {
    return {
      tone: "warn",
      title: "We couldn’t reach the chain just yet",
      body: "Your transaction wasn’t tampered with. Our verifier just couldn’t reach a Base node in time. Tap “Check again” in a minute; no action is needed from you.",
    };
  }
  if (result.code === "not_mined") {
    return {
      tone: "warn",
      title: "Your transaction hasn’t hit the chain yet",
      body: "Base may still be propagating the transfer. Refresh in about a minute and we’ll re-check automatically.",
    };
  }
  if (result.code === "insufficient_finality") {
    return {
      tone: "warn",
      title: "Almost there: finality pending",
      body: "Your transaction is confirmed on Base but still needs a few more blocks. This is settled automatically; check again shortly.",
    };
  }
  if (result.code === "already_confirmed") {
    return {
      tone: "good",
      title: "Payment confirmed",
      body: "This payment was already verified. Everything is in order.",
    };
  }
  // All remaining codes are hard failures (amount/token/recipient/network/dup).
  return {
    tone: "bad",
    title: "Payment could not be verified",
    body: "The transaction doesn’t match this order (amount, token, recipient or network).",
    extra: "Do not resend funds. Contact support with your transaction hash before sending anything else.",
  };
}

export function PaymentResultClient({ paymentId, autoVerify = true }: PaymentResultClientProps) {
  const [view, setView] = useState<ViewState>(autoVerify ? { status: "verifying" } : { status: "done" });
  const [result, setResult] = useState<VerifyResponse | null>(null);

  const verify = useCallback(async () => {
    setView({ status: "verifying" });
    try {
      const res = await fetch("/api/billing/usdc/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const body = (await res.json().catch(() => ({}))) as VerifyResponse & { error?: string };
      if (!res.ok) {
        setView({ status: "error", message: body.error ?? "Could not check your payment right now." });
        return;
      }
      setResult(body);
      setView({ status: "done" });
    } catch {
      setView({ status: "error", message: "Could not check your payment right now. Check your connection and retry." });
    }
  }, [paymentId]);

  useEffect(() => {
    if (autoVerify) void verify();
  }, [autoVerify, verify]);

  if (view.status === "verifying") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.1] bg-ink-900/60 p-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/15 text-brand-300">
          <IconRefresh className="h-6 w-6 animate-spin" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-white">Verifying your payment on Base…</h2>
          <p className="mt-1 text-xs text-ink-400">
            We’re reading the chain to confirm your USDC transfer. This usually takes a few seconds.
          </p>
        </div>
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div className="flex items-start gap-4 rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warn-500/20 text-warn-300">
          <IconClock className="h-6 w-6" />
        </span>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">We couldn’t verify right now</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{view.message}</p>
          <div className="mt-4">
            <button type="button" onClick={verify} className="btn btn-ghost btn-sm">
              <IconRefresh className="h-3.5 w-3.5" /> Check again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const copy = copyFor(result);
  return (
    <div>
      <div
        className={`flex items-start gap-4 rounded-2xl border p-6 ${
          copy?.tone === "good"
            ? "border-signal-500/30 bg-signal-500/[0.06]"
            : copy?.tone === "warn"
              ? "border-warn-500/30 bg-warn-500/[0.06]"
              : "border-danger-500/30 bg-danger-500/[0.06]"
        }`}
      >
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            copy?.tone === "good"
              ? "bg-signal-500/20 text-signal-400"
              : copy?.tone === "warn"
                ? "bg-warn-500/20 text-warn-300"
                : "bg-danger-500/20 text-danger-400"
          }`}
        >
          {copy?.tone === "good" ? (
            <IconCheckCircle className="h-6 w-6" />
          ) : copy?.tone === "warn" ? (
            <IconClock className="h-6 w-6" />
          ) : (
            <IconAlertCircle className="h-6 w-6" />
          )}
        </span>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">{copy?.title ?? "Status"}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{copy?.body}</p>
          {copy?.extra ? (
            <p className="mt-3 rounded-lg bg-warn-500/10 px-3 py-2 text-[11px] leading-relaxed text-warn-200">
              {copy.extra}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={verify} className="btn btn-ghost btn-sm">
              <IconRefresh className="h-3.5 w-3.5" /> Check again
            </button>
            {copy?.tone === "good" ? (
              <>
                <Link href="/dashboard" className="btn btn-primary btn-sm">Go to dashboard</Link>
                <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">View billing</Link>
              </>
            ) : (
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">View billing history</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}