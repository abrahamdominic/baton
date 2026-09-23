"use client";

import { useActionState } from "react";
import type { SubscriptionRecord, SubscriptionStatus } from "@/lib/billing/types";
import {
  overrideSubscriptionAction,
  changePlanAction,
  reactivateSubscriptionAction,
  markCanceledAction,
  type AdminSubscriptionActionResult,
} from "./actions";

const initial: AdminSubscriptionActionResult = { ok: false };

export function SubscriptionActions({
  subscription: sub,
  plans,
  targets,
  canPlanChange,
  canCancel,
}: {
  subscription: SubscriptionRecord;
  plans: { id: string; slug: string; name: string }[];
  targets: SubscriptionStatus[];
  canPlanChange: boolean;
  canCancel: boolean;
}) {
  return (
    <>
      {canPlanChange ? (
        <ChangePlanForm subscriptionId={sub.id} plans={plans} defaultPlanId={sub.plan?.id ?? plans[0]?.id ?? ""} />
      ) : null}
      {targets.includes("active") ? (
        <SelectActionForm
          id={`force-active-${sub.id}`}
          action={overrideSubscriptionAction}
          actionLabel="Force Active"
          tone="text-signal-300"
          confirmLabel="Confirm force active"
          hiddenFields={{ subscriptionId: sub.id, to: "active", reason: "admin override to active" }}
        />
      ) : null}
      {targets.includes("pending") ? (
        <SelectActionForm
          id={`reopen-${sub.id}`}
          action={overrideSubscriptionAction}
          actionLabel="Reopen Pending"
          confirmLabel="Confirm reopen"
          hiddenFields={{ subscriptionId: sub.id, to: "pending", reason: "admin reopens subscription for checkout" }}
        />
      ) : null}
      {targets.includes("active") && sub.cancel_at_period_end ? (
        <SelectActionForm
          id={`uncancel-${sub.id}`}
          action={reactivateSubscriptionAction}
          actionLabel="Un-cancel"
          tone="text-signal-300"
          confirmLabel="Confirm un-cancel"
          hiddenFields={{ subscriptionId: sub.id }}
        />
      ) : null}
      {canCancel ? (
        <SelectActionForm
          id={`cancel-${sub.id}`}
          action={markCanceledAction}
          actionLabel="Cancel"
          tone="text-danger-300 hover:border-danger-500/40"
          confirmLabel="Confirm cancellation"
          hiddenFields={{ subscriptionId: sub.id }}
        />
      ) : null}
    </>
  );
}

function Feedback({ state }: { state: AdminSubscriptionActionResult }) {
  if (state.error) {
    return (
      <span
        role="status"
        className="w-full max-w-xs break-words rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[10px] font-medium text-danger-300"
      >
        {state.error}
      </span>
    );
  }
  if (state.ok && state.detail) {
    return (
      <span
        role="status"
        className="w-full max-w-xs break-words rounded border border-signal-500/30 bg-signal-500/10 px-2 py-1 text-[10px] font-medium text-signal-300"
      >
        {state.detail}
      </span>
    );
  }
  return null;
}

function ChangePlanForm({
  subscriptionId,
  plans,
  defaultPlanId,
}: {
  subscriptionId: string;
  plans: { id: string; slug: string; name: string }[];
  defaultPlanId: string;
}) {
  const [state, action, pending] = useActionState(changePlanAction, initial);

  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="confirm"
            aria-label="Confirm plan change"
            className="h-3.5 w-3.5 accent-brand-500 rounded"
          />
          <span className="text-ink-400">Confirm</span>
        </label>
        <span className="text-ink-500">plan:</span>
        <select
          name="planId"
          defaultValue={defaultPlanId}
          className="rounded bg-ink-900 px-2 py-0.5 text-xs text-white outline-none border border-white/[0.1]"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm h-7 text-xs ml-1">
          Change Plan
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

function SelectActionForm({
  id,
  action,
  actionLabel,
  tone,
  confirmLabel,
  hiddenFields,
}: {
  id: string;
  action: (
    prev: AdminSubscriptionActionResult,
    formData: FormData,
  ) => Promise<AdminSubscriptionActionResult>;
  actionLabel: string;
  tone?: string;
  confirmLabel: string;
  hiddenFields: Record<string, string>;
}) {
  const [state, submit, pending] = useActionState(action, initial);

  return (
    <form action={submit} className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
        {Object.entries(hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor={id} className="flex items-center gap-1.5">
          <input
            id={id}
            type="checkbox"
            name="confirm"
            aria-label={confirmLabel}
            className="h-3.5 w-3.5 accent-brand-500 rounded"
          />
        </label>
        <button type="submit" disabled={pending} className={`btn btn-ghost btn-sm h-7 text-xs ${tone ?? ""}`}>
          {actionLabel}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}