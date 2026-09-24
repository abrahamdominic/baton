// Baton centralized notification helpers.
//
// Notifications are user-scoped inbox rows (Notification model) that point at a
// resource (message, conversation, PR, invite, billing, ...). This module owns
// the *authoring* side — deduped creation and deep-link resolution — so callers
// never hand-roll identity rules against the DB.
//
// Rules:
//   - One notification per (userId, type, resourceType, resourceId). Creating
//     again for the same resource is a no-op (dedupe). This keeps retries and
//     repeat events (e.g. several messages in one conversation) from spamming
//     the inbox.
//   - contextJson carries only ids/keys (teamId, conversationId, ...), never
//     message plaintext or any other content.
//   - Notifications are always attributed to an actor when known (the user who
//     caused them), never to a service.

import type { Prisma } from "@prisma/client";

export type NotificationType =
  | "message"
  | "mention"
  | "review"
  | "invite"
  | "system";

export type NotificationResourceType =
  | "message"
  | "conversation"
  | "pr"
  | "team_invite"
  | "org_invite"
  | "billing";

export interface NotificationDraft {
  userId: string;
  actorId: string | null;
  type: NotificationType;
  resourceType: NotificationResourceType;
  resourceId: string;
  contextJson?: Record<string, string | number | boolean | null>;
}

type Tx = Prisma.TransactionClient;

/**
 * Notification authorship with de-dupe + re-notify semantics.
 *
 * A notification is keyed by (userId, type, resourceType, resourceId). The
 * first create wins; a duplicate create for a still-unread notification is a
 * no-op. If a duplicate exists but the user has already read it, the row is
 * *re-armed* (readAt cleared, createdAt bumped) so repeat activity surfaces
 * again instead of being silently swallowed forever.
 */
export async function createNotification(
  tx: Tx,
  draft: NotificationDraft,
): Promise<{ created: boolean; id: string | null }> {
  const existing = await tx.notification.findFirst({
    where: {
      userId: draft.userId,
      type: draft.type,
      resourceType: draft.resourceType,
      resourceId: draft.resourceId,
    },
    select: { id: true, readAt: true },
  });
  if (existing) {
    if (existing.readAt === null) return { created: false, id: existing.id };
    await tx.notification.update({
      where: { id: existing.id },
      data: { readAt: null, createdAt: new Date(), contextJson: JSON.stringify(draft.contextJson ?? {}) },
    });
    return { created: false, id: existing.id };
  }

  const row = await tx.notification.create({
    data: {
      userId: draft.userId,
      actorId: draft.actorId,
      type: draft.type,
      resourceType: draft.resourceType,
      resourceId: draft.resourceId,
      contextJson: JSON.stringify(draft.contextJson ?? {}),
    },
    select: { id: true },
  });
  return { created: true, id: row.id };
}

/** One "message" notification per other conversation member, one per thread. */
export async function notifyConversationMessage(
  tx: Tx,
  input: {
    conversationId: string;
    teamId: string | null;
    conversationKind: string;
    senderId: string;
    recipientIds: string[];
  },
): Promise<void> {
  const hrefContext: Record<string, string | number | boolean | null> = {
    conversationId: input.conversationId,
  };
  if (input.teamId) hrefContext.teamId = input.teamId;

  for (const userId of input.recipientIds) {
    if (userId === input.senderId) continue;
    await createNotification(tx, {
      userId,
      actorId: input.senderId,
      type: "message",
      resourceType: "conversation",
      resourceId: input.conversationId,
      contextJson: hrefContext,
    });
  }
}

/** Resolve a conversation notification's deep link into the messaging thread. */
export function conversationNotificationHref(
  contextJson: string | null | undefined,
): string {
  if (!contextJson) return "/dashboard/notifications";
  try {
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    const conversationId = ctx.conversationId;
    const teamId = ctx.teamId;
    if (typeof conversationId === "string" && typeof teamId === "string") {
      return `/dashboard/team/${encodeURIComponent(teamId)}/messaging/${encodeURIComponent(conversationId)}`;
    }
  } catch {
    // malformed context — fall through to the inbox
  }
  return "/dashboard/notifications";
}