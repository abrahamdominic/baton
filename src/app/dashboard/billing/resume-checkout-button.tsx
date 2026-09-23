"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resumeCheckoutAction, type ResumeCheckoutResult } from "./actions";
import { IconArrowRight, IconRefresh } from "@/components/icons";

/**
 * Deliberate primary action for continuing a pending checkout. Calls a server
 * action that revives the ORIGINAL Stripe Checkout Session when it is still
 * open (no duplicate, no re-pay), routes USDC orders to the payment page, and
 * only falls back to a fresh session (same pending subscription) when needed.
 */
export function ResumeCheckoutButton({
  subscriptionId,
  isPaymentFailed,
}: {
  subscriptionId: string;
  isPaymentFailed: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  async function handleClick() {
    if (resolving) return;
    setResolving(true);
    setError(null);
    const result: ResumeCheckoutResult = await resumeCheckoutAction(subscriptionId);
    if (result.ok && result.url) {
      router.push(result.url);
      return;
    }
    setError(result.error ?? "Could not resume this checkout. Try again.");
    setResolving(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={resolving}
        className="btn btn-primary btn-sm"
      >
        {resolving ? (
          <IconRefresh className="h-3 w-3" />
        ) : (
          <span>{isPaymentFailed ? "Retry payment" : "Continue payment"}</span>
        )}
        <IconArrowRight className="h-3 w-3" />
      </button>
      {error ? <p className="text-[11px] text-danger-300">{error}</p> : null}
    </div>
  );
}