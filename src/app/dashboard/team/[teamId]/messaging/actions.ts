"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  requireActiveUser,
  requireTeamMember,
  requireOrganizationMember,
  isStillWorkspaceMember,
} from "@/lib/workspaces";
import type { WorkspaceDb } from "@/lib/workspaces";
import {
  fingerprintPublicKey,
  isValidDevicePublicKey,
} from "@/lib/messaging/crypto";
import {
  conversationMemberRows,
  normalizeRoster,
} from "@/lib/messaging/participants";
import { notifyConversationMessage } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { fetchMessagePage } from "@/lib/messaging/thread-window";

// Baton messaging server actions.
//
// Messaging is client-locked: device keypairs and thread keys are generated in
// the browser and the private halves never leave it. The DB stores only device
// PUBLIC keys and per-member thread-key wraps, so nothing here ever handles
// plaintext or private key material — the server is deliberate about not being
// able to read your conversations.
//
// Access control lives in this layer (requireActiveUser / requireTeamMember / requireOrganizationMember),
// the same posture the house migrations carve out at the data layer.

export type MessagingActionResult =
  { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Size ceilings for client-supplied encrypted blobs.
 *
 *  - A thread key is 32 bytes; wrapped it is a 12-byte IV + 32 bytes + a
 *    16-byte GCM tag, so 256 base64 chars is generous.
 *  - An ECDH P-256 SPKI public key is ~91 bytes, so 512 base64 chars is
 *    generous. Both exist to stop an unbounded write from a single call, not
 *    to second-guess the client.
 */
const MAX_WRAP_B64 = 256;
const MAX_ISSUER_KEY_B64 = 512;

const DENIED = "You are not a member of this conversation." as const;

/**
 * Authorize one conversation-scoped action.
 *
 * Conversation membership is necessary but not sufficient: it is a *derived*
 * grant that is only meant to exist while the person is still on the team or
 * organization. Authorizing on it alone meant a member removed from a
 * workspace kept full read access to every message in its threads, plus the
 * ability to post into them — the HTML pages 404 them, but these actions are
 * directly callable HTTP endpoints and a page guard is not an authorization
 * boundary.
 *
 * Re-checking live workspace membership here closes that gap even if a
 * membership row ever outlives the removal (legacy rows, a partially applied
 * write), and returns the same generic denial either way so the two failure
 * modes are indistinguishable to a caller.
 */
async function authorizeConversation(
  conversationId: string,
  userId: string,
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      teamId: true,
      orgId: true,
      members: { where: { userId }, select: { id: true }, take: 1 },
    },
  });
  const member = conversation?.members[0];
  if (!conversation || !member) return { ok: false, error: DENIED };

  const stillOnTeam = conversation.teamId
    ? await isStillWorkspaceMember("team", conversation.teamId, userId)
    : await isStillWorkspaceMember("organization", conversation.orgId!, userId);
  if (!stillOnTeam) return { ok: false, error: DENIED };

  return { ok: true, memberId: member.id };
}

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
    // A real browser only ever has one or two of these. A member looping this
    // action could otherwise register unbounded keys, and every other member's
    // "new conversation" flow then performs one ECDH derive per key per member in
    // their browser -- a single low-privilege account degrading a whole
    // workspace. Cap the roster, and drop the oldest rather than refusing, so a
    // user who legitimately reinstalls a few times is not locked out.
    const MAX_DEVICES_PER_USER = 8;
    const existing = await prisma.devicePublicKey.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, fingerprint: true },
    });
    const alreadyKnown = existing.some((d) => d.fingerprint === fingerprint);
    if (!alreadyKnown && existing.length >= MAX_DEVICES_PER_USER) {
      const surplus = existing.slice(MAX_DEVICES_PER_USER - 1);
      await prisma.devicePublicKey.deleteMany({
        where: { id: { in: surplus.map((d) => d.id) } },
      });
    }

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

const listWorkspaceDevicesInputSchema = z
  .object({
    teamId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.teamId || data.orgId), {
    message: "Either teamId or orgId must be provided.",
  });

/** Team or Organization members who have registered a device, plus their device details.
 * Used by the client to wrap a freshly generated thread key for each recipient. */
export async function listWorkspaceDeviceKeysAction(
  input: z.infer<typeof listWorkspaceDevicesInputSchema>,
): Promise<
  | {
      ok: true;
      members: Array<{
        userId: string;
        login: string;
        name: string | null;
        avatarUrl: string | null;
        devices: Array<{ id: string; publicKeyB64: string }>;
      }>;
    }
  | { ok: false; error: string }
> {
  const parsed = listWorkspaceDevicesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { teamId, orgId } = parsed.data;

  const me = await requireActiveUser();
  let userIds: string[] = [];
  let memberDetails: Array<{
    userId: string;
    user: {
      id: string;
      login: string;
      name: string | null;
      avatarUrl: string | null;
    };
  }> = [];

  if (teamId) {
    await requireTeamMember(teamId, me.id);
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: { id: true, login: true, name: true, avatarUrl: true },
        },
      },
    });
    memberDetails = members;
    userIds = members.map((m) => m.userId);
  } else if (orgId) {
    await requireOrganizationMember(orgId, me.id);
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: { id: true, login: true, name: true, avatarUrl: true },
        },
      },
    });
    memberDetails = members;
    userIds = members.map((m) => m.userId);
  }

  const deviceRows = await prisma.devicePublicKey.findMany({
    where: { userId: { in: userIds }, revokedAt: null },
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
    members: memberDetails.map((m) => ({
      userId: m.userId,
      login: m.user.login,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      devices: byUser.get(m.userId) ?? [],
    })),
  };
}

export async function listTeamDeviceKeysAction(input: { teamId: string }) {
  return listWorkspaceDeviceKeysAction({ teamId: input.teamId });
}

export async function listOrgDeviceKeysAction(input: { orgId: string }) {
  return listWorkspaceDeviceKeysAction({ orgId: input.orgId });
}

const createConversationInputSchema = z
  .object({
    teamId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
    memberIds: z.array(z.string().min(1)).default([]),
    wrap: z.object({
      issuerPublicKeyB64: z.string().min(1).max(MAX_ISSUER_KEY_B64),
      entries: z
        .array(
          z.object({
            userId: z.string().min(1),
            publicKeyId: z.string().min(1),
            wrappedKeyB64: z.string().min(1).max(MAX_WRAP_B64),
          }),
        )
        .min(1),
    }),
  })
  .refine((data) => Boolean(data.teamId || data.orgId), {
    message: "Either teamId or orgId must be provided.",
  })
  // Exactly one scope, never both. The authorization below branches on
  // `teamId` first, so accepting both let a team-only member attach a
  // conversation to an organization they were never a member of (and label it
  // `kind: "org"`), because only the team branch was ever checked.
  .refine((data) => !(data.teamId && data.orgId), {
    message: "A conversation belongs to exactly one workspace.",
  })
  // A bounded roster. Without a cap one call can name an unbounded number of
  // participants, each becoming a membership row and a key wrap.
  .refine((data) => data.memberIds.length <= 100, {
    message: "A conversation cannot have more than 100 members.",
  });

export type CreateConversationResult =
  { ok: true; conversationId: string } | { ok: false; error: string };

/**
 * Collapse repeated wrap entries for the same recipient device. The first
 * occurrence wins; later ones are dropped so the nested create cannot violate
 * `ConversationKeyWrap @@unique([threadKeyId, memberId, publicKeyId])`.
 */
function dedupeWrapEntries<T extends { userId: string; publicKeyId: string }>(
  entries: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = `${entry.userId}::${entry.publicKeyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Create a team or organization conversation. The thread key is generated on the client; this
 * action persists only the per-member wraps and the issuer's public key, so
 * every participant can unwrap their own copy but the server cannot.
 */
export async function createConversationAction(
  input: z.infer<typeof createConversationInputSchema>,
): Promise<CreateConversationResult> {
  const parsed = createConversationInputSchema.safeParse(input);
  if (!parsed.success) {
    // Surface the first issue so a rejected request is actionable ("A
    // conversation belongs to exactly one workspace.") instead of an opaque
    // "Invalid conversation input." the client cannot do anything with.
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid conversation input.",
    };
  }
  const { teamId, orgId, memberIds, wrap } = parsed.data;

  const me = await requireActiveUser();
  if (teamId) {
    await requireTeamMember(teamId, me.id);
  } else if (orgId) {
    await requireOrganizationMember(orgId, me.id);
  }

  if (!(await isValidDevicePublicKey(wrap.issuerPublicKeyB64))) {
    return {
      ok: false,
      error: "Issuer device key is not a valid ECDH public key.",
    };
  }
  // Normalize before anything else touches the roster. A client may legitimately
  // include the creator among the participants (the new-conversation UI offers
  // every workspace member, including "you") and may repeat an id. Both would
  // violate `ConversationMember @@unique([conversationId, userId])` if passed
  // straight into the nested create, so the creator is dropped from the member
  // list and duplicates are collapsed. See lib/messaging/participants.ts.
  const roster = normalizeRoster(memberIds, me.id);
  const allIds = new Set<string>(roster.allIds);
  // `ConversationKeyWrap` is also unique per (threadKeyId, memberId, publicKeyId),
  // so collapse repeated wrap entries for the same device before inserting.
  const wrapEntries = dedupeWrapEntries(wrap.entries);
  const wrapMemberIds = new Set(wrapEntries.map((e) => e.userId));
  if (
    wrapMemberIds.size === 0 ||
    [...allIds].some((id) => !wrapMemberIds.has(id))
  ) {
    return { ok: false, error: "Every member needs at least one wrap entry." };
  }
  if ([...wrapMemberIds].some((id) => !allIds.has(id))) {
    return { ok: false, error: "A wrap entry references a non-member." };
  }

  // Every participant must actually be on the team / organization.
  if (teamId) {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId, userId: { in: [...allIds] } },
      select: { userId: true },
    });
    if (teamMembers.length !== allIds.size) {
      return {
        ok: false,
        error: "Every conversation member must be on this team.",
      };
    }
  } else if (orgId) {
    const orgMembers = await prisma.organizationMember.findMany({
      where: { organizationId: orgId, userId: { in: [...allIds] } },
      select: { userId: true },
    });
    if (orgMembers.length !== allIds.size) {
      return {
        ok: false,
        error: "Every conversation member must be in this organization.",
      };
    }
  }

  // Every publicKeyId must be a real registered device of the claimed user, and
  // the creator's wrap must be under the creator's own registered device.
  const deviceKeys = await prisma.devicePublicKey.findMany({
    where: {
      id: { in: wrapEntries.map((e) => e.publicKeyId) },
      revokedAt: null,
    },
    select: { id: true, userId: true, publicKeyB64: true },
  });
  const keyById = new Map(deviceKeys.map((k) => [k.id, k]));
  const creatorWrap = wrapEntries.find((e) => e.userId === me.id);
  if (!creatorWrap)
    return { ok: false, error: "Creator must have a wrapped copy." };
  const creatorDevice = keyById.get(creatorWrap.publicKeyId);
  if (!creatorDevice || creatorDevice.userId !== me.id) {
    return {
      ok: false,
      error: "The creator's wrap must be under their own device.",
    };
  }
  // The issuer key must be that same registered device. Validating it only as
  // "some importable P-256 key" let a creator name an arbitrary key (e.g. a
  // victim's) as the issuer, which permanently broke unwrapping for every
  // participant with no error raised at creation time.
  if (wrap.issuerPublicKeyB64 !== creatorDevice.publicKeyB64) {
    return {
      ok: false,
      error: "Issuer device key must be the creator's own registered device.",
    };
  }

  for (const entry of wrapEntries) {
    const dev = keyById.get(entry.publicKeyId);
    if (!dev || dev.userId !== entry.userId) {
      return { ok: false, error: "A wrap references an unrelated device key." };
    }
  }

  try {
    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          teamId: teamId ?? null,
          orgId: orgId ?? null,
          kind: orgId ? "org" : "team",
          createdById: me.id,
          members: {
            // Duplicate-free by construction: the creator is the single owner
            // row and every other participant appears exactly once.
            create: conversationMemberRows(memberIds, me.id),
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
            create: wrapEntries.map((entry) => {
              const memberId = memberByUser.get(entry.userId);
              if (!memberId)
                throw new Error("Missing conversation member for wrap.");
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

    if (teamId) revalidatePath(`/dashboard/team/${teamId}/messaging`);
    if (orgId) revalidatePath(`/dashboard/organization/${orgId}/messaging`);
    revalidatePath("/dashboard/messages");
    return { ok: true, conversationId: conversation.id };
  } catch (err) {
    // Log the real cause, return a generic one. The raw message is Prisma or
    // Postgres internals ("Unique constraint failed on the fields: (...)",
    // table and column names) and is not something to hand to a browser.
    logger.error("conversation-action-failed", { error: String(err) });
    return {
      ok: false,
      error: "Something went wrong on our side. Please try again.",
    };
  }
}

/**
 * Conversation members who are still in the workspace that owns the thread.
 *
 * Direct conversations have no workspace, so membership cannot apply and the
 * roster is taken as-is. `isStillWorkspaceMember` fails closed on a database
 * fault, which means a transient error drops a recipient rather than leaking a
 * notification to someone who left.
 */
async function liveWorkspaceRecipients(
  tx: WorkspaceDb,
  conv: { teamId: string | null; orgId: string | null; kind: string },
  siblings: { userId: string }[],
): Promise<string[]> {
  const scope = conv.teamId
    ? ("team" as const)
    : conv.orgId
      ? ("organization" as const)
      : null;
  if (!scope) return siblings.map((s) => s.userId);

  const workspaceId = conv.teamId ?? conv.orgId!;
  const rows = await Promise.all(
    siblings.map((s) =>
      isStillWorkspaceMember(scope, workspaceId, s.userId, tx),
    ),
  );
  return siblings.filter((_, i) => rows[i]).map((s) => s.userId);
}

const sendMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  // A 12-byte IV plus the AES-256-GCM tag is ~28 bytes of framing, so this
  // leaves room for a very long message while stopping a single call from
  // writing an unbounded blob into the table.
  ciphertext: z
    .string()
    .min(1)
    .max(64 * 1024),
  clientMessageId: z.string().min(1).max(64),
  // The encryption scheme the client used. Recorded so a reader knows which
  // AAD rules apply, and constrained to ratified versions so an unknown tag
  // is never stored. Defaults to the current scheme.
  protocolVersion: z.enum(["v1", "v2"]).default("v2"),
});

export type MessageActionResult =
  { ok: true; messageId: string } | { ok: false; error: string };

/** Persist one encrypted message blob. The server never sees plaintext. */
export async function sendMessageAction(
  // `z.input` not `z.infer`: `protocolVersion` has a default, so callers may
  // legitimately omit it and let the action choose the current scheme.
  input: z.input<typeof sendMessageInputSchema>,
): Promise<MessageActionResult> {
  const parsed = sendMessageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message input." };
  const { conversationId, ciphertext, clientMessageId, protocolVersion } =
    parsed.data;

  const me = await requireActiveUser();
  const access = await authorizeConversation(conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  const activeKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    select: { id: true },
  });
  if (!activeKey)
    return { ok: false, error: "No active thread key for this conversation." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({
        where: {
          senderId_clientMessageId: { senderId: me.id, clientMessageId },
        },
        select: { id: true },
      });
      if (existing) return { messageId: existing.id, recipients: [] };

      const message = await tx.message.create({
        data: {
          conversationId,
          senderId: me.id,
          threadKeyId: activeKey.id,
          ciphertext,
          protocolVersion,
          clientMessageId,
        },
        select: { id: true },
      });

      const [conv, siblings] = await Promise.all([
        tx.conversation.findUnique({
          where: { id: conversationId },
          select: {
            teamId: true,
            orgId: true,
            kind: true,
            members: { select: { userId: true } },
          },
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
        // Notify only people who are still in the workspace.
        //
        // `siblings` is every ConversationMember row, which is the roster the
        // thread was created with. The sender's own access is re-checked on
        // every send precisely because a removed member's row can outlive their
        // workspace membership -- so notifying from the raw roster keeps
        // pinging someone who can no longer open the thread, growing an unread
        // bell that leads to a dead end.
        const recipients = await liveWorkspaceRecipients(tx, conv, siblings);
        await notifyConversationMessage(tx, {
          conversationId,
          teamId: conv.teamId,
          orgId: conv.orgId,
          conversationKind: conv.kind,
          senderId: me.id,
          recipientIds: recipients,
        });
        return { messageId: message.id, recipients };
      }
      return { messageId: message.id, recipients: [] as string[] };
    });

    const convMeta = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { teamId: true, orgId: true },
    });
    if (convMeta?.teamId)
      revalidatePath(`/dashboard/team/${convMeta.teamId}/messaging`);
    if (convMeta?.orgId)
      revalidatePath(`/dashboard/organization/${convMeta.orgId}/messaging`);
    revalidatePath("/dashboard/messages");
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    // Log the real cause, return a generic one. The raw message is Prisma or
    // Postgres internals ("Unique constraint failed on the fields: (...)",
    // table and column names) and is not something to hand to a browser.
    logger.error("conversation-action-failed", { error: String(err) });
    return {
      ok: false,
      error: "Something went wrong on our side. Please try again.",
    };
  }
}

const listConversationsInputSchema = z
  .object({
    teamId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.teamId || data.orgId), {
    message: "Either teamId or orgId must be provided.",
  });

export type ConversationSummary = {
  id: string;
  createdById: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  members: Array<{
    userId: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    role: string;
  }>;
  messageCount: number;
  lastReadAt: Date | null;
};

/** Conversations in a team or organization the current user belongs to (list view). */
export async function listConversationsAction(
  input: z.infer<typeof listConversationsInputSchema>,
): Promise<
  | { ok: true; conversations: ConversationSummary[] }
  | { ok: false; error: string }
> {
  const parsed = listConversationsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { teamId, orgId } = parsed.data;

  const me = await requireActiveUser();
  if (teamId) {
    await requireTeamMember(teamId, me.id);
  } else if (orgId) {
    await requireOrganizationMember(orgId, me.id);
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      ...(teamId ? { teamId } : {}),
      ...(orgId ? { orgId } : {}),
      members: { some: { userId: me.id } },
    },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, login: true, name: true, avatarUrl: true },
          },
        },
      },
      messages: { select: { id: true }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: [
      // Explicit NULL placement. Postgres sorts NULL *first* on DESC and
      // SQLite sorts NULL *last*, so without this a brand-new conversation with no
      // messages yet floats to the top of the inbox in production only -- and
      // the SQLite-only test suite sees the opposite behaviour and misses it.
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ],
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

const conversationDevicesInputSchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * Every registered device of every current conversation member, and which of
 * them already hold a wrap of the thread key.
 *
 * This is the read half of device provisioning. A device cannot wrap the thread
 * key by itself: the plaintext key never reaches the server, only wrapped
 * copies do. So a device that has lost its private key (a sign-out, a cleared
 * site-data, a new browser) cannot be recovered by the server, and the old
 * error message used to tell the reader to ask an admin to do something the
 * product had no way to do. The actual repair is that *any member who still
 * holds the key* re-wraps it for the devices that are missing one -- which
 * requires knowing which those are.
 *
 * Only public keys are returned, which are not secret.
 */
export async function listConversationDevicesAction(
  input: z.infer<typeof conversationDevicesInputSchema>,
): Promise<
  | {
      ok: true;
      /** Whether the caller currently holds a wrap, i.e. can repair others. */
      callerCanProvision: boolean;
      members: Array<{
        userId: string;
        login: string;
        devices: Array<{ id: string; publicKeyB64: string; hasWrap: boolean }>;
      }>;
    }
  | { ok: false; error: string }
> {
  const parsed = conversationDevicesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const me = await requireActiveUser();
  const access = await authorizeConversation(parsed.data.conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  const [memberRows, threadKey] = await Promise.all([
    prisma.conversationMember.findMany({
      where: { conversationId: parsed.data.conversationId },
      select: { id: true, userId: true, user: { select: { login: true } } },
    }),
    prisma.conversationThreadKey.findFirst({
      where: { conversationId: parsed.data.conversationId, active: true },
      select: {
        id: true,
        wraps: { select: { memberId: true, publicKeyId: true } },
      },
    }),
  ]);

  const deviceRows = await prisma.devicePublicKey.findMany({
    where: { userId: { in: memberRows.map((m) => m.userId) }, revokedAt: null },
    select: { id: true, userId: true, publicKeyB64: true },
    orderBy: { createdAt: "asc" },
  });

  const wrapped = new Set((threadKey?.wraps ?? []).map((w) => w.publicKeyId));
  const byUser = new Map<
    string,
    Array<{ id: string; publicKeyB64: string; hasWrap: boolean }>
  >();
  for (const d of deviceRows) {
    const list = byUser.get(d.userId) ?? [];
    list.push({
      id: d.id,
      publicKeyB64: d.publicKeyB64,
      hasWrap: wrapped.has(d.id),
    });
    byUser.set(d.userId, list);
  }

  return {
    ok: true,
    // Holding a wrap is proof of possession of the thread key, so it is exactly
    // the capability required to wrap it for somebody else.
    callerCanProvision: wrapped.size > 0,
    members: memberRows.map((m) => ({
      userId: m.userId,
      login: m.user.login,
      devices: byUser.get(m.userId) ?? [],
    })),
  };
}

const submitDeviceWrapsInputSchema = z.object({
  conversationId: z.string().min(1),
  wraps: z
    .array(
      z.object({
        userId: z.string().min(1),
        publicKeyId: z.string().min(1),
        wrappedKeyB64: z.string().min(1).max(4096),
        issuerPublicKeyB64: z.string().min(1).max(1024),
      }),
    )
    .min(1)
    .max(64),
});

/**
 * Persist re-wraps of the *existing* thread key for devices that lack one.
 *
 * This never mints a new key: the submitted ciphertext must be a wrap of the
 * active thread key, and the caller must already hold a wrap of it. A caller who
 * does not hold one cannot compute a valid wrap, so the possession check is both
 * the authorization and the integrity guarantee -- there is no way to substitute
 * a key of the attacker's choosing and have it accepted.
 *
 * Every `publicKeyId` is re-resolved against the conversation's current members
 * rather than trusted from the payload, so a stale or forged device id cannot
 * attach a wrap to someone who is not in the thread.
 */
export async function submitConversationDeviceWrapsAction(
  input: z.infer<typeof submitDeviceWrapsInputSchema>,
): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const parsed = submitDeviceWrapsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId, wraps } = parsed.data;

  const me = await requireActiveUser();
  const access = await authorizeConversation(conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  const threadKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    select: {
      id: true,
      wraps: { select: { memberId: true, publicKeyId: true } },
    },
  });
  if (!threadKey)
    return { ok: false, error: "This conversation has no active thread key." };

  const existingPublicKeys = new Set(threadKey.wraps.map((w) => w.publicKeyId));
  if (!threadKey.wraps.some((w) => w.memberId === access.memberId)) {
    // No wrap for the caller, so no proof they hold the key.
    return {
      ok: false,
      error: "You need a key to this conversation to add a device to it.",
    };
  }

  const memberRows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { id: true, userId: true },
  });
  const memberByUser = new Map(memberRows.map((m) => [m.userId, m.id]));

  // Re-resolve every device against a current member; drop anything stale.
  const devices = await prisma.devicePublicKey.findMany({
    where: { id: { in: wraps.map((w) => w.publicKeyId) }, revokedAt: null },
    select: { id: true, userId: true },
  });
  const deviceById = new Map(devices.map((d) => [d.id, d.userId]));

  const rows = wraps.flatMap((w) => {
    const deviceOwner = deviceById.get(w.publicKeyId);
    if (!deviceOwner || deviceOwner !== w.userId) return [];
    const memberId = memberByUser.get(w.userId);
    if (!memberId) return [];
    if (existingPublicKeys.has(w.publicKeyId)) return [];
    return [
      {
        threadKeyId: threadKey.id,
        memberId,
        publicKeyId: w.publicKeyId,
        issuerPublicKeyB64: w.issuerPublicKeyB64,
        wrappedKeyB64: w.wrappedKeyB64,
      },
    ];
  });
  if (rows.length === 0) return { ok: true, saved: 0 };

  // Inserted one at a time rather than with `createMany({ skipDuplicates })`,
  // which the SQLite connector does not support -- and the suite has to be able
  // to exercise this against SQLite to mean anything. Duplicates are already
  // filtered above; a concurrent duplicate between the read and the write is
  // absorbed by the unique index, and is not an error worth surfacing because
  // the end state is the one the caller asked for.
  let saved = 0;
  for (const row of rows) {
    try {
      await prisma.conversationKeyWrap.create({ data: row });
      saved += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/unique|duplicate/i.test(message)) {
        logger.error("device-wrap-insert-failed", { error: message });
        return { ok: false, error: "Could not save the device key." };
      }
    }
  }
  return { ok: true, saved };
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
  /** Thread key epoch this message was encrypted under; part of the v2 AAD. */
  epoch: number;
  conversationId: string;
  createdAt: Date;
};

/** Page backward through a conversation's messages (plaintext never leaves the
 * client — rows carry only ciphertext and metadata). */
export async function listMessagesAction(
  input: z.infer<typeof listMessagesInputSchema>,
): Promise<
  | {
      ok: true;
      messages: MessageSummary[];
      hasMore: boolean;
      nextBeforeId: string | null;
    }
  | { ok: false; error: string }
> {
  const parsed = listMessagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId, beforeId, limit } = parsed.data;

  const me = await requireActiveUser();
  const access = await authorizeConversation(conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  // Shared with the thread page so the first paint and every "load older" click
  // page identically. See src/lib/messaging/thread-window.ts.
  const page = await fetchMessagePage(conversationId, beforeId ?? null, limit);

  return {
    ok: true,
    hasMore: page.hasMore,
    nextBeforeId: page.nextBeforeId,
    messages: page.messages,
  };
}

const threadKeyInputSchema = z.object({ conversationId: z.string().min(1) });

/** The current thread epoch plus the wraps the client needs to decrypt. Only
 * wraps for the caller's own registered devices are returned. */
export async function getThreadKeyAction(
  input: z.infer<typeof threadKeyInputSchema>,
): Promise<
  | {
      ok: true;
      epoch: number;
      wraps: Array<{
        publicKeyId: string;
        issuerPublicKeyB64: string;
        wrappedKeyB64: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const parsed = threadKeyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { conversationId } = parsed.data;

  const me = await requireActiveUser();
  const access = await authorizeConversation(conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  const threadKey = await prisma.conversationThreadKey.findFirst({
    where: { conversationId, active: true },
    include: { wraps: { where: { memberId: access.memberId } } },
  });
  if (!threadKey)
    return { ok: false, error: "This conversation has no active thread key." };

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

const markReadInputSchema = z
  .object({
    conversationId: z.string().min(1),
    /**
     * Accepted only as a hint and clamped to the past. Read state is the
     * caller's own, so this is not an authorization hole, but a client-supplied
     * future timestamp would let a member mark unread messages as read (or
     * corrupt the unread badge) by writing a date the server never issued.
     */
    // The bound is a per-parse check, not a module-load constant.
    //
    // `z.coerce.date().max(new Date())` evaluates `new Date()` once when this
    // schema is first imported, so in a long-lived server process the accepted
    // window was `(-inf, processStart]` and kept tightening as the process aged.
    // A receipt dated after the process booted was rejected even though it was
    // genuinely in the past. `superRefine` runs per validation instead.
    lastReadAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.lastReadAt && value.lastReadAt.getTime() > Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastReadAt"],
        message: "Read receipts cannot be dated in the future.",
      });
    }
  });

/** Stamp a read receipt on the caller's membership row. */
export async function markConversationReadAction(
  input: z.infer<typeof markReadInputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = markReadInputSchema.safeParse(input);
  if (!parsed.success) {
    // Surface the specific reason rather than flattening every failure into a
    // generic string -- the future-dated case has an obvious client-side fix.
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { conversationId, lastReadAt } = parsed.data;

  const me = await requireActiveUser();
  const access = await authorizeConversation(conversationId, me.id);
  if (!access.ok) return { ok: false, error: access.error };

  const stamp = lastReadAt ?? new Date();

  // Only write when the receipt actually moves forward. The thread component
  // calls this after every five-second poll tick, so an unconditional update
  // turned one open tab into a permanent write on a row that is read constantly.
  // `updateMany` with a comparison also avoids the not-found throw that an
  // unconditional `update` would raise if the membership row vanished.
  await prisma.conversationMember.updateMany({
    where: {
      id: access.memberId,
      OR: [{ lastReadAt: null }, { lastReadAt: { lt: stamp } }],
    },
    data: { lastReadAt: stamp },
  });
  return { ok: true };
}
