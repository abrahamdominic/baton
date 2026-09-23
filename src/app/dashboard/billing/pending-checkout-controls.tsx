"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { cancelPendingCheckoutAction, type CancelCheckoutActionState } from "./actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconAlertCircle, IconShield } from "@/components/icons";

/**
 * Cancel-checkout action + confirmation dialog.
 *
 * The confirmation renders in the shared fixed-overlay ConfirmDialog (never an
 * in-flow popover), so it can neither be clipped by the pending-checkout card's
 * `overflow-hidden` nor pushed off the viewport. Cancellation only runs after
 * the user explicitly confirms; the server independently re-validates the
 * checkbox and ownership, so the backend state stays authoritative.
 */
export function PendingCheckoutControls({
  subscriptionId,
  hasSubmittedCryptoTx,
  planName,
  interval,
  paymentSummary,
}: {
  subscriptionId: string;
  hasSubmittedCryptoTx: boolean;
  planName: string;
  interval: string;
  paymentSummary?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState<CancelCheckoutActionState, FormData>(
    cancelPendingCheckoutAction,
    { ok: false },
  );

  // Success: close the dialog and let the server-rendered page show the new
  // (cancelled) subscription state. A cancelled checkout no longer blocks plan
  // switching because the row leaves the open/pending set entirely.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  useEffect(() => {
    if (!open) setConfirmed(false);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (pending) return;
          setConfirmed(false);
          setOpen(true);
        }}
        className="btn btn-ghost btn-sm w-full text-ink-400 hover:border-danger-500/40 hover:text-danger-300 sm:w-auto lg:w-full"
      >
        Cancel checkout
      </button>

      <ConfirmDialog open={open} onClose={() => setOpen(false)} tone="danger">
        <form
          action={formAction}
          onSubmit={() => {
            // Prevent a second submission while the first is in flight; the
            // server action is still guarded against duplicate cancels.
            if (pending) return;
          }}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-danger-500/25 bg-danger-500/10 text-danger-300">
              <IconAlertCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Cancel this checkout?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                Your <span className="font-semibold text-ink-200">{planName}</span>{" "}
                {interval === "annual" ? "annual" : "monthly"} checkout will be closed. Nothing is
                charged until you pay, and you can start a fresh checkout immediately after
                cancellation.
              </p>
            </div>
          </div>

          {paymentSummary ? (
            <p className="mt-3 rounded-lg border border-white/[0.08] bg-ink-950/50 px-3 py-2 font-mono text-[11px] text-ink-400">
              {paymentSummary}
            </p>
          ) : null}

          {hasSubmittedCryptoTx ? (
            <p className="mt-3 rounded-lg border border-warn-500/25 bg-warn-500/10 px-3 py-2 text-[11px] leading-relaxed text-warn-300">
              You submitted a USDC transaction hash for this checkout. Cancelling does not move
              on-chain funds; if your transfer already settled, contact billing@baton.dev.
            </p>
          ) : null}

          <input type="hidden" name="subscriptionId" value={subscriptionId} />

          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.1] bg-ink-950/50 px-3 py-2 text-xs text-ink-300">
            <input
              type="checkbox"
              name="confirm"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-danger-500"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I understand this cancels my pending checkout and I can start a new one after.
            </span>
          </label>

          {!state.ok && state.error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300"
            >
              {state.error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="btn btn-ghost btn-sm"
            >
              Keep checkout
            </button>
            <button
              type="submit"
              disabled={pending || !confirmed}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/15 px-3 py-1.5 text-xs font-semibold text-danger-200 transition-colors hover:bg-danger-500/25 focus-visible:ring-2 focus-visible:ring-danger-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Cancelling…" : "Confirm cancel checkout"}
            </button>
          </div>
        </form>
      </ConfirmDialog>
    </>
  );
}

/** Compact success banner shown after a successful cancellation. */
export function CheckoutCancelledBanner() {
  return (
    <p className="flex items-center gap-1.5 rounded-lg border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-xs font-medium text-signal-300">
      <IconShield className="h-3.5 w-3.5" />
      Checkout cancelled. You can start a new one anytime.
    </p>
  );
}