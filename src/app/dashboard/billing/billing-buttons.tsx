"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelCurrentSubscriptionAction,
  reactivateCurrentSubscriptionAction,
  type BillingActionState,
} from "./actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconAlertCircle, IconArrowRight, IconRefresh, IconShield } from "@/components/icons";

function formatDate(iso: string | null): string {
  if (!iso) return "the end of your current billing period";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
}

export function CancelPlanButton({
  subscriptionId,
  planName,
  periodEnd,
}: {
  subscriptionId: string;
  planName: string;
  periodEnd: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(
    cancelCurrentSubscriptionAction,
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm text-ink-400 hover:border-danger-500/40 hover:text-danger-300"
      >
        Cancel plan
      </button>

      {open ? (
        <ConfirmDialog open onClose={() => setOpen(false)} tone="danger">
          <form action={formAction}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-danger-500/25 bg-danger-500/10 text-danger-300">
                <IconAlertCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Cancel your {planName} plan?</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">
                  Your Team access continues in full until{" "}
                  <span className="font-semibold text-ink-200">{formatDate(periodEnd)}</span>. After
                  that date your account returns to the Individual Free tier — you can cancel the
                  cancellation anytime before then.
                </p>
              </div>
            </div>

            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <input type="hidden" name="confirm" value="on" />

            {state.error ? (
              <p className="mt-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300">
                {state.error}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
                Keep my plan
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/15 px-3 py-1.5 text-xs font-semibold text-danger-200 transition-colors hover:bg-danger-500/25 focus-visible:ring-2 focus-visible:ring-danger-400 disabled:opacity-60"
              >
                {pending ? "Cancelling…" : "Confirm cancellation"}
              </button>
            </div>
          </form>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function ReactivateButton({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(
    reactivateCurrentSubscriptionAction,
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
        {pending ? (
          <IconRefresh className="h-3 w-3" />
        ) : (
          <IconShield className="h-3 w-3" />
        )}
        <span>Reactivate plan</span>
        <IconArrowRight className="h-3 w-3" />
      </button>
      {state.error ? (
        <p className="mt-2 max-w-60 text-right text-[11px] text-danger-300">{state.error}</p>
      ) : null}
    </form>
  );
}