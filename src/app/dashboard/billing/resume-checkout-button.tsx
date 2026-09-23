"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resumeCheckoutAction, type ResumeCheckoutResult } from "./actions";
import { IconArrowRight, IconRefresh } from "@/components/icons";

/**
 * Primary action for continuing a pending checkout. Calls a server action that
 * routes via server-authoritative state: it revives the ORIGINAL Stripe
 * Checkout Session when it is still open (no duplicate, no re-pay), routes USDC
 * orders awaiting verification to the result page, and otherwise re-enters
 * checkout against the SAME pending subscription row.
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
  const invoked = useRef(false);

  async function handleClick() {
    if (resolving || invoked.current) return;
    invoked.current = true;
    setResolving(true);
    setError(null);
    try {
      const result: ResumeCheckoutResult = await resumeCheckoutAction(subscriptionId);
      if (result.ok && result.url) {
        router.push(result.url);
        return;
      }
      setError(result.error ?? "Could not resume this checkout. Try again.");
    } finally {
      // Only clear the guard when we did NOT leave the page (a client-side
      // router.push swaps context; on failure we must allow a retry).
      setResolving(false);
      window.setTimeout(() => {
        invoked.current = false;
      }, 0);
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto lg:w-full">
      <button
        type="button"
        onClick={handleClick}
        disabled={resolving}
        aria-busy={resolving}
        className="btn btn-primary btn-sm w-full justify-center"
      >
        {resolving ? (
          <IconRefresh className="h-3 w-3 animate-spin" aria-hidden />
        ) : null}
        <span>{resolving ? "Preparing…" : isPaymentFailed ? "Retry payment" : "Continue payment"}</span>
        {!resolving ? <IconArrowRight className="h-3 w-3" aria-hidden /> : null}
      </button>
      {error ? (
        <p role="alert" className="text-[11px] leading-snug text-danger-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}