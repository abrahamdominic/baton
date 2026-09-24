import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PageHeader, Badge } from "@/components/ui";
import { IconBell } from "@/components/icons";
import { NotificationInbox } from "@/components/dashboard/notification-inbox";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard/notifications");

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      include: {
        actor: { select: { login: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconBell className="h-3 w-3" />
            Activity
          </span>
        }
        title="Notifications"
        description={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
            : "You're all caught up."
        }
        badge={
          unreadCount > 0 ? (
            <Badge tone="info">
              {unreadCount} unread
            </Badge>
          ) : undefined
        }
      />

      <NotificationInbox
        initialItems={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          resourceType: n.resourceType,
          resourceId: n.resourceId,
          actor: n.actor
            ? { login: n.actor.login, name: n.actor.name, avatarUrl: n.actor.avatarUrl }
            : null,
          context: safeParseContext(n.contextJson),
          readAt: n.readAt,
          createdAt: n.createdAt,
        }))}
        initialUnread={unreadCount}
      />
    </div>
  );
}

function safeParseContext(
  json: string,
): Record<string, string | number | boolean | null> {
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, string | number | boolean | null>;
    }
  } catch {
    // malformed context
  }
  return {};
}