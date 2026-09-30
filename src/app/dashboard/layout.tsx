import { redirect } from "next/navigation";
import { isConversationUnread } from "@/lib/messaging/unread";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/dashboard/app-shell";
import { pendingTeamInvites, pendingOrgInvites } from "@/lib/workspaces";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

// Dashboard is a private product surface, never indexed. Child pages inherit
// this along with the X-Robots-Tag header applied in next.config.ts.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  title: "Dashboard: Baton",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard");

  if (user.suspendedAt) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold text-white">
          {t("errors:account_suspended_title")}
        </h1>
        <p className="text-sm leading-relaxed text-ink-400">
          {t("errors:account_suspended_body_prefix")}{" "}
          <a href="mailto:support@baton.dev" className="text-brand-300">
            support@baton.dev
          </a>
          .
        </p>
        <a href="/auth/logout" className="btn btn-ghost btn-sm">
          {t("auth:sign_out_title")}
        </a>
      </main>
    );
  }

  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;

  const [teamInvites, orgInvites, unreadNotifications, unreadMessages] =
    await Promise.all([
      pendingTeamInvites(user.login),
      pendingOrgInvites(user.login),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      countUnreadConversations(user.id),
    ]).catch(() => [[], [], 0, 0] as const);

  return (
    <AppShell
      user={{
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        githubUrl,
        role: user.role,
      }}
      pendingInvites={{
        team: teamInvites.length,
        organization: orgInvites.length,
      }}
      unreadNotifications={unreadNotifications ?? 0}
      unreadMessages={unreadMessages ?? 0}
    >
      {children}
    </AppShell>
  );
}

/** Number of the user's conversations with at least one unseen message. */
async function countUnreadConversations(userId: string): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId } } },
    select: {
      lastMessageAt: true,
      members: { where: { userId }, select: { lastReadAt: true } },
    },
  });
  // The sidebar badge counted a conversation unread whenever it had any message
  // at all, with no visible-message count to compare against, so an empty
  // conversation with a stale read receipt could light the badge. Sharing the
  // predicate with the lists is what keeps the three in agreement.
  return conversations.filter((c) =>
    isConversationUnread({
      // The sidebar query does not count messages; a conversation that has ever
      // had one is the closest available proxy, and `lastMessageAt` being
      // non-null is exactly that condition.
      messageCount: c.lastMessageAt === null ? 0 : 1,
      lastReadAt: c.members[0]?.lastReadAt,
      lastMessageAt: c.lastMessageAt,
    }),
  ).length;
}
