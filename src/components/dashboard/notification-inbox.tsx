"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  type NotificationItem,
} from "@/app/dashboard/notifications/actions";
import { conversationNotificationHref } from "@/lib/notifications";
import { IconCheck, IconInbox, IconExternalLink } from "@/components/icons";
import { EmptyState } from "@/components/ui";

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function TypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    message: "New message",
    mention: "Mention",
    review: "Review update",
    invite: "Invitation",
    system: "System",
  };
  return map[type] ?? "Update";
}

export function NotificationInbox({
  initialItems,
  initialUnread,
}: {
  initialItems: NotificationItem[];
  initialUnread: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAll, setPendingAll] = useState(false);

  useEffect(() => setItems(initialItems), [initialItems]);
  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const refresh = useCallback(async () => {
    const res = await listNotificationsAction({ limit: 50 });
    if (res.ok) {
      setItems(res.items);
      setUnread(res.items.filter((i) => i.readAt === null).length);
    }
  }, []);

  const markRead = async (id: string) => {
    setPendingId(id);
    const res = await markNotificationReadAction({ id });
    if (res.ok) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: new Date() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      await refresh();
      router.refresh();
    }
    setPendingId(null);
  };

  const markAll = async () => {
    setPendingAll(true);
    const res = await markAllNotificationsReadAction();
    if (res.ok) {
      setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })));
      setUnread(0);
      await refresh();
      router.refresh();
    }
    setPendingAll(false);
  };

  return (
    <div className="space-y-4">
      {unread > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-ink-900/60 px-4 py-3">
          <p className="text-xs text-ink-400">
            <span className="font-semibold text-white">{unread}</span> unread notification
            {unread === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={markAll}
            disabled={pendingAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-ink-850 px-2.5 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:border-white/[0.18] hover:text-white disabled:opacity-50"
          >
            {pendingAll ? (
              "Working…"
            ) : (
              <>
                <IconCheck className="h-3.5 w-3.5" />
                Mark all read
              </>
            )}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={IconInbox}
          title="No notifications yet"
          hint="Messages, mentions, reviews and invitations will show up here."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                n.readAt
                  ? "border-white/[0.06] bg-ink-900/40"
                  : "border-brand-500/20 bg-brand-500/[0.05]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {!n.readAt ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-label="unread" />
                ) : null}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-850 text-xs font-bold text-ink-200">
                  {(n.actor?.name ?? n.actor?.login ?? "B").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">
                    {n.actor ? (
                      <>
                        <span className="text-ink-400">{n.actor.name ?? n.actor.login}</span> ·{" "}
                      </>
                    ) : null}
                    <TypeLabel type={n.type} />
                  </p>
                  <Link
                    href={conversationNotificationHref(JSON.stringify(n.context))}
                    className={`mt-0.5 inline-flex items-center gap-1 truncate font-mono text-[10px] transition-colors ${
                      n.readAt ? "text-ink-500" : "text-brand-300 hover:text-brand-200"
                    }`}
                  >
                    {notificationBlurb(n)}
                    <IconExternalLink className="h-3 w-3 shrink-0" />
                  </Link>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[10px] text-ink-500">{formatRelative(new Date(n.createdAt))}</span>
                {!n.readAt ? (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    disabled={pendingId === n.id}
                    aria-label="Mark as read"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.1] text-ink-400 transition-colors hover:border-brand-500/40 hover:text-brand-300 disabled:opacity-50"
                  >
                    <IconCheck className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function notificationBlurb(n: NotificationItem): string {
  switch (n.resourceType) {
    case "conversation":
      return "Open conversation";
    case "message":
      return "Open message";
    case "pr":
      return "Open pull request";
    case "team_invite":
    case "org_invite":
      return "Review invitation";
    case "billing":
      return "View billing";
    default:
      return `#${n.resourceId.slice(0, 8)}`;
  }
}