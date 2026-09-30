import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MESSAGE_WINDOW } from "./constants";

/**
 * Reading a thread in windows.
 *
 * Two defects motivated this extraction.
 *
 * 1. The thread page asked for `orderBy: { createdAt: "asc" }` with a bare
 *    `take: 60`. A `take` with no `skip` returns the *first* N rows in that
 *    ordering, so a 500-message thread opened on messages 1-60 while the poll
 *    then spliced the newest 30 on top -- a disjointed view missing everything
 *    in between, under a header claiming 500 messages. The window has to be
 *    taken newest-first and then reversed for display.
 *
 * 2. Paging back used `where: { id: { lt: beforeId } }` while sorting on
 *    `createdAt`. Those are different orderings: `cuid()` embeds a millisecond
 *    timestamp plus a per-process counter, so under concurrent writers across
 *    instances `id` order and `createdAt` order genuinely disagree. A message
 *    could fail the `lt` test on page one yet fall before the page boundary,
 *    making it unreachable on every later page -- a permanent skip. A Prisma
 *    cursor is only sound when `id` is the *last* sort key, so the tiebreaker
 *    below is load-bearing rather than cosmetic, and it also makes two messages
 *    sharing a millisecond order deterministically.
 */

const messageInclude = {
  sender: { select: { id: true, login: true, name: true, avatarUrl: true } },
  // The epoch is half of the v2 AAD; the client cannot authenticate the
  // ciphertext without it.
  threadKey: { select: { epoch: true } },
} as const;

export type MessageRow = {
  id: string;
  senderId: string;
  senderLogin: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
  ciphertext: string;
  protocolVersion: string;
  clientMessageId: string;
  epoch: number;
  conversationId: string;
  createdAt: Date;
};

function toRow(m: {
  id: string;
  senderId: string;
  sender: { login: string; name: string | null; avatarUrl: string | null };
  ciphertext: string;
  protocolVersion: string;
  clientMessageId: string;
  threadKey: { epoch: number };
  conversationId: string;
  createdAt: Date;
}): MessageRow {
  return {
    id: m.id,
    senderId: m.senderId,
    senderLogin: m.sender.login,
    senderName: m.sender.name,
    senderAvatarUrl: m.sender.avatarUrl,
    ciphertext: m.ciphertext,
    protocolVersion: m.protocolVersion,
    clientMessageId: m.clientMessageId,
    epoch: m.threadKey.epoch,
    conversationId: m.conversationId,
    createdAt: m.createdAt,
  };
}

export type MessagePage = {
  /** Oldest-first, ready to render in order. */
  messages: MessageRow[];
  hasMore: boolean;
  /** Pass back as `beforeId` to fetch the next older page; null when exhausted. */
  nextBeforeId: string | null;
};

/**
 * Fetch one page of a thread, walking backwards from `beforeId`.
 *
 * `beforeId: null` reads the newest page. Results always come back oldest-first
 * so a caller can append or prepend without re-sorting.
 */
export async function fetchMessagePage(
  conversationId: string,
  beforeId: string | null,
  limit: number = MESSAGE_WINDOW,
): Promise<MessagePage> {
  let rows;
  try {
    rows = await prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One extra row answers "is there more?" exactly, rather than inferring it
      // from `length === limit` and hiding the final page when it came out full.
      take: limit + 1,
      ...(beforeId ? { cursor: { id: beforeId }, skip: 1 } : {}),
    });
  } catch (e) {
    // A cursor id that no longer exists (a deleted row) makes Prisma throw.
    // That is a recoverable client state, not a server fault, and it must not
    // reach the browser as an internal message.
    logger.warn("fetch-message-page-cursor-miss", {
      conversationId,
      error: String(e),
    });
    return { messages: [], hasMore: false, nextBeforeId: null };
  }

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return {
    messages: page.map(toRow),
    hasMore,
    // The page was just reversed to oldest-first for rendering, so the *first*
    // element is the oldest and is the row a `cursor` must resume from. Taking
    // the last element here would hand back the newest message of the page and
    // walk the conversation backwards into itself.
    nextBeforeId: hasMore ? (page[0]?.id ?? null) : null,
  };
}

/**
 * The newest `limit` messages of a thread, oldest-first.
 *
 * The first paint of every conversation goes through this, so the user always
 * opens on the most recent activity rather than the beginning of history.
 */
export async function fetchNewestMessageWindow(
  conversationId: string,
  limit: number = MESSAGE_WINDOW,
): Promise<MessagePage> {
  return fetchMessagePage(conversationId, null, limit);
}

/**
 * Count messages a reader can actually see.
 *
 * A bare `_count: { select: { messages: true } }` counts soft-deleted rows
 * while every message list filters `deletedAt: null`, so the header and the
 * conversation list could over-report and a conversation whose messages were
 * all deleted could keep a permanent unread dot.
 */
export async function countVisibleMessages(
  conversationId: string,
): Promise<number> {
  return prisma.message.count({ where: { conversationId, deletedAt: null } });
}
