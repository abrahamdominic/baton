import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { requireTeamMember } from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { IconSend } from "@/components/icons";
import { MessageThread } from "@/components/dashboard/message-thread";
import { fetchNewestMessageWindow } from "@/lib/messaging/thread-window";

export const dynamic = "force-dynamic";

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ teamId: string; conversationId: string }>;
}) {
  const { teamId, conversationId } = await params;
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireTeamMember(teamId, user.id).catch(() => ({
    role: "" as string,
  }));
  if (!role) notFound();

  const [conversation, initialMessages] = await Promise.all([
    prisma.conversation.findFirst({
      where: {
        id: conversationId,
        teamId,
        members: { some: { userId: user.id } },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, login: true, name: true, avatarUrl: true },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        // Exclude soft-deleted rows so the header cannot over-report.
        _count: { select: { messages: { where: { deletedAt: null } } } },
      },
    }),
    // The newest window, returned oldest-first so it renders in order. See
    // src/lib/messaging/thread-window.ts for why this is not a plain
    // `orderBy: asc, take: 60`.
    fetchNewestMessageWindow(conversationId),
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
        title={t("messaging:conversation_title")}
        description={t("messaging:conversation_description")}
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
        initialMessages={initialMessages.messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderLogin: m.senderLogin,
          senderName: m.senderName,
          senderAvatarUrl: m.senderAvatarUrl,
          ciphertext: m.ciphertext,
          protocolVersion: m.protocolVersion,
          clientMessageId: m.clientMessageId,
          epoch: m.epoch,
          conversationId: m.conversationId,
          createdAt: m.createdAt,
        }))}
        initialMessageCount={conversation._count.messages}
      />
    </div>
  );
}
