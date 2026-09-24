import { describe, it, expect, vi } from "vitest";
import { createNotification, notifyConversationMessage, conversationNotificationHref } from "@/lib/notifications";

function makeTx() {
  const rows: Array<{
    id: string;
    userId: string;
    actorId: string | null;
    type: string;
    resourceType: string;
    resourceId: string;
    contextJson: string;
    readAt: Date | null;
    createdAt: Date;
  }> = [];
  let nextId = 1;

  const tx = {
    notification: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        const hit = rows.find(
          (r) =>
            (!where.userId || r.userId === where.userId) &&
            (!where.type || r.type === where.type) &&
            (!where.resourceType || r.resourceType === where.resourceType) &&
            (!where.resourceId || r.resourceId === where.resourceId),
        );
        return hit
          ? { id: hit.id, readAt: hit.readAt }
          : null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = {
          id: `n-${nextId++}`,
          ...data,
          readAt: (data.readAt as Date | null) ?? null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        };
        rows.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async () => {
        return { id: "updated" };
      }),
    },
  };

  return { tx, rows };
}

describe("createNotification (dedupe + re-arm)", () => {
  it("creates on first call", async () => {
    const { tx } = makeTx();
    const res = await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
      contextJson: { conversationId: "conv-1", teamId: "t-1" },
    });
    expect(res.created).toBe(true);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when an unread duplicate exists", async () => {
    const { tx } = makeTx();
    await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
    });
    const res = await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
    });
    expect(res.created).toBe(false);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    // The unread row is kept as-is (no re-arm update).
    expect(tx.notification.update).not.toHaveBeenCalled();
  });

  it("re-arms a read duplicate (clears readAt, bumps createdAt)", async () => {
    const { tx, rows } = makeTx();
    const first = await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
    });
    // Simulate the user reading it, then a duplicate event fires.
    rows[0].readAt = new Date();
    const updateSpy = tx.notification.update as ReturnType<typeof vi.fn>;
    updateSpy.mockResolvedValueOnce({ id: first.id });

    const res = await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
    });
    expect(res.created).toBe(false);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArg = updateSpy.mock.calls[0][0];
    expect(updateArg.data.readAt).toBeNull();
    expect(updateArg.data.createdAt).toBeInstanceOf(Date);
  });

  it("keys notifications independently per resource", async () => {
    const { tx } = makeTx();
    await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-1",
    });
    const res = await createNotification(tx as any, {
      userId: "u-1",
      actorId: "u-2",
      type: "message",
      resourceType: "conversation",
      resourceId: "conv-2",
    });
    expect(res.created).toBe(true);
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
  });
});

describe("notifyConversationMessage", () => {
  it("skips the sender and notifies everyone else once each", async () => {
    const { tx } = makeTx();
    await notifyConversationMessage(tx as any, {
      conversationId: "conv-1",
      teamId: "t-1",
      conversationKind: "team",
      senderId: "u-1",
      recipientIds: ["u-1", "u-2", "u-3"],
    });
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    const created = (tx.notification.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].data.userId,
    );
    expect(created).toEqual(["u-2", "u-3"]);
  });

  it("writes conversationId/teamId into contextJson for deep links", async () => {
    const { tx } = makeTx();
    await notifyConversationMessage(tx as any, {
      conversationId: "conv-9",
      teamId: "t-9",
      conversationKind: "team",
      senderId: "u-1",
      recipientIds: ["u-2"],
    });
    const ctx = JSON.parse(
      (tx.notification.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.contextJson,
    );
    expect(ctx).toEqual({ conversationId: "conv-9", teamId: "t-9" });
  });
});

describe("conversationNotificationHref", () => {
  it("resolves a conversation deep link from contextJson", () => {
    const href = conversationNotificationHref(
      JSON.stringify({ conversationId: "conv-1", teamId: "t-1" }),
    );
    expect(href).toBe("/dashboard/team/t-1/messaging/conv-1");
  });

  it("falls back to the inbox for empty or malformed context", () => {
    expect(conversationNotificationHref(null)).toBe("/dashboard/notifications");
    expect(conversationNotificationHref("{not-json")).toBe("/dashboard/notifications");
    expect(conversationNotificationHref(JSON.stringify({ teamId: "t-1" }))).toBe(
      "/dashboard/notifications",
    );
  });
});