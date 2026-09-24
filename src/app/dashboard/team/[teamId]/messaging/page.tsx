import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { requireTeamMember } from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IconInbox } from "@/components/icons";
import { ConversationList } from "@/components/dashboard/messaging";

export const dynamic = "force-dynamic";

export default async function TeamMessagingPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireTeamMember(teamId, user.id).catch(() => ({ role: "" as string }));
  if (!role) notFound();

  const conversations = await prisma.conversation.findMany({
    where: { teamId, members: { some: { userId: user.id } } },
    include: {
      members: { include: { user: { select: { id: true, login: true, name: true, avatarUrl: true } } } },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconInbox className="h-3 w-3" />
            Team Workspace
          </span>
        }
        title="Messaging"
        description="Messages are encrypted on your device before they reach Baton. The server stores only ciphertext and per-member key wraps — it never sees message contents or private keys."
      />

      <ConversationList
        conversations={conversations.map((c) => ({
          id: c.id,
          createdById: c.createdById,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          members: c.members.map((m) => ({
            userId: m.userId,
            login: m.user.login,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl,
            role: m.role,
          })),
          messageCount: c._count.messages,
          lastReadAt: c.members.find((m) => m.userId === user.id)?.lastReadAt ?? null,
        }))}
        teamId={teamId}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  );
}