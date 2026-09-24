"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  inviteTeamMember,
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
} from "@/app/dashboard/organization/actions";
import { IconUsers, IconBuilding, IconSend, IconTrash, IconShield, IconAlertCircle } from "@/components/icons";

type Kind = "team" | "organization";

function useAction(
  run: (formData: FormData) => Promise<void>,
  getSuccessMessage?: (formData: FormData) => string | null,
) {
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
        setSuccess(getSuccessMessage ? getSuccessMessage(formData) : "Done.");
        router.refresh();
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again."),
      )
      .finally(() => setPending(false));
  };
  return { submit, error, success, pending, clearError: () => setError(null) };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[11px] font-medium leading-relaxed text-danger-300">
      {error}
    </p>
  );
}

function SuccessLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="mt-2 text-[11px] font-medium leading-relaxed text-brand-300">
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
  confirm,
  destructive = false,
  className = "btn btn-ghost btn-sm",
  disabled,
  ariaLabel,
}: {
  run: () => Promise<void>;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  confirm?: string;
  destructive?: boolean;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const invoke = () => {
    setError(null);
    setPending(true);
    run()
      .then(() => router.refresh())
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong. Please try again."))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        disabled={pending || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          if (!pending) invoke();
        }}
        className={`${className} ${destructive ? "border-danger-500/25 text-danger-300 hover:bg-danger-500/10" : ""} ${pending ? "pointer-events-none opacity-60" : ""}`}
      >
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <span>{pending ? "Working…" : label}</span>
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite form (works for teams and organizations)
// ---------------------------------------------------------------------------

export function InviteForm({ kind, workspaceId }: { kind: Kind; workspaceId: string }) {
  const [login, setLogin] = useState("");
  const run = useAction(
    async (formData: FormData) => {
      const githubLogin = String(formData.get("githubLogin") ?? "");
      const role = (String(formData.get("role") ?? "member") === "admin" ? "admin" : "member") as
        | "admin"
        | "member";
      if (kind === "team") {
        await inviteTeamMember({ teamId: workspaceId, githubLogin, role });
      } else {
        await inviteOrgMember({ organizationId: workspaceId, githubLogin, role });
      }
      setLogin("");
    },
    (formData) => `Invite sent to @${String(formData.get("githubLogin") ?? "")}.`,
  );
  const Icon = kind === "team" ? IconUsers : IconBuilding;

  return (
    <form action={run.submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor={`${kind}-invite-login`}
            className="mb-1 block text-[11px] font-semibold text-ink-400"
          >
            GitHub username
          </label>
          <input
            id={`${kind}-invite-login`}
            name="githubLogin"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="octocat"
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
            Role
          </label>
          <select id={`${kind}-invite-role`} name="role" className="input h-9 text-xs">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={run.pending || !login.trim()}
          className="btn btn-primary btn-sm h-9"
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{run.pending ? "Sending…" : "Send invite"}</span>
        </button>
      </div>
      <ErrorLine error={run.error} />
      <SuccessLine message={run.success} />
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
  const value = currentRole === "admin" ? "admin" : "member";
  const run = useAction(async (formData: FormData) => {
    const role = String(formData.get("role") ?? "member");
    if (value !== role) {
      if (kind === "team") await setTeamMemberRole(workspaceId, userId, role as "admin" | "member");
      else await setOrgMemberRole(workspaceId, userId, role as "admin" | "member");
    }
  });

  if (currentRole === "owner") {
    return (
      <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
        Owner
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
        aria-label={`Role for @${login}`}
        disabled={run.pending}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
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
  const [selected, setSelected] = useState(installations[0]?.id ?? "");
  const run = useAction(async () => {
    if (!selected) return;
    if (kind === "team") await addInstallationToTeam(workspaceId, selected);
    else await addInstallationToOrg(workspaceId, selected);
  });

  return (
    <form action={run.submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-48">
        <label htmlFor={`${kind}-share-install`} className="mb-1 block text-[11px] font-semibold text-ink-400">
          GitHub account to share
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
        <span>{run.pending ? "Sharing…" : "Share board"}</span>
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

  const FIELDS: { key: keyof typeof initial; label: string; hint: string }[] = [
    { key: "firstResponseHours", label: "First Response", hint: "Reviewer's initial reply" },
    { key: "reviewFollowUpHours", label: "Re-review", hint: "After author pushes fixes" },
    { key: "changesRequiredHours", label: "Changes Required", hint: "Author acts on feedback" },
    { key: "ciFailHours", label: "CI Failing", hint: "Author fixes a failing suite" },
    { key: "conflictHours", label: "Merge Conflicts", hint: "Author syncs the branch" },
    { key: "readyToMergeHours", label: "Ready to Merge", hint: "Merger merges the PR" },
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
                {f.label}
              </label>
              <span className="block truncate text-[10px] text-ink-500">{f.hint}</span>
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
              <span className="font-mono text-xs text-ink-500">h</span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`${organizationId}-maxNudgesPerState`}
              className="block cursor-pointer text-xs font-semibold text-ink-200"
            >
              Max nudges per state
            </label>
            <span className="block truncate text-[10px] text-ink-500">
              How many mentions per PR state
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
          Applies across every repository shared in this organization.
        </p>
        <button type="submit" className="btn btn-primary btn-sm" disabled={run.pending}>
          {run.pending ? "Saving…" : "Save policy"}
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
    run={kind === "team" ? () => acceptTeamInvite(workspaceId) : () => acceptOrgInvite(workspaceId)}
    label={label}
    className="btn btn-primary btn-sm"
  />
);

export const DeclineInviteButton = ({
  kind,
  workspaceId,
  label = "Decline",
}: {
  kind: Kind;
  workspaceId: string;
  label?: string;
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => declineTeamInvite(workspaceId)
        : () => declineOrgInvite(workspaceId)
    }
    label={label}
    className="btn btn-ghost btn-sm"
  />
);

export const RevokeInviteButton = ({
  kind,
  workspaceId,
  githubLogin,
}: {
  kind: Kind;
  workspaceId: string;
  githubLogin: string;
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => revokeTeamInvite(workspaceId, githubLogin)
        : () => revokeOrgInvite(workspaceId, githubLogin)
    }
    label="Revoke"
    confirm={`Revoke the pending invite for @${githubLogin}?`}
    destructive
    icon={IconTrash}
  />
);

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
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => removeTeamMember(workspaceId, userId)
        : () => removeOrgMember(workspaceId, userId)
    }
    label="Remove"
    confirm={`Remove @${login} from this ${kind}?`}
    destructive
    icon={IconTrash}
    ariaLabel={`Remove @${login}`}
  />
);

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
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => removeInstallationFromTeam(workspaceId, installationId)
        : () => removeInstallationFromOrg(workspaceId, installationId)
    }
    label="Unshare"
    confirm={`Stop sharing @${account}'s board with this ${kind}?`}
    destructive
    icon={IconTrash}
    ariaLabel={`Unshare @${account}`}
  />
);

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
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again."),
      )
      .finally(() => setPending(false));
  };

  const displayName = name?.trim() ? name : `@${login}`;

  return (
    <>
      <button
        type="button"
        aria-label={`Transfer ownership to @${login}`}
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm border-brand-500/25 text-brand-300 hover:border-brand-500/40 hover:bg-brand-500/10"
      >
        <IconShield className="h-3.5 w-3.5" />
        <span>Transfer</span>
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
            aria-label={`Transfer ${kind} ownership to @${login}`}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !pending) setOpen(false);
            }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-ink-900 shadow-2xl"
          >
            <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
                Transfer {kind} ownership
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
                  <p className="truncate text-sm font-bold text-white">{displayName}</p>
                  <p className="truncate font-mono text-[11px] text-ink-400">@{login}</p>
                </div>
                <span className="ml-auto rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                  New owner
                </span>
              </div>

              <div className="flex items-start gap-2.5 rounded-lg border border-warn-500/20 bg-warn-500/[0.05] px-3.5 py-3 text-[11px] leading-relaxed text-ink-300">
                <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
                <span>
                  After this transfer you become an <span className="font-semibold text-white">admin</span>,
                  @{login} becomes the permanent owner, and paid workspace benefits follow the owner&apos;s
                  subscription, so member access may change if @{login}&apos;s plan differs from yours.
                </span>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-ink-300">
                <input
                  type="checkbox"
                  checked={armed}
                  onChange={(e) => setArmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span>
                  I understand that <span className="font-semibold text-white">@{login}</span> becomes the
                  owner and I lose the ability to transfer or delete this {kind}.
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
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending || !armed}
                  onClick={confirmTransfer}
                  className="btn btn-primary btn-sm"
                >
                  <IconShield className="h-3.5 w-3.5" />
                  <span>{pending ? "Transferring…" : `Transfer to @${login}`}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export const LeaveWorkspaceButton = ({ kind, workspaceId }: { kind: Kind; workspaceId: string }) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => leaveTeam(workspaceId)
        : () => leaveOrganization(workspaceId)
    }
    label="Leave workspace"
    confirm={`Leave this ${kind}?`}
    destructive
    className="btn btn-ghost btn-sm border-danger-500/25 text-danger-300 hover:bg-danger-500/10"
  />
);

export const DeleteWorkspaceButton = ({
  kind,
  workspaceId,
  name,
}: {
  kind: Kind;
  workspaceId: string;
  name: string;
}) => (
  <AsyncActionButton
    run={
      kind === "team"
        ? () => deleteTeam(workspaceId)
        : () => deleteOrganization(workspaceId)
    }
    label="Delete"
    confirm={`Permanently delete the ${kind} "${name}" and remove everyone from it? This cannot be undone.`}
    destructive
    icon={IconTrash}
    className="btn btn-ghost btn-sm border-danger-500/25 text-danger-300 hover:bg-danger-500/10"
  />
);