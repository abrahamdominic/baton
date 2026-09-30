/**
 * The single definition of "unread" for a conversation.
 *
 * This predicate was written three times: once in the conversation list, once
 * on the all-messages page, and once for the sidebar badge. The copies
 * disagreed on what to do when `lastMessageAt` is null -- one fell back to
 * `createdAt`, one treated null as unread, and one required non-null outright.
 * They only agreed by accident, because a conversation with messages always had
 * `lastMessageAt` set.
 *
 * The rule: a conversation is unread when it has at least one visible message
 * and the reader's last-read stamp predates the newest of them. With no messages
 * there is nothing to have read, so a null `lastMessageAt` is not unread.
 *
 * Soft-deleted messages must be excluded from the count by the caller; the
 * message list filters `deletedAt: null`, and a count that does not will show a
 * permanent unread dot for a conversation whose messages are all deleted.
 */
export function isConversationUnread(input: {
  /** Count of messages that are visible to the reader. */
  messageCount: number;
  /** The reader's own read receipt; null when never read. */
  lastReadAt: Date | null | undefined;
  /** Newest visible message time; null when the conversation is empty. */
  lastMessageAt: Date | null | undefined;
}): boolean {
  if (input.messageCount <= 0) return false;
  if (input.lastMessageAt === null || input.lastMessageAt === undefined)
    return false;
  if (input.lastReadAt === null || input.lastReadAt === undefined) return true;
  return input.lastReadAt.getTime() < input.lastMessageAt.getTime();
}
