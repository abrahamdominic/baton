import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { requireTeamMember } from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IconSend } from "@/components/icons";
import { MessageThread } from "@/components/dashboard/message-thread";

export const dynamic = "force-dynamic";

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ teamId: string; conversationId: string }>;
}) {
  const { teamId, conversationId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireTeamMember(teamId, user.id).catch(() => ({ role: "" as string }));
  if (!role) notFound();

  const [conversation, initialMessages] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: conversationId, teamId, members: { some: { userId: user.id } } },
      include: {
        members: {
          include: { user: { select: { id: true, login: true, name: true, avatarUrl: true } } },
          orderBy: { joinedAt: "asc" },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: {
        sender: { select: { id: true, login: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 60,
    }),
  ]);

  if (!conversation) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconSend className="h-3 w-3" />
            Team Workspace
          </span>
        }
        title="Conversation"
        description="Messages are encrypted on your device with a thread key the server never sees."
      />

      <MessageThread
        conversationId={conversationId}
        teamId={teamId}
        currentUserId={user.id}
        currentUserLogin={user.login}
        initialMembers={conversation.members.map((m) => ({
          userId: m.userId,
          login: m.user.login,
          name: m.user.name,
          avatarUrl: m.user.avatarUrl,
        }))}
        initialMessages={initialMessages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderLogin: m.sender.login,
          senderName: m.sender.name,
          senderAvatarUrl: m.sender.avatarUrl,
          ciphertext: m.ciphertext,
          protocolVersion: m.protocolVersion,
          clientMessageId: m.clientMessageId,
          createdAt: m.createdAt,
        }))}
        initialMessageCount={conversation._count.messages}
      />
    </div>
  );
}