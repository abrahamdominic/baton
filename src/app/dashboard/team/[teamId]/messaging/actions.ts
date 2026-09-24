"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser, requireTeamMember } from "@/lib/workspaces";
import { fingerprintPublicKey, isValidDevicePublicKey } from "@/lib/messaging/crypto";
import { notifyConversationMessage } from "@/lib/notifications";

// Baton messaging server actions.
//
// Messaging is client-locked: device keypairs and thread keys are generated in
// the browser and the private halves never leave it. The DB stores only device
// PUBLIC keys and per-member thread-key wraps, so nothing here ever handles
// plaintext or private key material — the server is deliberate about not being
// able to read your conversations.
//
// Access control lives in this layer (requireActiveUser / requireTeamMember),
// the same posture the house migrations carve out at the data layer.

export type MessagingActionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const registerDeviceInputSchema = z.object({
  publicKeyB64: z.string().min(1),
});

export type RegisterDeviceResult =
  | { ok: true; deviceKeyId: string; fingerprint: string }
  | { ok: false; error: string };

/** Register one of the current user's client-generated ECDH device public keys. */
export async function registerDeviceKeyAction(
  input: z.infer<typeof registerDeviceInputSchema>,
): Promise<RegisterDeviceResult> {
  const parsed = registerDeviceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid device key input." };
  const { publicKeyB64 } = parsed.data;

  if (!(await isValidDevicePublicKey(publicKeyB64))) {
    return { ok: false, error: "Not a valid ECDH P-256 public key." };
  }

  const me = await requireActiveUser();
  const fingerprint = await fingerprintPublicKey(publicKeyB64);

  try {
    const device = await prisma.devicePublicKey.upsert({
      where: { userId_fingerprint: { userId: me.id, fingerprint } },
      update: { publicKeyB64, revokedAt: null },
      create: { userId: me.id, fingerprint, publicKeyB64 },
      select: { id: true },
    });
    return { ok: true, deviceKeyId: device.id, fingerprint };
  } catch {
    return { ok: false, error: "Could not register device key." };
  }
}

const listMemberDevicesInputSchema = z.object({ teamId: z.string().min(1) });

/** Team members who have registered a device, plus their device details. Used
 * by the client to wrap a freshly generated thread key for each recipient. */
export async function listTeamDeviceKeysAction(
  input: z.infer<typeof listMemberDevicesInputSchema>,
): Promise<
  | { ok: true; members: Array<{ userId: string; login: string; name: string | null; avatarUrl: string | null; devices: Array<{ id: string; publicKeyB64: string }> }> }
  | { ok: false; error: string }
> {
  const parsed = listMemberDevicesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { teamId } = parsed.data;

  const me = await requireActiveUser();
  await requireTeamMember(teamId, me.id);

  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: {
      user: { select: { id: true, login: true, name: true, avatarUrl: true } },
    },
  });
  const deviceRows = await prisma.devicePublicKey.findMany({
    where: { userId: { in: members.map((m) => m.userId) }, revokedAt: null },
    select: { id: true, userId: true, publicKeyB64: true },
    orderBy: { createdAt: "asc" },
  });

  const byUser = new Map<string, { id: string; publicKeyB64: string }[]>();
  for (const d of deviceRows) {
    const list = byUser.get(d.userId) ?? [];
    list.push({ id: d.id, publicKeyB64: d.publicKeyB64 });
    byUser.set(d.userId, list);
  }

  return {
    ok: true,
    members: members.map((m) => ({
      userId: m.userId,
      login: m.user.login,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      devices: byUser.get(m.userId) ?? [],
    })),
  };
}

const createConversationInputSchema = z.object({
  teamId: z.string().min(1),
  // userIds to include (besides the creator, who is always a member/owner).
  memberIds: z.array(z.string().min(1)).default([]),
  // Client-produced wraps: one per participant (including the creator).
  // The server can hold wraps but never the thread key.
  wrap: z.object({
    issuerPublicKeyB64: z.string().min(1),
    // memberUserId -> wrappedKey (already under that member's public key)
    entries: z
      .array(
        z.object({
          userId: z.string().min(1),
          publicKeyId: z.string().min(1),
          wrappedKeyB64: z.string().min(1),
        }),
      )
      .min(1),
  }),
});

export type CreateConversationResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string };

/**
 * Create a team conversation. The thread key is generated on the client; this
 * action persists only the per-member wraps and the issuer's public key, so
 * every participant can unwrap their own copy but the server cannot.
 */
export async function createConversationAction(
  input: z.infer<typeof createConversationInputSchema>,
): Promise<CreateConversationResult> {
  const parsed = createConversationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid conversation input." };
  const { teamId, memberIds, wrap } = parsed.data;

  const me = await requireActiveUser();
  // Any current team member may start a conversation with fellow members.
  // Participant membership is verified again below; the client never chooses
  // a sender or bypasses the team boundary.
  await requireTeamMember(teamId, me.id);

  if (!(await isValidDevicePublicKey(wrap.issuerPublicKeyB64))) {
    return { ok: false, error: "Issuer device key is not a valid ECDH public key." };
  }
  const allIds = new Set<string>([me.id, ...memberIds]);
  const wrapMemberIds = new Set(wrap.entries.map((e) => e.userId));
  if (wrapMemberIds.size === 0 || [...allIds].some((id) => !wrapMemberIds.has(id))) {
    return { ok: false, error: "Every member needs at least one wrap entry." };
  }
  if ([...wrapMemberIds].some((id) => !allIds.has(id))) {
    return { ok: false, error: "A wrap entry references a non-member." };
  }

  // Every participant must actually be on the team.
  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId, userId: { in: [...allIds] } },
    select: { userId: true },
  });
  if (teamMembers.length !== allIds.size) {
    return { ok: false, error: "Every conversation member must be on this team." };
  }

  // Every publicKeyId must be a real registered device of the claimed user, and
  // the creator's wrap must be under the creator's own registered device.
  const deviceKeys = await prisma.devicePublicKey.findMany({
    where: {
      id: { in: wrap.entries.map((e) => e.publicKeyId) },
      revokedAt: null,
    },
    select: { id: true, userId: true, publicKeyB64: true },
  });
  const keyById = new Map(deviceKeys.map((k) => [k.id, k]));
  const creatorWrap = wrap.entries.find((e) => e.userId === me.id);
  if (!creatorWrap) return { ok: false, error: "Creator must have a wrapped copy." };
  const creatorDevice = keyById.get(creatorWrap.publicKeyId);
  if (!creatorDevice || creatorDevice.userId !== me.id) {
    return { ok: false, error: "The creator's wrap must be under their own device." };
  }

  for (const entry of wrap.entries) {
    const dev = keyById.get(entry.publicKeyId);
    if (!dev || dev.userId !== entry.userId) {
      return { ok: false, error: "A wrap references an unrelated device key." };
    }
  }

  try {
    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          teamId,
          createdById: me.id,
          members: {
            create: [
              { userId: me.id, role: "owner" },
              ...memberIds.map((userId) => ({ userId, role: "member" })),
            ],
          },
        },
        select: { id: true },
      });

      const memberRows = await tx.conversationMember.findMany({
        where: { conversationId: conv.id },
        select: { id: true, userId: true },
      });
      const memberByUser = new Map(memberRows.map((m) => [m.userId, m.id]));

      await tx.conversationThreadKey.create({
        data: {
          conversationId: conv.id,
          epoch: 1,
          active: true,
          wraps: {
            create: wrap.entries.map((entry) => {
              const memberId = memberByUser.get(entry.userId);
              if (!memberId) throw new Error("Missing conversation member for wrap.");
              return {
                memberId,
                publicKeyId: entry.publicKeyId,
                issuerPublicKeyB64: wrap.issuerPublicKeyB64,
                wrappedKeyB64: entry.wrappedKeyB64,
              };
            }),
          },
        },
      });

      return conv;
    });

    revalidatePath(`/dashboard/team/${teamId}/messaging`);
    return { ok: true, conversationId: conversation.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

const sendMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  ciphertext: z.string().min(1),
  clientMessageId: z.string().min(1),
});

export type MessageActionResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/** Persist one encrypted message blob. The server never sees plaintext. */
export async function sendMessageAction(
  input: z.infer<typeof sendMessageInputSchema>,
): Promise<MessageActionResult> {
  const parsed = sendMessageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message input." };
  const { conversationId, ciphertext, clientMessageId } = parsed.data;

  const me = await requireActiveUser();
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: me.id },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "You are not a member of this conversation." };

  const activeKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    select: { id: true },
  });
  if (!activeKey) return { ok: false, error: "No active thread key for this conversation." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({
        where: { senderId_clientMessageId: { senderId: me.id, clientMessageId } },
        select: { id: true },
      });
      if (existing) return { messageId: existing.id, recipients: [] };

      const message = await tx.message.create({
        data: {
          conversationId,
          senderId: me.id,
          threadKeyId: activeKey.id,
          ciphertext,
          protocolVersion: "v1",
          clientMessageId,
        },
        select: { id: true },
      });

      const [conv, siblings] = await Promise.all([
        tx.conversation.findUnique({
          where: { id: conversationId },
          select: { teamId: true, kind: true, members: { select: { userId: true } } },
        }),
        tx.conversationMember.findMany({
          where: { conversationId },
          select: { userId: true },
        }),
      ]);

      if (conv) {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });
        await notifyConversationMessage(tx, {
          conversationId,
          teamId: conv.teamId,
          conversationKind: conv.kind,
          senderId: me.id,
          recipientIds: siblings.map((s) => s.userId),
        });
      }
      return { messageId: message.id, recipients: siblings.map((s) => s.userId) };
    });

    const convMeta = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { teamId: true },
    });
    if (convMeta?.teamId) revalidatePath(`/dashboard/team/${convMeta.teamId}/messaging`);
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

const listConversationsInputSchema = z.object({ teamId: z.string().min(1) });

export type ConversationSummary = {
  id: string;
  createdById: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  members: Array<{ userId: string; login: string; name: string | null; avatarUrl: string | null; role: string }>;
  messageCount: number;
  lastReadAt: Date | null;
};

/** Conversations in a team the current user belongs to (list view). */
export async function listConversationsAction(
  input: z.infer<typeof listConversationsInputSchema>,
): Promise<{ ok: true; conversations: ConversationSummary[] } | { ok: false; error: string }> {
  const parsed = listConversationsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { teamId } = parsed.data;

  const me = await requireActiveUser();
  await requireTeamMember(teamId, me.id);

  const conversations = await prisma.conversation.findMany({
    where: { teamId, members: { some: { userId: me.id } } },
    include: {
      members: {
        include: { user: { select: { id: true, login: true, name: true, avatarUrl: true } } },
      },
      messages: { select: { id: true }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return {
    ok: true,
    conversations: conversations.map((c) => {
      const myMembership = c.members.find((m) => m.userId === me.id);
      return {
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
        lastReadAt: myMembership?.lastReadAt ?? null,
      };
    }),
  };
}

const listMessagesInputSchema = z.object({
  conversationId: z.string().min(1),
  beforeId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export type MessageSummary = {
  id: string;
  senderId: string;
  senderLogin: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
  ciphertext: string;
  protocolVersion: string;
  clientMessageId: string;
  createdAt: Date;
};

/** Page backward through a conversation's messages (plaintext never leaves the
 * client — rows carry only ciphertext and metadata). */
export async function listMessagesAction(
  input: z.infer<typeof listMessagesInputSchema>,
): Promise<{ ok: true; messages: MessageSummary[]; hasMore: boolean } | { ok: false; error: string }> {
  const parsed = listMessagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId, beforeId, limit } = parsed.data;

  const me = await requireActiveUser();
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: me.id },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "You are not a member of this conversation." };

  const messages = await prisma.message.findMany({
    where: { conversationId, deletedAt: null, ...(beforeId ? { id: { lt: beforeId } } : {}) },
    include: {
      sender: { select: { id: true, login: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return {
    ok: true,
    messages: messages.reverse().map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderLogin: m.sender.login,
      senderName: m.sender.name,
      senderAvatarUrl: m.sender.avatarUrl,
      ciphertext: m.ciphertext,
      protocolVersion: m.protocolVersion,
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt,
    })),
    hasMore: messages.length === limit,
  };
}

const threadKeyInputSchema = z.object({ conversationId: z.string().min(1) });

/** The current thread epoch plus the wraps the client needs to decrypt. Only
 * wraps for the caller's own registered devices are returned. */
export async function getThreadKeyAction(
  input: z.infer<typeof threadKeyInputSchema>,
): Promise<{ ok: true; epoch: number; wraps: Array<{ publicKeyId: string; issuerPublicKeyB64: string; wrappedKeyB64: string }> } | { ok: false; error: string }> {
  const parsed = threadKeyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId } = parsed.data;

  const me = await requireActiveUser();
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: me.id },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "You are not a member of this conversation." };

  const threadKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    include: { wraps: { where: { memberId: member.id } } },
  });
  if (!threadKey) return { ok: false, error: "This conversation has no active thread key." };

  return {
    ok: true,
    epoch: threadKey.epoch,
    wraps: threadKey.wraps.map((w) => ({
      publicKeyId: w.publicKeyId,
      issuerPublicKeyB64: w.issuerPublicKeyB64,
      wrappedKeyB64: w.wrappedKeyB64,
    })),
  };
}

const markReadInputSchema = z.object({
  conversationId: z.string().min(1),
  lastReadAt: z.coerce.date().optional(),
});

/** Stamp a read receipt on the caller's membership row. */
export async function markConversationReadAction(
  input: z.infer<typeof markReadInputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = markReadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId, lastReadAt } = parsed.data;

  const me = await requireActiveUser();
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: me.id },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "You are not a member of this conversation." };

  await prisma.conversationMember.update({
    where: { id: member.id },
    data: { lastReadAt: lastReadAt ?? new Date() },
  });
  return { ok: true };
}
