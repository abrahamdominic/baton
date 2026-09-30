import { describe, it, expect } from "vitest";
import { isConversationUnread } from "./unread";

/**
 * This predicate was written three times (conversation list, all-messages page,
 * sidebar badge) and the copies disagreed about a null `lastMessageAt`: one fell
 * back to `createdAt`, one treated null as unread, one required non-null. They
 * agreed only by accident.
 */
describe("isConversationUnread", () => {
  const t = (iso: string) => new Date(iso);

  it("is unread when the reader has never read and messages exist", () => {
    expect(
      isConversationUnread({
        messageCount: 3,
        lastReadAt: null,
        lastMessageAt: t("2026-01-01T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("is read when the receipt is newer than the newest message", () => {
    expect(
      isConversationUnread({
        messageCount: 3,
        lastReadAt: t("2026-01-02T00:00:00Z"),
        lastMessageAt: t("2026-01-01T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("is unread when a message arrived after the receipt", () => {
    expect(
      isConversationUnread({
        messageCount: 3,
        lastReadAt: t("2026-01-01T00:00:00Z"),
        lastMessageAt: t("2026-01-02T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("treats an equal timestamp as read, not unread", () => {
    // Strictly-greater is what makes the badge settle. A non-strict comparison
    // leaves the conversation permanently badged after one read.
    expect(
      isConversationUnread({
        messageCount: 1,
        lastReadAt: t("2026-01-01T00:00:00Z"),
        lastMessageAt: t("2026-01-01T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("is not unread when there are no visible messages", () => {
    // A conversation created but never posted to must not light the badge, even
    // though the server sets `createdAt` and leaves `lastReadAt` null.
    expect(
      isConversationUnread({
        messageCount: 0,
        lastReadAt: null,
        lastMessageAt: null,
      }),
    ).toBe(false);
  });

  it("is not unread when lastMessageAt is null despite a non-zero count", () => {
    // A deleted-everything conversation. There is no newest visible message to
    // be behind, so it is not unread.
    expect(
      isConversationUnread({
        messageCount: 4,
        lastReadAt: null,
        lastMessageAt: null,
      }),
    ).toBe(false);
  });

  it("is not unread for a negative count", () => {
    // Defensive: a bad count must not make an empty thread look unread.
    expect(
      isConversationUnread({
        messageCount: -1,
        lastReadAt: null,
        lastMessageAt: new Date(),
      }),
    ).toBe(false);
  });

  it("treats an undefined receipt the same as null", () => {
    expect(
      isConversationUnread({
        messageCount: 1,
        lastReadAt: undefined,
        lastMessageAt: t("2026-01-01T00:00:00Z"),
      }),
    ).toBe(true);
  });
});
