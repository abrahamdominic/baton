"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/workspaces";

// Baton notification inbox actions. Notifications are user-scoped rows pointing
// at a resource (message, conversation, PR, invite, billing). Clients mark them
// read through these actions; writing is done by server-side features through
// src/lib/notifications.ts so dedupe + deep links stay consistent.

export type NotificationActionError = { ok: false; error: string };

export type NotificationItem = {
  id: string;
  type: string;
  resourceType: string;
  resourceId: string;
  actor: { login: string; name: string | null; avatarUrl: string | null } | null;
  context: Record<string, string | number | boolean | null>;
  readAt: Date | null;
  createdAt: Date;
};

const listInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  cursor: z.string().optional(),
});

/** Most-recent notifications for the current user, newest first. */
export async function listNotificationsAction(
  input: z.infer<typeof listInputSchema>,
): Promise<{ ok: true; items: NotificationItem[]; hasMore: boolean } | NotificationActionError> {
  const parsed = listInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { limit, cursor } = parsed.data;

  const me = await requireActiveUser();

  const rows = await prisma.notification.findMany({
    where: { userId: me.id, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: {
      actor: { select: { login: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      actor: r.actor
        ? { login: r.actor.login, name: r.actor.name, avatarUrl: r.actor.avatarUrl }
        : null,
      context: safeParseContext(r.contextJson),
      readAt: r.readAt,
      createdAt: r.createdAt,
    })),
    hasMore: rows.length === limit,
  };
}

/** Unread-count badge for the app-shell bell. */
export async function unreadNotificationsAction(): Promise<
  { ok: true; count: number } | NotificationActionError
> {
  try {
    const me = await requireActiveUser();
    const count = await prisma.notification.count({
      where: { userId: me.id, readAt: null },
    });
    return { ok: true, count };
  } catch {
    return { ok: false, error: "Could not load notification count." };
  }
}

const markReadSchema = z.object({ id: z.string().min(1) });

/** Mark a single notification read (owner only). */
export async function markNotificationReadAction(
  input: z.infer<typeof markReadSchema>,
): Promise<{ ok: true } | NotificationActionError> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { id } = parsed.data;

  const me = await requireActiveUser();
  const existing = await prisma.notification.findFirst({
    where: { id, userId: me.id },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Notification not found." };

  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  revalidatePath("/dashboard/notifications");
  return { ok: true };
}

/** Mark every one of the current user's notifications read. */
export async function markAllNotificationsReadAction(): Promise<
  { ok: true } | NotificationActionError
> {
  const me = await requireActiveUser();
  await prisma.notification.updateMany({
    where: { userId: me.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notifications");
  return { ok: true };
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
    // malformed context — fall through
  }
  return {};
}