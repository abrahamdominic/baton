"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  setUserRoleAction,
  setSuspensionAction,
  type AdminActionState,
} from "./actions";
import { IconAlertCircle, IconShield } from "@/components/icons";

function DialogShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border border-white/[0.1] bg-ink-900 p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

function DialogFooter({
  onCancel,
  cancelLabel,
  confirmLabel,
  confirmTone,
  submitting,
}: {
  onCancel: () => void;
  cancelLabel: string;
  confirmLabel: string;
  confirmTone: "brand" | "danger";
  submitting: boolean;
}) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
        {cancelLabel}
      </button>
      <button
        type="submit"
        disabled={submitting}
        className={
          confirmTone === "danger"
            ? "inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/15 px-3 py-1.5 text-xs font-semibold text-danger-200 transition-colors hover:bg-danger-500/25 focus-visible:ring-2 focus-visible:ring-danger-400 disabled:opacity-60"
            : "btn btn-primary btn-sm"
        }
      >
        {submitting ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}

export function AdminUserActions({
  userId,
  login,
  isAdmin,
  isSuspended,
}: {
  userId: string;
  login: string;
  isAdmin: boolean;
  isSuspended: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "role" | "suspension">(null);
  const [roleState, roleAction, rolePending] = useActionState<AdminActionState, FormData>(
    setUserRoleAction,
    { ok: false },
  );
  const [suspendState, suspendAction, suspendPending] = useActionState<AdminActionState, FormData>(
    setSuspensionAction,
    { ok: false },
  );

  useEffect(() => {
    if (roleState.ok) setDialog(null);
  }, [roleState, router]);
  useEffect(() => {
    if (suspendState.ok) {
      setDialog(null);
      router.refresh();
    }
  }, [suspendState, router]);

  const closeDialog = () => {
    setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Role Toggle */}
      <button
        type="button"
        onClick={() => setDialog("role")}
        className="btn btn-ghost btn-sm h-7 text-xs"
      >
        {isAdmin ? "Demote" : "Make Admin"}
      </button>

      {/* Suspension Toggle */}
      <button
        type="button"
        onClick={() => setDialog("suspension")}
        className={`btn btn-ghost btn-sm h-7 text-xs ${
          isSuspended
            ? "text-signal-300 hover:border-signal-500/40"
            : "text-ink-400 hover:border-danger-500/40 hover:text-danger-300"
        }`}
      >
        {isSuspended ? "Unsuspend" : "Suspend"}
      </button>

      {/* Role Confirmation Dialog */}
      {dialog === "role" ? (
        <DialogShell onClose={closeDialog}>
          <form action={roleAction}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/25 bg-brand-500/10 text-brand-300">
                <IconShield className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {isAdmin ? `Revoke admin from @${login}?` : `Make @${login} an admin?`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">
                  {isAdmin
                    ? `${login} will lose access to every /admin console and all administrative actions. Their data and GitHub access are unchanged.`
                    : `${login} will gain full access to the /admin consoles, user management, billing overrides, and gift-granting. This is a privileged, auditable role.`}
                </p>
              </div>
            </div>

            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="role" value={isAdmin ? "user" : "admin"} />
            <input type="hidden" name="confirm" value="on" />

            {roleState.error ? (
              <p className="mt-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300">
                {roleState.error}
              </p>
            ) : null}

            <DialogFooter
              onCancel={closeDialog}
              cancelLabel="Cancel"
              confirmLabel={isAdmin ? "Revoke admin" : "Make admin"}
              confirmTone="brand"
              submitting={rolePending}
            />
          </form>
        </DialogShell>
      ) : null}

      {/* Suspension Confirmation Dialog */}
      {dialog === "suspension" ? (
        <DialogShell onClose={closeDialog}>
          <form action={suspendAction}>
            <div className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-danger-500/10 ${
                  isSuspended ? "border-signal-500/25 text-signal-300" : "border-danger-500/25 text-danger-300"
                }`}
              >
                <IconAlertCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {isSuspended ? `Restore @${login}?` : `Suspend @${login}?`}
                </p>
                {isSuspended ? (
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">
                    {login} will regain full service access and can sign back in with GitHub
                    immediately.
                  </p>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">
                    {login} will be locked out immediately: every active session is revoked, GitHub
                    login is blocked, and they lose access to all dashboards until an admin restores
                    them.
                  </p>
                )}
              </div>
            </div>

            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="suspended" value={isSuspended ? "false" : "true"} />
            <input type="hidden" name="confirm" value="on" />

            {suspendState.error ? (
              <p className="mt-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-300">
                {suspendState.error}
              </p>
            ) : null}

            <DialogFooter
              onCancel={closeDialog}
              cancelLabel="Cancel"
              confirmLabel={isSuspended ? "Restore account" : "Suspend account"}
              confirmTone="danger"
              submitting={suspendPending}
            />
          </form>
        </DialogShell>
      ) : null}
    </div>
  );
}