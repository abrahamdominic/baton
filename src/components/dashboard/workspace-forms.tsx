"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  inviteTeamMember,
  type InviteOutcome,
  acceptTeamInvite,
  declineTeamInvite,
  revokeTeamInvite,
  removeTeamMember,
  setTeamMemberRole,
  addInstallationToTeam,
  removeInstallationFromTeam,
  transferTeamOwnership,
  leaveTeam,
  deleteTeam,
} from "@/app/dashboard/team/actions";
import {
  inviteOrgMember,
  acceptOrgInvite,
  declineOrgInvite,
  revokeOrgInvite,
  removeOrgMember,
  setOrgMemberRole,
  addInstallationToOrg,
  removeInstallationFromOrg,
  transferOrgOwnership,
  leaveOrganization,
  deleteOrganization,
  upsertOrgPolicy,
  type OrgInviteOutcome,
} from "@/app/dashboard/organization/actions";
import {
  IconUsers,
  IconBuilding,
  IconSend,
  IconTrash,
  IconShield,
  IconAlertCircle,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useTranslation } from "@/lib/i18n/provider";

type Kind = "team" | "organization";

function useAction(
  run: (formData: FormData) => Promise<void>,
  getSuccessMessage?: (formData: FormData) => string | null,
) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const submit = (formData: FormData) => {
    setError(null);
    setSuccess(null);
    setPending(true);
    run(formData)
      .then(() => {
        setSuccess(
          getSuccessMessage
            ? getSuccessMessage(formData)
            : t("workspace:action_done"),
        );
        router.refresh();
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("workspace:action_error")),
      )
      .finally(() => setPending(false));
  };
  return { submit, error, success, pending, clearError: () => setError(null) };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mt-2 text-[11px] font-medium leading-relaxed text-danger-300"
    >
      {error}
    </p>
  );
}

function SuccessLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="mt-2 text-[11px] font-medium leading-relaxed text-brand-300"
    >
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// AsyncActionButton: one-shot server action with pending + error feedback.
// ---------------------------------------------------------------------------

export function AsyncActionButton({
  run,
  label,
  icon: Icon,
  confirmation,
  destructive = false,
  className = "btn btn-ghost btn-sm",
  disabled,
  ariaLabel,
}: {
  run: () => Promise<void>;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  confirmation?: {
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    loadingLabel?: string;
    successMessage: string;
    errorMessage?: string;
  };
  destructive?: boolean;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const invoke = () => {
    setError(null);
    setPending(true);
    run()
      .then(() => {
        if (confirmation) {
          setSuccess(confirmation.successMessage);
          window.setTimeout(() => router.refresh(), 800);
        } else {
          router.refresh();
        }
      })
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : (confirmation?.errorMessage ?? t("workspace:action_error")),
        ),
      )
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={
          ariaLabel ?? (typeof label === "string" ? label : undefined)
        }
        disabled={pending || disabled}
        onClick={() => (confirmation ? setOpen(true) : !pending && invoke())}
        className={`${className} ${destructive ? "border-danger-500/25 text-danger-300 hover:bg-danger-500/10" : ""} ${pending ? "pointer-events-none opacity-60" : ""}`}
      >
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <span>
          {pending
            ? (confirmation?.loadingLabel ?? t("workspace:action_working"))
            : label}
        </span>
      </button>
      <ErrorLine error={error} />
      {confirmation ? (
        <ConfirmDialog
          open={open}
          onClose={() => {
            if (!pending) {
              setOpen(false);
              setError(null);
              setSuccess(null);
            }
          }}
          labelledBy={`confirmation-title-${ariaLabel ?? (typeof label === "string" ? label : "action")}`}
        >
          <div className="space-y-4">
            <div>
              <h2
                id={`confirmation-title-${ariaLabel ?? (typeof label === "string" ? label : "action")}`}
                className="text-base font-bold text-white"
              >
                {confirmation.title}
              </h2>
              <div className="mt-2 text-xs leading-relaxed text-ink-300">
                {confirmation.description}
              </div>
            </div>
            {error ? <ErrorLine error={error} /> : null}
            {success ? <SuccessLine message={success} /> : null}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm"
              >
                {t("workspace:action_cancel")}
              </button>
              <button
                type="button"
                data-autofocus
                disabled={pending || Boolean(success)}
                onClick={invoke}
                className="btn btn-sm border border-danger-500/35 bg-danger-500/15 text-danger-100 hover:bg-danger-500/25"
              >
                <IconTrash className="h-3.5 w-3.5" />
                <span>
                  {pending
                    ? (confirmation.loadingLabel ??
                      t("workspace:action_working"))
                    : confirmation.confirmLabel}
                </span>
              </button>
            </div>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite form (works for teams and organizations)
// ---------------------------------------------------------------------------

/**
 * Map an invite outcome to copy the user can act on.
 *
 * The action returns codes rather than throwing, because Next.js replaces a
 * thrown server-action message with generic production text -- which is how
 * "your plan has no seats" reached the browser as "An error occurred in the
 * Server Components render". Each code gets its own line, and the two that a
 * user can resolve (upgrade, or a typo in the handle) say what to do next.
 */
function inviteErrorKey(code: string): string {
  switch (code) {
    case "invalid_login":
      return "workspace:invite_err_invalid_login";
    case "self_invite":
      return "workspace:invite_err_self_invite";
    case "not_a_member":
      return "workspace:invite_err_not_a_member";
    case "not_an_admin":
      return "workspace:invite_err_not_an_admin";
    case "no_seats":
      return "workspace:invite_err_no_seats";
    case "plan_unavailable":
      return "workspace:invite_err_plan_unavailable";
    case "already_member":
      return "workspace:invite_err_already_member";
    case "already_invited":
      return "workspace:invite_err_already_invited";
    case "github_user_not_found":
      return "workspace:invite_err_not_found";
    default:
      return "workspace:action_error";
  }
}

export function InviteForm({
  kind,
  workspaceId,
}: {
  kind: Kind;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [login, setLogin] = useState("");
  const [outcome, setOutcome] = useState<
    InviteOutcome | OrgInviteOutcome | null
  >(null);
  const run = useAction(
    async (formData: FormData) => {
      const githubLogin = String(formData.get("githubLogin") ?? "");
      const role = (
        String(formData.get("role") ?? "member") === "admin"
          ? "admin"
          : "member"
      ) as "admin" | "member";
      const res =
        kind === "team"
          ? await inviteTeamMember({ teamId: workspaceId, githubLogin, role })
          : await inviteOrgMember({
              organizationId: workspaceId,
              githubLogin,
              role,
            });
      setOutcome(res);
      // Clear the field only on success, so a typo can be corrected in place
      // instead of retyped.
      if (res.ok) setLogin("");
    },
    // No success message here on purpose. `useAction` sets `success` for *any*
    // resolved action, so a typed failure would render "Invite sent to dconco"
    // directly above the real reason. The message is derived from `outcome`
    // below, which is the only value that knows whether the invite happened.
  );
  const Icon = kind === "team" ? IconUsers : IconBuilding;

  const code = outcome && !outcome.ok ? outcome.code : null;
  // Business rules now come back as typed results, so the only thing left that
  // can reach `run.error` is an unexpected throw (a lost session, a dead
  // connection). Show a generic message for those: the raw string can be an
  // internal detail, and an untranslated one is no use to the reader.
  const message = code
    ? t(inviteErrorKey(code))
    : run.error
      ? t("workspace:invite_err_generic")
      : null;
  // A seat limit is a billing problem, so point at the page that resolves it
  // instead of leaving the user to guess.
  const showUpgrade = code === "no_seats";
  return (
    <form action={run.submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor={`${kind}-invite-login`}
            className="mb-1 block text-[11px] font-semibold text-ink-400"
          >
            {t("workspace:invite_label")}
          </label>
          <input
            id={`${kind}-invite-login`}
            name="githubLogin"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder={t("workspace:invite_placeholder")}
            autoComplete="off"
            spellCheck={false}
            className="input h-9 w-full min-w-40 font-mono text-xs"
          />
        </div>
        <div>
          <label
            htmlFor={`${kind}-invite-role`}
            className="mb-1 block text-[11px] font-semibold text-ink-400"
          >
            {t("workspace:invite_role_label")}
          </label>
          <select
            id={`${kind}-invite-role`}
            name="role"
            className="input h-9 text-xs"
          >
            <option value="member">{t("workspace:role_member")}</option>
            <option value="admin">{t("workspace:role_admin")}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={run.pending || !login.trim()}
          className="btn btn-primary btn-sm h-9"
        >
          <Icon className="h-3.5 w-3.5" />
          <span>
            {run.pending
              ? t("workspace:invite_sending")
              : t("workspace:invite_submit")}
          </span>
        </button>
      </div>
      <ErrorLine error={message} />
      {showUpgrade ? (
        <p className="mt-2 text-[11px] text-ink-400">
          <Link
            href="/dashboard/billing"
            className="text-brand-300 underline hover:text-brand-200"
          >
            {t("workspace:invite_upgrade")}
          </Link>
        </p>
      ) : null}
      {/* Uses the login the server stored, not the raw field value, so "@DConco "
          is confirmed back as "dconco". */}
      <SuccessLine
        message={
          outcome?.ok
            ? t("workspace:invite_sent", { login: outcome.login })
            : null
        }
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Role dropdown (admin/member)
// ---------------------------------------------------------------------------

export function RoleSelectForm({
  kind,
  workspaceId,
  userId,
  currentRole,
  login,
}: {
  kind: Kind;
  workspaceId: string;
  userId: string;
  currentRole: string;
  login: string;
}) {
  const { t } = useTranslation();
  const value = currentRole === "admin" ? "admin" : "member";
  const run = useAction(async (formData: FormData) => {
    const role = String(formData.get("role") ?? "member");
    if (value !== role) {
      if (kind === "team")
        await setTeamMemberRole(
          workspaceId,
          userId,
          role as "admin" | "member",
        );
      else
        await setOrgMemberRole(workspaceId, userId, role as "admin" | "member");
    }
  });

  if (currentRole === "owner") {
    return (
      <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
        {t("workspace:role_owner")}
      </span>
    );
  }
  return (
    <form action={run.submit} className="flex items-center gap-2">
      <select
        name="role"
        value={value}
        onChange={(e) => e.target.form?.requestSubmit()}
        className="input h-8 w-28 text-[11px]"
        aria-label={t("workspace:role_for", { login })}
        disabled={run.pending}
      >
        <option value="member">{t("workspace:role_member")}</option>
        <option value="admin">{t("workspace:role_admin")}</option>
      </select>
      <ErrorLine error={run.error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Share a GitHub installation with the workspace
// ---------------------------------------------------------------------------

export function ShareInstallForm({
  kind,
  workspaceId,
  installations,
}: {
  kind: Kind;
  workspaceId: string;
  installations: { id: string; installationId: number; accountLogin: string }[];
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(installations[0]?.id ?? "");
  const run = useAction(async () => {
    if (!selected) return;
    if (kind === "team") await addInstallationToTeam(workspaceId, selected);
    else await addInstallationToOrg(workspaceId, selected);
  });

  return (
    <form action={run.submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-48">
        <label
          htmlFor={`${kind}-share-install`}
          className="mb-1 block text-[11px] font-semibold text-ink-400"
        >
          {t("workspace:share_label")}
        </label>
        <select
          id={`${kind}-share-install`}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="input h-9 w-full font-mono text-xs"
        >
          {installations.map((i) => (
            <option key={i.id} value={i.id}>
              @{i.accountLogin}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={run.pending || !installations.length}
        className="btn btn-ghost btn-sm h-9"
      >
        <IconSend className="h-3.5 w-3.5" />
        <span>
          {run.pending
            ? t("workspace:share_sharing")
            : t("workspace:share_submit")}
        </span>
      </button>
      <div className="w-full">
        <ErrorLine error={run.error} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Org-wide review stall policy form
// ---------------------------------------------------------------------------

export function PolicyForm({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: {
    firstResponseHours: number;
    reviewFollowUpHours: number;
    changesRequiredHours: number;
    ciFailHours: number;
    conflictHours: number;
    readyToMergeHours: number;
    maxNudgesPerState: number;
  };
}) {
  const { t } = useTranslation();
  const run = useAction(async (formData: FormData) => {
    const int = (k: string) => Number(formData.get(k) ?? 0);
    await upsertOrgPolicy({
      organizationId,
      firstResponseHours: int("firstResponseHours"),
      reviewFollowUpHours: int("reviewFollowUpHours"),
      changesRequiredHours: int("changesRequiredHours"),
      ciFailHours: int("ciFailHours"),
      conflictHours: int("conflictHours"),
      readyToMergeHours: int("readyToMergeHours"),
      maxNudgesPerState: int("maxNudgesPerState") || 1,
    });
  });

  // Key suffixes only. The label/hint pair resolves per render so the six
  // threshold fields cannot drift between locales.
  const FIELDS: { key: keyof typeof initial; id: string }[] = [
    { key: "firstResponseHours", id: "first_response" },
    { key: "reviewFollowUpHours", id: "rereview" },
    { key: "changesRequiredHours", id: "changes_required" },
    { key: "ciFailHours", id: "ci_fail" },
    { key: "conflictHours", id: "conflict" },
    { key: "readyToMergeHours", id: "ready_to_merge" },
  ];

  return (
    <form action={run.submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div
            key={f.key}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`${organizationId}-${f.key}`}
                className="block cursor-pointer text-xs font-semibold text-ink-200"
              >
                {t(`workspace:policy_${f.id}`)}
              </label>
              <span className="block truncate text-[10px] text-ink-500">
                {t(`workspace:policy_${f.id}_hint`)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                id={`${organizationId}-${f.key}`}
                name={f.key}
                type="number"
                min={1}
                max={168}
                defaultValue={initial[f.key]}
                className="input h-8 w-16 text-right font-mono text-xs"
              />
              <span className="font-mono text-xs text-ink-500">
                {t("workspace:policy_unit_hours")}
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`${organizationId}-maxNudgesPerState`}
              className="block cursor-pointer text-xs font-semibold text-ink-200"
            >
              {t("workspace:policy_max_nudges")}
            </label>
            <span className="block truncate text-[10px] text-ink-500">
              {t("workspace:policy_max_nudges_hint")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id={`${organizationId}-maxNudgesPerState`}
              name="maxNudgesPerState"
              type="number"
              min={0}
              max={10}
              defaultValue={initial.maxNudgesPerState}
              className="input h-8 w-16 text-right font-mono text-xs"
            />
            <span className="font-mono text-xs text-ink-500">x</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="font-mono text-[11px] text-ink-500">
          {t("workspace:policy_scope")}
        </p>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={run.pending}
        >
          {run.pending
            ? t("workspace:policy_saving")
            : t("workspace:policy_save")}
        </button>
      </div>
      <ErrorLine error={run.error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Re-exported convenience wrappers so server pages stay declarative
// ---------------------------------------------------------------------------

export const AcceptInviteButton = ({
  kind,
  workspaceId,
  label,
}: {
  kind: Kind;
  workspaceId: string;
  label: string;
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => acceptTeamInvite(workspaceId)
        : () => acceptOrgInvite(workspaceId)
    }
    label={label}
    className="btn btn-primary btn-sm"
  />
);

export const DeclineInviteButton = ({
  kind,
  workspaceId,
  label,
}: {
  kind: Kind;
  workspaceId: string;
  label?: string;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => declineTeamInvite(workspaceId)
          : () => declineOrgInvite(workspaceId)
      }
      label={label ?? t("workspace:decline_default")}
      className="btn btn-ghost btn-sm"
    />
  );
};

export const RevokeInviteButton = ({
  kind,
  workspaceId,
  githubLogin,
  email,
}: {
  kind: Kind;
  workspaceId: string;
  githubLogin: string;
  email?: string | null;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => revokeTeamInvite(workspaceId, githubLogin)
          : () => revokeOrgInvite(workspaceId, githubLogin)
      }
      label={t("workspace:revoke_label")}
      // Without a per-recipient name, every pending invite renders a trigger
      // that reads simply "Revoke" and every dialog shares one DOM id, so a
      // screen-reader user hears N identical controls and cannot tell which
      // invitation a dialog belongs to.
      ariaLabel={t("workspace:revoke_aria", { login: githubLogin })}
      confirmation={{
        title: t("workspace:revoke_title"),
        description: (
          <div className="space-y-2">
            <p>
              {t("workspace:revoke_desc", {
                login: githubLogin,
                kind: t(`workspace:kind_${kind}`),
              })}
              {email ? <span className="text-ink-400"> ({email})</span> : null}
            </p>
          </div>
        ),
        confirmLabel: t("workspace:revoke_confirm"),
        loadingLabel: t("workspace:revoke_loading"),
        successMessage: t("workspace:revoke_success"),
        errorMessage: t("workspace:revoke_error"),
      }}
      destructive
      icon={IconTrash}
    />
  );
};

export const RemoveMemberButton = ({
  kind,
  workspaceId,
  userId,
  login,
}: {
  kind: Kind;
  workspaceId: string;
  userId: string;
  login: string;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => removeTeamMember(workspaceId, userId)
          : () => removeOrgMember(workspaceId, userId)
      }
      label={t("workspace:remove_label")}
      confirmation={{
        title: t("workspace:remove_title", { login }),
        description: t("workspace:remove_desc", {
          kind: t(`workspace:kind_${kind}`),
        }),
        confirmLabel: t("workspace:remove_confirm"),
        successMessage: t("workspace:remove_success", { login }),
      }}
      destructive
      icon={IconTrash}
      ariaLabel={t("workspace:remove_aria", { login })}
    />
  );
};

export const UnshareInstallButton = ({
  kind,
  workspaceId,
  installationId,
  account,
}: {
  kind: Kind;
  workspaceId: string;
  installationId: string;
  account: string;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => removeInstallationFromTeam(workspaceId, installationId)
          : () => removeInstallationFromOrg(workspaceId, installationId)
      }
      label={t("workspace:unshare_label")}
      confirmation={{
        title: t("workspace:unshare_title"),
        description: t("workspace:unshare_desc", {
          account,
          kind: t(`workspace:kind_${kind}`),
        }),
        confirmLabel: t("workspace:unshare_confirm"),
        successMessage: t("workspace:unshare_success"),
      }}
      destructive
      icon={IconTrash}
      ariaLabel={t("workspace:unshare_aria", { account })}
    />
  );
};

export const TransferOwnerButton = ({
  kind,
  workspaceId,
  userId,
  login,
  name,
  avatarUrl,
}: {
  kind: Kind;
  workspaceId: string;
  userId: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = kind === "team" ? transferTeamOwnership : transferOrgOwnership;

  const confirmTransfer = () => {
    setError(null);
    setPending(true);
    run(workspaceId, userId)
      .then(() => {
        setOpen(false);
        setArmed(false);
        router.refresh();
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("workspace:action_error")),
      )
      .finally(() => setPending(false));
  };

  const displayName = name?.trim() ? name : `@${login}`;

  return (
    <>
      <button
        type="button"
        aria-label={t("workspace:transfer_aria", { login })}
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm border-brand-500/25 text-brand-300 hover:border-brand-500/40 hover:bg-brand-500/10"
      >
        <IconShield className="h-3.5 w-3.5" />
        <span>{t("workspace:transfer_label")}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => {
              if (!pending) setOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("workspace:transfer_aria_dialog", {
              login,
              kind: t(`workspace:kind_${kind}`),
            })}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !pending) setOpen(false);
            }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-ink-900 shadow-2xl"
          >
            <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
                {t("workspace:transfer_heading", {
                  kind: t(`workspace:kind_${kind}`),
                })}
              </span>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={login}
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-full ring-1 ring-white/15"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-sm font-bold text-ink-100">
                    {login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">
                    {displayName}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-400">
                    @{login}
                  </p>
                </div>
                <span className="ml-auto rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                  {t("workspace:transfer_new_owner")}
                </span>
              </div>

              <div className="flex items-start gap-2.5 rounded-lg border border-warn-500/20 bg-warn-500/[0.05] px-3.5 py-3 text-[11px] leading-relaxed text-ink-300">
                <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
                <span>{t("workspace:transfer_warning", { login })}</span>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-ink-300">
                <input
                  type="checkbox"
                  checked={armed}
                  onChange={(e) => setArmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span>
                  {t("workspace:transfer_ack", {
                    login,
                    kind: t(`workspace:kind_${kind}`),
                  })}
                </span>
              </label>

              <ErrorLine error={error} />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                  className="btn btn-ghost btn-sm"
                >
                  {t("workspace:action_cancel")}
                </button>
                <button
                  type="button"
                  disabled={pending || !armed}
                  onClick={confirmTransfer}
                  className="btn btn-primary btn-sm"
                >
                  <IconShield className="h-3.5 w-3.5" />
                  <span>
                    {pending
                      ? t("workspace:transfer_loading")
                      : t("workspace:transfer_confirm", { login })}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export const LeaveWorkspaceButton = ({
  kind,
  workspaceId,
}: {
  kind: Kind;
  workspaceId: string;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => leaveTeam(workspaceId)
          : () => leaveOrganization(workspaceId)
      }
      label={t("workspace:leave_label")}
      confirmation={{
        title: t("workspace:leave_title", {
          kind: t(`workspace:kind_${kind}`),
        }),
        description: t("workspace:leave_desc"),
        confirmLabel: t("workspace:leave_confirm"),
        successMessage: t("workspace:leave_success", {
          kind: t(`workspace:kind_${kind}`),
        }),
      }}
      destructive
      className="btn btn-ghost btn-sm border-danger-500/25 text-danger-300 hover:bg-danger-500/10"
    />
  );
};

export const DeleteWorkspaceButton = ({
  kind,
  workspaceId,
  name,
}: {
  kind: Kind;
  workspaceId: string;
  name: string;
}) => {
  const { t } = useTranslation();
  return (
    <AsyncActionButton
      run={
        kind === "team"
          ? () => deleteTeam(workspaceId)
          : () => deleteOrganization(workspaceId)
      }
      label={t("workspace:delete_label")}
      confirmation={{
        title: t("workspace:delete_title", {
          kind: t(`workspace:kind_${kind}`),
        }),
        description: t("workspace:delete_desc", { name }),
        confirmLabel: t("workspace:delete_confirm", {
          kind: t(`workspace:kind_${kind}`),
        }),
        successMessage: t(`workspace:delete_success_${kind}`),
      }}
      destructive
      icon={IconTrash}
      className="btn btn-ghost btn-sm border-danger-500/25 text-danger-300 hover:bg-danger-500/10"
    />
  );
};
