"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { requeueJobAction, type QueueActionResult } from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      data-autofocus
      className="btn btn-primary btn-sm disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Requeue a dead-lettered job from the admin health console.
 *
 * Dead-lettering is terminal by design, so the only way to recover work that
 * failed for a now-resolved reason is an explicit operator action. That action
 * spends a connected installation's GitHub API quota and, for PR jobs, posts a
 * comment on a real pull request, so it is gated behind a confirmation dialog
 * rather than being a single click.
 *
 * The form lives here rather than in the page because the action is bound
 * through `useActionState`: a server action with a bound previous state cannot
 * be passed to a plain `<form action=…>` in a server component.
 */
export function RequeueButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<QueueActionResult, FormData>(requeueJobAction, {
    ok: false,
  });

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
        className="btn btn-ghost btn-sm h-6 text-[10px]"
      >
        {state.detail ?? "Requeue"}
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="warn"
        label="Requeue dead-lettered job"
      >
        <form action={action} className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Requeue this job?</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              The attempt counter is reset and the job becomes runnable again on the next
              drain. For pull-request jobs this re-runs the GitHub API calls and may post
              another status comment, spending the installation&rsquo;s API quota.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              If the cause has not been fixed, the job will exhaust its retry budget again
              and return to this list.
            </p>
          </div>

          <input type="hidden" name="jobId" value={jobId} />

          {state.error ? (
            <p
              role="alert"
              className="rounded-control border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <SubmitButton label="Requeue job" pendingLabel="Requeueing…" />
          </div>
        </form>
      </ConfirmDialog>
    </>
  );
}
