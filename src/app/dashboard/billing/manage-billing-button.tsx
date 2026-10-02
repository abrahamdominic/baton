"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { IconCreditCard, IconExternalLink } from "@/components/icons";

/**
 * Open Stripe's Billing Portal for the signed-in customer.
 *
 * Plan changes, card updates, cancellations and invoice downloads all happen on
 * Stripe's side, so this is the one control that routes a customer there. It
 * navigates with `window.location.assign` rather than `router.push` because the
 * destination is a full-page redirect to a third-party origin with its own
 * checkout flow; a client-side transition would leave the billing page mounted
 * underneath and back-stack into it on return.
 *
 * The portal itself decides the return URL (validated server-side against the
 * app origin), which is why this sends the current billing path rather than
 * inventing one.
 */
export function ManageBillingButton({
  returnPath,
  label,
  variant = "ghost",
  className,
}: {
  returnPath?: string;
  label?: string;
  variant?: "ghost" | "primary";
  className?: string;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnUrl: returnPath ?? window.location.href }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(body.error ?? t("billing:portal_unavailable"));
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError(t("billing:portal_unavailable"));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <button
        type="button"
        onClick={openPortal}
        disabled={pending}
        className={
          className ??
          `btn btn-sm ${variant === "primary" ? "btn-primary" : "btn-ghost"}`
        }
      >
        <span>{pending ? t("billing:portal_opening") : (label ?? t("billing:manage_billing"))}</span>
        {pending ? (
          <IconCreditCard className="h-3 w-3" />
        ) : (
          <IconExternalLink className="h-3 w-3" />
        )}
      </button>
      {error ? (
        <p className="text-[11px] text-danger-300">{error}</p>
      ) : null}
    </div>
  );
}
