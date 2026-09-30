"use client";

import { useEffect, useState } from "react";
import { isConversationUnread } from "@/lib/messaging/unread";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CreateConversationResult,
  ConversationSummary,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import {
  createConversationAction,
  listTeamDeviceKeysAction,
  listOrgDeviceKeysAction,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import { useTranslation } from "@/lib/i18n/provider";
import { ensureDevice, buildConversationWraps } from "@/lib/messaging/client";
import { normalizeParticipantIds } from "@/lib/messaging/participants";
import { Dialog } from "@/components/confirm-dialog";
import {
  IconSend,
  IconUsers,
  IconPlus,
  IconChevronRight,
  IconAlertCircle,
  IconCheckCircle,
} from "@/components/icons";

function formatTime(d: Date, locale: string): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function MembersRow({
  members,
  currentUserId,
}: {
  members: ConversationSummary["members"];
  currentUserId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex -space-x-1.5">
        {members.slice(0, 4).map((m) => (
          <span
            key={m.userId}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] bg-ink-800 font-mono text-[10px] font-bold text-ink-200"
          >
            {(m.name ?? m.login).slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
      <p className="truncate text-xs font-semibold text-white">
        {members
          .filter((m) => m.userId !== currentUserId)
          .map((m) => m.name ?? m.login)
          .join(", ") || t("messaging:you")}
      </p>
    </div>
  );
}

export function ConversationList({
  conversations,
  teamId,
  orgId,
  currentUserId,
  initialMemberId,
}: {
  conversations: ConversationSummary[];
  teamId?: string;
  orgId?: string;
  currentUserId: string;
  initialMemberId?: string;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(Boolean(initialMemberId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-400">
          {t("messaging:encryption_note")}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-primary btn-sm"
        >
          <IconPlus className="h-3.5 w-3.5" />
          <span>{t("messaging:new_conversation")}</span>
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-ink-900/40 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.1] bg-ink-850/80 text-ink-300">
            <IconUsers className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-white">
            {t("messaging:list_empty_title")}
          </p>
          <p className="max-w-md text-xs leading-relaxed text-ink-400">
            {t("messaging:list_empty_hint")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          {conversations.map((c) => {
            const unread = isConversationUnread(c);
            const href = teamId
              ? `/dashboard/team/${teamId}/messaging/${c.id}`
              : `/dashboard/organization/${orgId}/messaging/${c.id}`;
            return (
              <li key={c.id}>
                <Link
                  href={href}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-ink-850/60"
                >
                  <MembersRow
                    members={c.members}
                    currentUserId={currentUserId}
                  />
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[11px] text-ink-500">
                      {c.lastMessageAt
                        ? formatTime(c.lastMessageAt, locale)
                        : t("messaging:no_messages")}
                    </span>
                    {unread ? (
                      <span className="h-2 w-2 rounded-full bg-brand-400" />
                    ) : null}
                    <IconChevronRight className="h-3.5 w-3.5 text-ink-500" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <NewConversationDialog
          teamId={teamId}
          orgId={orgId}
          currentUserId={currentUserId}
          initialMemberId={initialMemberId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function NewConversationDialog({
  teamId,
  orgId,
  currentUserId,
  initialMemberId,
  onClose,
}: {
  teamId?: string;
  orgId?: string;
  currentUserId: string;
  initialMemberId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [members, setMembers] = useState<Array<{
    userId: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    devices: Array<{ id: string; publicKeyB64: string }>;
  }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        initialMemberId && initialMemberId !== currentUserId
          ? [initialMemberId]
          : [],
      ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetcher = teamId
      ? listTeamDeviceKeysAction({ teamId })
      : orgId
        ? listOrgDeviceKeysAction({ orgId })
        : Promise.resolve({
            ok: false as const,
            error: t("messaging:no_workspace"),
          });

    fetcher
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setMembers(res.members);
        else setError(res.error);
      })
      .catch(() => !cancelled && setError(t("messaging:error_load_members")));
    return () => {
      cancelled = true;
    };
  }, [teamId, orgId, t]);

  const toggle = (userId: string) => {
    // Never add the creator to `selected`: they are inserted server-side as the
    // conversation owner, and ConversationMember is unique per (conversation, user).
    if (userId === currentUserId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const create = async () => {
    setError(null);
    setPending(true);
    try {
      const device = await ensureDevice(currentUserId);
      if (!device) {
        setError(t("messaging:error_device_key"));
        return;
      }
      // The creator is always a participant (inserted server-side as the owner),
      // so they are never sent in `memberIds`. `normalizeParticipantIds` also
      // collapses any duplicate selection, so a user can never be sent twice.
      const memberIds = normalizeParticipantIds([...selected], currentUserId);
      if (memberIds.length === 0) {
        setError(t("messaging:error_no_selection"));
        return;
      }
      // The creator's own device must also be wrapped so they can decrypt.
      const memberSet = new Set<string>([currentUserId, ...memberIds]);
      const chosen = (members ?? []).filter((m) => memberSet.has(m.userId));
      if (chosen.some((m) => m.devices.length === 0)) {
        setError(t("messaging:error_missing_device"));
        return;
      }
      const wraps = await buildConversationWraps({ device, members: chosen });
      if (!wraps) {
        setError(t("messaging:error_wrap"));
        return;
      }
      const result: CreateConversationResult = await createConversationAction({
        teamId,
        orgId,
        memberIds,
        wrap: {
          issuerPublicKeyB64: device.publicKeyB64,
          entries: wraps.entries,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const targetUrl = teamId
        ? `/dashboard/team/${teamId}/messaging/${result.conversationId}`
        : `/dashboard/organization/${orgId}/messaging/${result.conversationId}`;
      router.push(targetUrl);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("messaging:error_unknown"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      bare
      label={t("messaging:new_conversation")}
    >
      <div className="border-b border-white/[0.07] px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <IconSend className="h-4 w-4 text-brand-400" />
          {t("messaging:new_conversation")}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          {t("messaging:new_conversation_hint")}
        </p>
      </div>

      <div className="max-h-72 overflow-y-auto p-4">
        {!members ? (
          <p className="text-xs text-ink-500">
            {t("messaging:loading_devices")}
          </p>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => {
              const isMe = m.userId === currentUserId;
              const noDevice = m.devices.length === 0;
              const checked = selected.has(m.userId);
              // The creator is always added server-side as the conversation owner,
              // so their own row is not toggleable.
              const locked = isMe;
              return (
                <li key={m.userId}>
                  <button
                    type="button"
                    disabled={noDevice || locked}
                    aria-pressed={checked}
                    onClick={() => toggle(m.userId)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      checked
                        ? "border-brand-500/40 bg-brand-500/10"
                        : noDevice || locked
                          ? "cursor-not-allowed border-white/[0.05] bg-ink-950/40 opacity-60"
                          : "border-white/[0.06] bg-ink-950/50 hover:border-white/[0.14]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-white">
                        {m.name ?? m.login}
                        {isMe ? (
                          <span className="ml-1.5 text-ink-500">
                            {t("messaging:you")}
                          </span>
                        ) : null}
                      </span>
                      <span className="block font-mono text-[10px] text-ink-500">
                        @{m.login} ·{" "}
                        {t("messaging:device_count", {
                          count: m.devices.length,
                        })}
                        {locked ? (
                          <span className="ml-1.5">
                            · {t("messaging:always_included")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {noDevice ? (
                      <IconAlertCircle className="h-4 w-4 shrink-0 text-warn-400" />
                    ) : (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-brand-500 bg-brand-500 text-on-brand"
                            : "border-white/[0.2]"
                        }`}
                      >
                        {checked ? (
                          <IconCheckCircle className="h-3 w-3" />
                        ) : null}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-4">
        <p className="text-[11px] leading-relaxed text-ink-500">
          <IconLockHint />
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            {t("messaging:cancel")}
          </button>
          <button
            type="button"
            onClick={create}
            disabled={pending || selected.size === 0}
            className="btn btn-primary btn-sm"
          >
            {pending ? t("messaging:creating") : t("messaging:create")}
          </button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
    </Dialog>
  );
}

function IconLockHint() {
  const { t } = useTranslation();
  return <>{t("messaging:server_blind_hint")}</>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-t border-danger-500/20 bg-danger-500/[0.06] px-5 py-3 text-[11px] font-medium leading-relaxed text-danger-300"
    >
      {message}
    </p>
  );
}
