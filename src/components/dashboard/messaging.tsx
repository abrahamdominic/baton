"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CreateConversationResult,
  ConversationSummary,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import {
  createConversationAction,
  listTeamDeviceKeysAction,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import { ensureDevice, buildConversationWraps } from "@/lib/messaging/client";
import {
  IconSend,
  IconUsers,
  IconPlus,
  IconChevronRight,
  IconAlertCircle,
  IconCheckCircle,
} from "@/components/icons";

function formatTime(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MembersRow({
  members,
  currentUserId,
}: {
  members: ConversationSummary["members"];
  currentUserId: string;
}) {
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
          .join(", ") || "You"}
      </p>
    </div>
  );
}

export function ConversationList({
  conversations,
  teamId,
  currentUserId,
  isAdmin,
}: {
  conversations: ConversationSummary[];
  teamId: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-400">
          Client-encrypted team conversations. Messages are encrypted before they ever leave
          your device; the server stores only ciphertext and per-member key wraps.
        </p>
        {isAdmin ? (
          <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <IconPlus className="h-3.5 w-3.5" />
            <span>New conversation</span>
          </button>
        ) : null}
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-ink-900/40 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.1] bg-ink-850/80 text-ink-300">
            <IconUsers className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-white">No conversations yet</p>
          {isAdmin ? (
            <p className="max-w-md text-xs leading-relaxed text-ink-400">
              Start one to share encrypted messages with your team.
            </p>
          ) : (
            <p className="max-w-md text-xs leading-relaxed text-ink-400">
              A team admin needs to start a conversation before you can read messages here.
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          {conversations.map((c) => {
            const unread = c.messageCount > 0 && (!c.lastReadAt || c.lastReadAt < (c.lastMessageAt ?? c.createdAt));
            return (
              <li key={c.id}>
                <Link
                  href={`/dashboard/team/${teamId}/messaging/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-ink-850/60"
                >
                  <MembersRow members={c.members} currentUserId={currentUserId} />
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[11px] text-ink-500">
                      {c.lastMessageAt ? formatTime(c.lastMessageAt) : "no messages"}
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
          currentUserId={currentUserId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function NewConversationDialog({
  teamId,
  currentUserId,
  onClose,
}: {
  teamId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<
    Array<{ userId: string; login: string; name: string | null; avatarUrl: string | null; devices: Array<{ id: string; publicKeyB64: string }> }> | null
  >(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTeamDeviceKeysAction({ teamId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setMembers(res.members);
        else setError(res.error);
      })
      .catch(() => !cancelled && setError("Could not load team members."));
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const toggle = (userId: string) => {
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
        setError("Could not set up your device key. Please try again.");
        return;
      }
      // The creator's own device must also be wrapped so they can decrypt.
      const memberSet = new Set<string>([currentUserId, ...selected]);
      const chosen = (members ?? []).filter((m) => memberSet.has(m.userId));
      if (chosen.some((m) => m.devices.length === 0)) {
        setError("Every selected member needs a registered device key. Ask them to open messaging once first.");
        return;
      }
      const wraps = await buildConversationWraps({ device, members: chosen });
      if (!wraps) {
        setError("Could not wrap the thread key for the selected members.");
        return;
      }
      const result: CreateConversationResult = await createConversationAction({
        teamId,
        memberIds: [...selected],
        wrap: {
          issuerPublicKeyB64: device.publicKeyB64,
          entries: wraps.entries,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/dashboard/team/${teamId}/messaging/${result.conversationId}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New conversation"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.1] bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-white/[0.07] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <IconSend className="h-4 w-4 text-brand-400" />
            New conversation
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Pick team members. A fresh thread key is generated on your device and wrapped for
            every participant&apos;s registered device.
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto p-4">
          {!members ? (
            <p className="text-xs text-ink-500">Loading team devices…</p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => {
                const isMe = m.userId === currentUserId;
                const noDevice = m.devices.length === 0;
                const checked = selected.has(m.userId);
                return (
                  <li key={m.userId}>
                    <button
                      type="button"
                      disabled={noDevice}
                      onClick={() => toggle(m.userId)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        checked
                          ? "border-brand-500/40 bg-brand-500/10"
                          : noDevice
                          ? "cursor-not-allowed border-white/[0.05] bg-ink-950/40 opacity-50"
                          : "border-white/[0.06] bg-ink-950/50 hover:border-white/[0.14]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-white">
                          {m.name ?? m.login}
                          {isMe ? <span className="ml-1.5 text-ink-500">(you)</span> : null}
                        </span>
                        <span className="block font-mono text-[10px] text-ink-500">
                          @{m.login} · {m.devices.length} device{m.devices.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      {noDevice ? (
                        <IconAlertCircle className="h-4 w-4 shrink-0 text-warn-400" />
                      ) : (
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? "border-brand-500 bg-brand-500 text-white"
                              : "border-white/[0.2]"
                          }`}
                        >
                          {checked ? <IconCheckCircle className="h-3 w-3" /> : null}
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
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={create}
              disabled={pending || selected.size === 0}
              className="btn btn-primary btn-sm"
            >
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        {error ? <ErrorBanner message={error} /> : null}
      </div>
    </div>
  );
}

function IconLockHint() {
  return (
    <>
      The server never sees your message contents or private keys.
    </>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="border-t border-danger-500/20 bg-danger-500/[0.06] px-5 py-3 text-[11px] font-medium leading-relaxed text-danger-300">
      {message}
    </p>
  );
}