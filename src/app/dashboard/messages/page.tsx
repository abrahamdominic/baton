import { redirect } from "next/navigation";
import { isConversationUnread } from "@/lib/messaging/unread";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconMessageCircle } from "@/components/icons";

export const dynamic = "force-dynamic";

function formatTime(d: Date, locale: string): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) {
    return d.toLocaleDateString(locale, { weekday: "short" });
  }
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default async function MessagesPage() {
  const { t, locale } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard/messages");

  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: user.id } } },
    include: {
      team: { select: { id: true, name: true, slug: true } },
      org: { select: { id: true, name: true, slug: true } },
      members: {
        include: { user: { select: { id: true, login: true, name: true } } },
      },
      _count: { select: { messages: true } },
    },
    orderBy: [
      // Explicit NULL placement. Postgres sorts NULL *first* on DESC and
      // SQLite sorts NULL *last*, so without this a brand-new conversation with no
      // messages yet floats to the top of the inbox in production only -- and
      // the SQLite-only test suite sees the opposite behaviour and misses it.
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ],
  });

  const rows = conversations
    .filter((c) => c.teamId !== null || c.orgId !== null)
    .map((c) => {
      const myMembership = c.members.find((m) => m.userId === user.id);
      const lastReadAt = myMembership?.lastReadAt ?? null;
      const unread = isConversationUnread({
        messageCount: c._count.messages,
        lastReadAt,
        lastMessageAt: c.lastMessageAt,
      });
      const others = c.members.filter((m) => m.userId !== user.id);
      const isTeam = Boolean(c.teamId);
      const workspaceName = isTeam
        ? (c.team?.name ?? c.team?.slug ?? "Team")
        : (c.org?.name ?? c.org?.slug ?? "Organization");
      const href = isTeam
        ? `/dashboard/team/${encodeURIComponent(c.teamId!)}/messaging/${encodeURIComponent(c.id)}`
        : `/dashboard/organization/${encodeURIComponent(c.orgId!)}/messaging/${encodeURIComponent(c.id)}`;

      return {
        id: c.id,
        href,
        workspaceName,
        title:
          others.map((m) => (m.user.name ?? m.user.login).trim()).join(", ") ||
          "You",
        messageCount: c._count.messages,
        lastMessageAt: c.lastMessageAt,
        unread,
      };
    });

  const unreadTotal = rows.filter((r) => r.unread).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconMessageCircle className="h-3 w-3" />
            Workspace
          </span>
        }
        title={t("messaging:title")}
        description={
          unreadTotal > 0
            ? t("messaging:unread_summary", { count: unreadTotal })
            : t("messaging:encrypted_across_workspaces")
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={IconMessageCircle}
          title={t("messaging:empty_title")}
          hint={t("messaging:empty_hint")}
        />
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-ink-850/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-bold ${
                      r.unread
                        ? "bg-brand-500/15 text-brand-300"
                        : "border border-white/[0.1] bg-ink-850/80 text-ink-300"
                    }`}
                  >
                    {r.title.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`truncate text-xs ${
                        r.unread
                          ? "font-bold text-white"
                          : "font-semibold text-ink-200"
                      }`}
                    >
                      {r.title}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-ink-500">
                      {r.workspaceName} · {r.messageCount} message
                      {r.messageCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.lastMessageAt ? (
                    <span className="font-mono text-[11px] text-ink-500">
                      {formatTime(r.lastMessageAt, locale)}
                    </span>
                  ) : null}
                  {r.unread ? (
                    <span
                      className="h-2 w-2 rounded-full bg-brand-400"
                      aria-label="unread"
                    />
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
