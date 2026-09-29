"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { IconRefresh, IconCheckCircle, IconAlertCircle, IconClock } from "@/components/icons";
import { useTranslation } from "@/lib/i18n/provider";
import type { Translator } from "@/lib/i18n/translate";

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

function copyFor(result: VerifyResponse | null, t: Translator): Copy | null {
  if (!result) return null;
  if (result.ok && (result.status === "confirmed" || result.code === "verified" || result.code === "already_confirmed")) {
    return { tone: "good", title: t("billing:verify_ok_title"), body: t("billing:verify_ok_body") };
  }
  if (result.code === "rpc_unavailable") {
    return { tone: "warn", title: t("billing:verify_rpc_title"), body: t("billing:verify_rpc_body") };
  }
  if (result.code === "not_mined") {
    return { tone: "warn", title: t("billing:verify_not_mined_title"), body: t("billing:verify_not_mined_body") };
  }
  if (result.code === "insufficient_finality") {
    return { tone: "warn", title: t("billing:verify_finality_title"), body: t("billing:verify_finality_body") };
  }
  if (result.code === "already_confirmed") {
    return {
      tone: "good",
      title: t("billing:verify_ok_title"),
      body: t("billing:verify_already_body"),
    };
  }
  // All remaining codes are hard failures (amount/token/recipient/network/dup).
  return {
    tone: "bad",
    title: t("billing:verify_bad_title"),
    body: t("billing:verify_bad_body"),
    extra: t("billing:verify_bad_extra"),
  };
}

export function PaymentResultClient({ paymentId, autoVerify = true }: PaymentResultClientProps) {
  const { t } = useTranslation();
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
        setView({ status: "error", message: body.error ?? t("billing:verify_error_generic") });
        return;
      }
      setResult(body);
      setView({ status: "done" });
    } catch {
      setView({ status: "error", message: t("billing:verify_error_network") });
    }
  }, [paymentId, t]);

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
          <h2 className="text-lg font-bold text-white">{t("billing:verifying_title")}</h2>
          <p className="mt-1 text-xs text-ink-400">{t("billing:verifying_body")}</p>
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
          <h2 className="text-lg font-bold text-white">{t("billing:verify_failed_title")}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{view.message}</p>
          <div className="mt-4">
            <button type="button" onClick={verify} className="btn btn-ghost btn-sm">
              <IconRefresh className="h-3.5 w-3.5" /> {t("billing:check_again")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const copy = copyFor(result, t);
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
          <h2 className="text-lg font-bold text-white">{copy?.title ?? t("billing:status_generic")}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{copy?.body}</p>
          {copy?.extra ? (
            <p className="mt-3 rounded-lg bg-warn-500/10 px-3 py-2 text-[11px] leading-relaxed text-warn-200">
              {copy.extra}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={verify} className="btn btn-ghost btn-sm">
              <IconRefresh className="h-3.5 w-3.5" /> {t("billing:check_again")}
            </button>
            {copy?.tone === "good" ? (
              <>
                <Link href="/dashboard" className="btn btn-primary btn-sm">
                  {t("billing:go_to_dashboard")}
                </Link>
                <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
                  {t("billing:view_billing")}
                </Link>
              </>
            ) : (
              <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
                {t("billing:view_billing_history")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}