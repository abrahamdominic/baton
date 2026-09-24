"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser, requireTeamMember } from "@/lib/workspaces";
import {
  generateDeviceKeys,
  generateThreadKey,
  wrapThreadKeyForMember,
  fingerprintPublicKey,
} from "@/lib/messaging/crypto";

// Baton messaging server actions.
//
// Access control lives here, in the server layer, on top of the signed-in
// session — the same posture the house migrations carve out with RLS in
// Supabase (0001 just revokes anon/authenticated and lets the service role
// through; the *who-may-see-what* decision is made per-route behind
// requireTeamMember / requireOrganizationMember). Messaging is client-locked:
// the DB only ever holds ciphertext and per-member key wraps, never plaintext
// and never thread keys outside of wraps.

const createConversationInputSchema = z.object({
  teamId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1),
});

const sendMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  ciphertext: z.string().min(1),
  clientMessageId: z.string().min(1),
});

export type ConversationActionResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string };

export type MessageActionResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/** Create a team conversation, generate a client-locked thread key, and wrap
 * it for every invited member. The thread key never touches the DB. */
export async function createConversationAction(
  input: z.infer<typeof createConversationInputSchema>,
): Promise<ConversationActionResult> {
  const parsed = createConversationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid conversation input." };
  const { teamId, memberIds } = parsed.data;

  const me = await requireActiveUser();
  await requireTeamMember(teamId, me.id, "admin");

  // Every invited id must actually belong to the team before we wrap a thread
  // key for them — otherwise we'd wrap secrets for non-members.
  const invited = memberIds.filter((id) => id !== me.id);
  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId, userId: { in: invited } },
    select: { userId: true },
  });
  const validIds = new Set(teamMembers.map((t) => t.userId));
  if (invited.some((id) => !validIds.has(id))) {
    return { ok: false, error: "One or more invited users are not on this team." };
  }

  try {
    const [device, threadKey] = await Promise.all([
      generateDeviceKeys(),
      generateThreadKey(),
    ]);
    const fingerprint = await fingerprintPublicKey(device.publicKeyB64);

    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          teamId,
          createdById: me.id,
          members: {
            create: [{ userId: me.id, role: "owner" }, ...invited.map((userId) => ({ userId, role: "member" }))],
          },
        },
        select: { id: true },
      });

      // Register the creator's device key so the wrap rows can reference it.
      await tx.devicePublicKey.upsert({
        where: { userId_fingerprint: { userId: me.id, fingerprint } },
        update: { publicKeyB64: device.publicKeyB64 },
        create: { userId: me.id, fingerprint, publicKeyB64: device.publicKeyB64 },
      });

      const members = await tx.conversationMember.findMany({
        where: { conversationId: conv.id },
        select: { id: true, userId: true },
      });

      // Fresh epoch 1 thread key, active immediately; one wrap per member.
      await tx.conversationThreadKey.create({
        data: {
          conversationId: conv.id,
          epoch: 1,
          active: true,
          wraps: {
            create: await Promise.all(
              members.map(async (member) => {
                const dk = await tx.devicePublicKey.findFirst({
                  where: { userId: member.userId },
                  select: { id: true, publicKeyB64: true },
                });
                if (!dk) throw new Error("Missing device public key for member.");
                const wrapped = await wrapThreadKeyForMember({
                  threadKeyB64: threadKey,
                  theirPublicKeyB64: dk.publicKeyB64,
                  ourPrivateKeyB64: device.privateKeyB64,
                });
                return {
                  memberId: member.id,
                  publicKeyId: dk.id,
                  wrappedKeyB64: wrapped.wrappedKeyB64,
                };
              }),
            ),
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

/** Persist one encrypted message blob. The server never sees plaintext. */
export async function sendMessageAction(
  input: z.infer<typeof sendMessageInputSchema>,
): Promise<MessageActionResult> {
  const parsed = sendMessageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message input." };
  const { conversationId, ciphertext, clientMessageId } = parsed.data;

  const activeKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    select: { id: true },
  });
  if (!activeKey) return { ok: false, error: "No active thread key for this conversation." };

  const me = await requireActiveUser();
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: me.id },
    select: { id: true },
  });
  if (!member) {
    return { ok: false, error: "You are not a member of this conversation." };
  }

  try {
    const message = await prisma.message.create({
      data: { conversationId, senderId: me.id, threadKeyId: activeKey.id, ciphertext, clientMessageId },
      select: { id: true },
    });
    const convMeta = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { teamId: true },
    });
    if (convMeta?.teamId) revalidatePath(`/dashboard/team/${convMeta.teamId}/messaging`);
    return { ok: true, messageId: message.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
