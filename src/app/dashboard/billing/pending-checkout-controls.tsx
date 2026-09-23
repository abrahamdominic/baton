"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { cancelPendingCheckoutAction, type CancelCheckoutActionState } from "./actions";
import { IconAlertCircle, IconShield } from "@/components/icons";

export function PendingCheckoutControls({
  subscriptionId,
  hasSubmittedCryptoTx,
  planName,
}: {
  subscriptionId: string;
  hasSubmittedCryptoTx: boolean;
  planName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CancelCheckoutActionState, FormData>(
    cancelPendingCheckoutAction,
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  if (state.ok) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-xs font-medium text-signal-300">
        <IconShield className="h-3.5 w-3.5" />
        Checkout cancelled. You can start a new one anytime.
      </p>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost btn-sm text-ink-400 hover:border-danger-500/40 hover:text-danger-300"
      >
        Cancel checkout
      </button>

      {open ? (
        <form
          action={formAction}
          className="absolute right-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-white/[0.1] bg-ink-900 p-4 shadow-2xl"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-danger-500/25 bg-danger-500/10 text-danger-300">
              <IconAlertCircle className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Cancel this checkout?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                Your <span className="font-semibold text-ink-200">{planName}</span> checkout will be
                closed and you will be able to start a fresh one immediately.
              </p>
            </div>
          </div>

          {hasSubmittedCryptoTx ? (
            <p className="rounded-lg border border-warn-500/25 bg-warn-500/10 px-3 py-2 text-[11px] leading-relaxed text-warn-300">
              You submitted a USDC transaction hash for this checkout. Cancelling does not move
              on-chain funds; if your transfer already settled, contact billing@baton.dev.
            </p>
          ) : null}

          <input type="hidden" name="subscriptionId" value={subscriptionId} />

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.1] bg-ink-950/50 px-3 py-2 text-xs text-ink-300">
            <input
              type="checkbox"
              name="confirm"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-danger-500"
              defaultChecked={false}
              onChange={(e) => {
                // The server enforces this anyway; re-render lets us disable the button.
                const submit = (e.target.closest("form") as HTMLFormElement | null)?.querySelector(
                  'button[type="submit"]',
                ) as HTMLButtonElement | null;
                if (submit) submit.disabled = !e.target.checked;
              }}
            />
            <span>I understand this cancels my pending checkout.</span>
          </label>

          {!state.ok && state.error ? (
            <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
              Keep checkout
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center justify-center rounded-lg border border-danger-500/40 bg-danger-500/15 px-3 py-1.5 text-xs font-semibold text-danger-300 transition-colors hover:bg-danger-500/25 focus-visible:ring-2 focus-visible:ring-danger-400"
            >
              {pending ? "Cancelling…" : "Cancel checkout"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}