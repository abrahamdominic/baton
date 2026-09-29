import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Messaging authorization and input-hardening matrix.
 *
 * Prisma is replaced with a small in-memory fixture that enforces the same
 * unique constraints the real schema declares, so a regression that would
 * produce a `PrismaClientKnownRequestError` (P2002) fails here the same way it
 * would in production. `requireActiveUser` / `requireTeamMember` are stubbed so
 * each test can state exactly which principal is calling.
 */

type Row = Record<string, unknown>;

/**
 * The whole fake database lives in one `vi.hoisted` block because `vi.mock`
 * factories are hoisted above module-level `const`s, and the Prisma mock needs
 * to close over the same fixture the tests assert against.
 */
const { db, auth, prisma } = vi.hoisted(() => {
  const db = {
    teamMembers: [] as Row[],
    orgMembers: [] as Row[],
    devices: [] as Row[],
    members: [] as Row[],
    conversations: [] as Row[],
    threadKeys: [] as Row[],
    wraps: [] as Row[],
    messages: [] as Row[],
    seq: 0,
    /** P2002 codes raised while the test runs, to prove a constraint held. */
    uniqueViolations: [] as string[],
    notifyCalls: 0,
  };

  const auth = {
    user: { id: "user-me", login: "me", name: "Me", email: null, avatarUrl: null, role: "user" } as Row | null,
    teamAllowed: true,
    orgAllowed: true,
    requireActiveUserThrows: false,
  };

  /**
   * Read the value at a dotted Prisma filter path (e.g. `where["userId.in"]`)
   * without losing types on optional segments.
   */
  function nested(obj: Row | undefined, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => (acc as Row | undefined)?.[key], obj ?? {});
  }

  function nextId(prefix: string): string {
    db.seq += 1;
    return `${prefix}-${db.seq}`;
  }

  /** Reproduce Prisma's P2002 so a duplicate insert surfaces as a real failure. */
  function assertUnique(fields: string[], existing: Row[], incoming: Row) {
    for (const row of existing) {
      if (fields.every((f) => row[f] === incoming[f])) {
        db.uniqueViolations.push(fields.join("+"));
        throw new Error(`P2002: Unique constraint failed on the fields: (${fields.join(",")})`);
      }
    }
  }

  const tx = {
    conversation: {
      create: async ({ data, select }: { data: Row; select: Row }) => {
        const id = nextId("conv");
        const members = (data.members as { create: Row[] }).create.map((m) => ({
          id: nextId("cm"),
          conversationId: id,
          lastReadAt: null,
          ...m,
        }));
        // @@unique([conversationId, userId])
        assertUnique(["conversationId", "userId"], db.members, members[0]);
        db.conversations.push({
          id,
          lastMessageAt: null,
          teamId: null,
          orgId: null,
          kind: "team",
          ...data,
          members: undefined,
        });
        db.members.push(...members);
        return select?.id ? { id } : { id };
      },
      update: async ({ where }: { where: Row }) => {
        const conv = db.conversations.find((c) => c.id === where.id);
        if (!conv) throw new Error("Conversation not found");
        return conv;
      },
      findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
        const conv = db.conversations.find((c) => c.id === where.id);
        if (!conv) return null;
        // Honor a filtered nested relation. The actions rely on
        // `members: { where: { userId } }` to answer "is this person in this
        // conversation", so an unfiltered stub would silently authorize.
        const memberFilter = select ? nested(select, "members.where.userId") : undefined;
        const members = db.members.filter(
          (m) =>
            m.conversationId === conv.id &&
            (memberFilter ? m.userId === memberFilter : true),
        );
        return { ...conv, members };
      },
      findMany: async ({ where, include }: { where: Row; include?: Row }) => {
        const withUser = Boolean(nested(include, "members.include"));
        return db.conversations
          .filter((c) => (where.teamId ? c.teamId === where.teamId : true))
          .filter((c) => (where.orgId ? c.orgId === where.orgId : true))
          .filter((c) => {
            const want = nested(where, "members.some.userId") as string | undefined;
            if (!want) return true;
            return db.members.some((m) => m.conversationId === c.id && m.userId === want);
          })
          .map((c) => {
            const rows = db.members.filter((m) => m.conversationId === c.id);
            return {
              ...c,
              members: withUser
                ? rows.map((m) => ({
                    ...m,
                    user: { id: m.userId, login: m.userId, name: null, avatarUrl: null },
                  }))
                : rows,
              _count: {
                messages: db.messages.filter((m) => m.conversationId === c.id).length,
              },
            };
          });
      },
    },
    conversationMember: {
      findMany: async ({ where }: { where: Row }) =>
        db.members.filter((m) => {
          if (where.conversationId && m.conversationId !== where.conversationId) return false;
          const want = nested(where, "userId.in") as string[] | undefined;
          if (want && !want.includes(m.userId as string)) return false;
          return true;
        }),
      findFirst: async ({ where }: { where: Row }) =>
        db.members.find(
          (m) =>
            (!where.conversationId || m.conversationId === where.conversationId) &&
            (!where.userId || m.userId === where.userId),
        ) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const m = db.members.find((x) => x.id === where.id);
        if (!m) throw new Error("Member not found");
        Object.assign(m, data);
        return m;
      },
    },
    conversationThreadKey: {
      create: async ({ data }: { data: Row }) => {
        const id = nextId("ctk");
        for (const e of (data.wraps as { create: Row[] }).create) {
          // @@unique([threadKeyId, memberId, publicKeyId])
          const probe = {
            threadKeyId: id,
            memberId: e.memberId,
            publicKeyId: e.publicKeyId,
          };
          assertUnique(["threadKeyId", "memberId", "publicKeyId"], db.wraps, probe);
          db.wraps.push({ id: nextId("wrap"), ...probe, ...e });
        }
        db.threadKeys.push({
          id,
          conversationId: data.conversationId,
          epoch: data.epoch,
          active: data.active,
        });
        return { id };
      },
      findFirst: async ({ where, include }: { where: Row; include?: Row }) => {
        void include;
        const k = db.threadKeys.find(
          (x) =>
            (!where.conversationId || x.conversationId === where.conversationId) &&
            (!where.active || x.active),
        );
        if (!k) return null;
        const onlyMember = nested(include, "wraps.where.memberId") as string | undefined;
        return {
          ...k,
          wraps: db.wraps
            .filter((w) => w.threadKeyId === k.id)
            .filter((w) => !onlyMember || w.memberId === onlyMember)
            .map((w) => ({ ...w })),
        };
      },
    },
    message: {
      findUnique: async ({ where }: { where: Row }) => {
        const s = nested(where, "senderId_clientMessageId") as Row;
        return (
          db.messages.find(
            (m) => m.senderId === s.senderId && m.clientMessageId === s.clientMessageId,
          ) ?? null
        );
      },
      create: async ({ data, select }: { data: Row; select: Row }) => {
        const id = nextId("msg");
        db.messages.push({ id, deletedAt: null, ...data });
        return select?.id ? { id } : { id };
      },
      findMany: async ({ where, take }: { where: Row; take: number }) => {
        let rows = db.messages.filter(
          (m) => m.conversationId === where.conversationId && !m.deletedAt,
        );
        const before = nested(where, "id.lt") as string | undefined;
        if (before) rows = rows.filter((m) => (m.id as string) < before);
        rows = rows.reverse();
        return rows
          .slice(0, take)
          .map((m) => ({ ...m, sender: { id: m.senderId, login: "me", name: "Me", avatarUrl: null } }));
      },
    },
  };

  const prisma = {
    teamMember: {
      findMany: async ({ where }: { where: Row }) => {
        const ids = nested(where, "userId.in") as string[] | undefined;
        return db.teamMembers
          .filter((m) => m.teamId === where.teamId)
          .filter((m) => !ids || ids.includes(m.userId as string))
          .map((m) => ({
            ...m,
            user: { id: m.userId, login: m.userId, name: null, avatarUrl: null },
          }));
      },
    },
    organizationMember: {
      findMany: async ({ where }: { where: Row }) => {
        const ids = nested(where, "userId.in") as string[] | undefined;
        return db.orgMembers
          .filter((m) => m.organizationId === where.organizationId)
          .filter((m) => !ids || ids.includes(m.userId as string))
          .map((m) => ({
            ...m,
            user: { id: m.userId, login: m.userId, name: null, avatarUrl: null },
          }));
      },
    },
    devicePublicKey: {
      findMany: async ({ where }: { where: Row }) => {
        const ids = nested(where, "id.in") as string[] | undefined;
        const userIds = nested(where, "userId.in") as string[] | undefined;
        return db.devices.filter(
          (d) =>
            (!ids || ids.includes(d.id as string)) &&
            (where.revokedAt === null ? d.revokedAt === null : true) &&
            (!userIds || userIds.includes(d.userId as string)),
        );
      },
      upsert: vi.fn(),
    },
    conversation: tx.conversation,
    conversationMember: tx.conversationMember,
    conversationThreadKey: tx.conversationThreadKey,
    message: tx.message,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return { db, auth, prisma };
});

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/workspaces", () => ({
  requireActiveUser: async () => {
    if (auth.requireActiveUserThrows || !auth.user) throw new Error("Not authenticated");
    return auth.user;
  },
  requireTeamMember: async (teamId: string, userId: string) => {
    if (!auth.teamAllowed) throw new Error("Not a team member");
    const ok = db.teamMembers.some((m) => m.teamId === teamId && m.userId === userId);
    if (!ok) throw new Error("Not a team member");
  },
  requireOrganizationMember: async (orgId: string, userId: string) => {
    if (!auth.orgAllowed) throw new Error("Not an organization member");
    const ok = db.orgMembers.some((m) => m.organizationId === orgId && m.userId === userId);
    if (!ok) throw new Error("Not an organization member");
  },
  // Live workspace membership, re-checked on every conversation action so a
  // member removed from the team/org loses access even if a conversation
  // membership row outlives the removal. Backed by the same fixtures.
  isStillWorkspaceMember: async (
    kind: "team" | "organization",
    workspaceId: string,
    userId: string,
  ) =>
    kind === "team"
      ? db.teamMembers.some((m) => m.teamId === workspaceId && m.userId === userId)
      : db.orgMembers.some((m) => m.organizationId === workspaceId && m.userId === userId),
  revokeWorkspaceConversations: async () => 0,
}));

vi.mock("@/lib/messaging/crypto", () => ({
  isValidDevicePublicKey: async (key: string) => typeof key === "string" && key.length > 0,
  fingerprintPublicKey: async (key: string) => `fp-${key}`,
}));

vi.mock("@/lib/notifications", () => ({
  notifyConversationMessage: async () => {
    db.notifyCalls += 1;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function reset() {
  db.teamMembers = [
    { teamId: "team-1", userId: "user-me", role: "owner" },
    { teamId: "team-1", userId: "user-alice", role: "member" },
    { teamId: "team-1", userId: "user-bob", role: "member" },
  ];
  db.orgMembers = [];
  db.devices = [
    { id: "dev-me", userId: "user-me", publicKeyB64: "KME", revokedAt: null },
    { id: "dev-alice", userId: "user-alice", publicKeyB64: "KA", revokedAt: null },
    { id: "dev-bob", userId: "user-bob", publicKeyB64: "KB", revokedAt: null },
  ];
  db.members = [];
  db.conversations = [];
  db.threadKeys = [];
  db.wraps = [];
  db.messages = [];
  db.seq = 0;
  db.uniqueViolations = [];
  db.notifyCalls = 0;
  auth.user = { id: "user-me", login: "me", name: "Me", email: null, avatarUrl: null, role: "user" };
  auth.teamAllowed = true;
  auth.orgAllowed = true;
  auth.requireActiveUserThrows = false;
}

import {
  createConversationAction,
  getThreadKeyAction,
  listConversationsAction,
  listMessagesAction,
  markConversationReadAction,
  sendMessageAction,
} from "./actions";

/** A well-formed request: creator's own device plus one wrap per participant. */
type WrapEntry = { userId: string; publicKeyId: string; wrappedKeyB64: string };

function conversationInput(
  overrides: {
    memberIds?: string[];
    teamId?: string;
    orgId?: string;
    wrap?: { issuerPublicKeyB64: string; entries: WrapEntry[] };
  } = {},
) {
  const memberIds = overrides.memberIds ?? ["user-alice"];
  const entries: WrapEntry[] = [
    { userId: "user-me", publicKeyId: "dev-me", wrappedKeyB64: "WME" },
    ...memberIds
      .filter((id) => id !== "user-me")
      .map((id) => ({
        userId: id,
        publicKeyId: id === "user-alice" ? "dev-alice" : "dev-bob",
        wrappedKeyB64: `W-${id}`,
      })),
  ];
  return {
    teamId: "team-1",
    memberIds,
    ...overrides,
    // `wrap` is resolved after the spread so a test can override it wholesale
    // while still getting a well-typed default.
    wrap: overrides.wrap ?? { issuerPublicKeyB64: "KME", entries },
  };
}

beforeEach(() => {
  reset();
});

describe("messaging matrix: valid user behavior never hits a unique-constraint error", () => {
  it("1. creator selects only themself", async () => {
    const r = await createConversationAction(conversationInput({ memberIds: ["user-me"] }));
    expect(r.ok).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({ userId: "user-me", role: "owner" });
  });

  it("2. creator does not select themself", async () => {
    const r = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    expect(r.ok).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    expect(db.members.map((m) => m.userId).sort()).toEqual(["user-alice", "user-me"]);
  });

  it("3. creator selects themself plus another user", async () => {
    const r = await createConversationAction(
      conversationInput({ memberIds: ["user-me", "user-alice"] }),
    );
    expect(r.ok).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    expect(db.members.filter((m) => m.userId === "user-me")).toHaveLength(1);
  });

  it("4. duplicate participants collapse to one row each", async () => {
    const r = await createConversationAction(
      conversationInput({ memberIds: ["user-alice", "user-alice", "user-me", "user-alice"] }),
    );
    expect(r.ok).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    const ids = db.members.map((m) => m.userId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("4b. repeated wrap entries for the same device collapse", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries = [
      ...input.wrap.entries,
      { userId: "user-alice", publicKeyId: "dev-alice", wrappedKeyB64: "DUPLICATE" },
    ];
    const r = await createConversationAction(input);
    expect(r.ok).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    expect(db.wraps.filter((w) => w.publicKeyId === "dev-alice")).toHaveLength(1);
  });

  it("6. a second conversation in the same team is created independently", async () => {
    const first = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    const second = await createConversationAction(conversationInput({ memberIds: ["user-bob"] }));
    expect(first.ok && second.ok).toBe(true);
    expect(db.conversations).toHaveLength(2);
    expect(db.uniqueViolations).toEqual([]);
  });

  it("7. the first message is stored", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const r = await sendMessageAction({
      conversationId: created.conversationId,
      ciphertext: "cipher-1",
      clientMessageId: "cm-1",
    });
    expect(r.ok).toBe(true);
    expect(db.messages).toHaveLength(1);
  });

  it("8. subsequent messages append, and a replayed clientMessageId is idempotent", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const conv = created.conversationId;

    await sendMessageAction({ conversationId: conv, ciphertext: "one", clientMessageId: "cm-1" });
    await sendMessageAction({ conversationId: conv, ciphertext: "two", clientMessageId: "cm-2" });
    const replay = await sendMessageAction({ conversationId: conv, ciphertext: "one", clientMessageId: "cm-1" });

    expect(replay.ok).toBe(true);
    expect(db.messages).toHaveLength(2);
  });

  it("10. concurrent creation for the same team does not corrupt membership", async () => {
    const results = await Promise.all([
      createConversationAction(conversationInput({ memberIds: ["user-alice"] })),
      createConversationAction(conversationInput({ memberIds: ["user-me"] })),
      createConversationAction(conversationInput({ memberIds: ["user-alice", "user-me", "user-alice"] })),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(db.uniqueViolations).toEqual([]);
    for (const conv of db.conversations) {
      const rows = db.members.filter((m) => m.conversationId === conv.id);
      const ids = rows.map((r) => r.userId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("messaging authorization", () => {
  it("aborts creation in a team the caller is not on", async () => {
    auth.teamAllowed = false;
    // The workspace guard throws, so the request never reaches a write.
    await expect(
      createConversationAction(conversationInput({ memberIds: ["user-alice"] })),
    ).rejects.toThrow(/Not a team member/);
    expect(db.conversations).toHaveLength(0);
  });

  it("refuses a participant who is not on the team", async () => {
    db.teamMembers = db.teamMembers.filter((m) => m.userId !== "user-bob");
    const r = await createConversationAction(conversationInput({ memberIds: ["user-bob"] }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/must be on this team/);
    expect(db.conversations).toHaveLength(0);
  });

  it("refuses a participant from another workspace entirely", async () => {
    const r = await createConversationAction(conversationInput({ memberIds: ["user-stranger"] }));
    expect(r.ok).toBe(false);
    expect(db.conversations).toHaveLength(0);
  });

  it("9. refuses to read messages from a conversation the caller is not in", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");

    // Drop the caller's membership row, as if they were removed from the thread.
    const mine = db.members.find((m) => m.userId === "user-me" && m.conversationId === created.conversationId);
    db.members = db.members.filter((m) => m.id !== mine?.id);

    for (const result of [
      await listMessagesAction({ conversationId: created.conversationId, limit: 30 }),
      await getThreadKeyAction({ conversationId: created.conversationId }),
      await markConversationReadAction({ conversationId: created.conversationId }),
      await sendMessageAction({
        conversationId: created.conversationId,
        ciphertext: "x",
        clientMessageId: "cm-x",
      }),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/not a member of this conversation/);
    }
    expect(db.messages).toHaveLength(0);
  });

  it("never returns another user's thread-key wraps", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const r = await getThreadKeyAction({ conversationId: created.conversationId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The caller receives only wraps addressed to their own membership row, so a
    // device key belonging to another member is never handed out.
    const myMemberId = db.members.find(
      (m) => m.conversationId === created.conversationId && m.userId === "user-me",
    )?.id;
    expect(r.wraps.length).toBeGreaterThan(0);
    for (const w of r.wraps) {
      const stored = db.wraps.find((x) => x.publicKeyId === w.publicKeyId);
      expect(stored?.memberId).toBe(myMemberId);
    }
    expect(r.wraps.some((w) => w.publicKeyId === "dev-alice")).toBe(false);
  });

  it("scopes the conversation list to threads the caller belongs to", async () => {
    const mine = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!mine.ok) throw new Error("setup failed");

    // A conversation belonging to somebody else.
    db.conversations.push({ id: "conv-other", teamId: "team-1", orgId: null, kind: "team", lastMessageAt: null });
    db.members.push({ id: "cm-other", conversationId: "conv-other", userId: "user-alice", role: "owner" });

    const r = await listConversationsAction({ teamId: "team-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conversations.map((c) => c.id)).toEqual([mine.conversationId]);
  });

  it("refuses everything for a suspended or signed-out user", async () => {
    auth.requireActiveUserThrows = true;
    await expect(
      createConversationAction(conversationInput({ memberIds: ["user-alice"] })),
    ).rejects.toThrow(/Not authenticated/);
    await expect(listConversationsAction({ teamId: "team-1" })).rejects.toThrow(/Not authenticated/);
    expect(db.conversations).toHaveLength(0);
  });
});

describe("malformed conversation requests", () => {
  it("requires a workspace id", async () => {
    const r = await createConversationAction({
      memberIds: ["user-alice"],
      wrap: { issuerPublicKeyB64: "KME", entries: [{ userId: "user-me", publicKeyId: "dev-me", wrappedKeyB64: "W" }] },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid issuer public key", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.issuerPublicKeyB64 = "";
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
  });

  it("requires at least one wrap entry", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries = [];
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
  });

  it("rejects a member with no wrap entry", async () => {
    const input = conversationInput({ memberIds: ["user-alice", "user-bob"] });
    input.wrap.entries = input.wrap.entries.filter((e) => e.userId !== "user-bob");
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/needs at least one wrap entry/);
  });

  it("rejects a wrap entry for a device belonging to a different user", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries[1].publicKeyId = "dev-bob";
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/unrelated device key/);
  });

  it("rejects a wrap entry referencing a non-member", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries.push({ userId: "user-stranger", publicKeyId: "dev-bob", wrappedKeyB64: "W" });
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/non-member/);
  });

  it("requires the creator's own wrapped copy", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries = input.wrap.entries.filter((e) => e.userId !== "user-me");
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
  });

  it("rejects a creator wrap claimed under another user's device", async () => {
    const input = conversationInput({ memberIds: ["user-alice"] });
    input.wrap.entries[0].publicKeyId = "dev-alice";
    const r = await createConversationAction(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/own device/);
  });

  it("rejects a revoked device key", async () => {
    db.devices = db.devices.map((d) =>
      d.id === "dev-alice" ? { ...d, revokedAt: new Date() } : d,
    );
    const r = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    expect(r.ok).toBe(false);
  });

  it("rejects malformed message input without touching the database", async () => {
    const r = await sendMessageAction({ conversationId: "", ciphertext: "x", clientMessageId: "y" });
    expect(r.ok).toBe(false);
    expect(db.messages).toHaveLength(0);
  });

  it("rejects a message for a conversation that has no active thread key", async () => {
    db.threadKeys = [];
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    db.threadKeys = [];
    const r = await sendMessageAction({
      conversationId: created.conversationId,
      ciphertext: "x",
      clientMessageId: "cm-1",
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/No active thread key/);
  });
});

describe("conversation scope and key validation are fail-closed", () => {
  it("refuses a conversation that names both a team and an organization", async () => {
    // The authorization branch checks the team first, so accepting both scopes
    // let a team-only member attach a thread to an organization they were never
    // a member of. Exactly one scope is required.
    const r = await createConversationAction(
      conversationInput({ teamId: "team-1", orgId: "org-1" }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/exactly one workspace/);
    expect(db.conversations).toHaveLength(0);
  });

  it("rejects a roster larger than the member cap", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `user-${i}`);
    const r = await createConversationAction(
      conversationInput({ memberIds: tooMany, wrap: undefined }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/more than 100 members/);
    expect(db.conversations).toHaveLength(0);
  });

  it("rejects an oversized wrapped thread key", async () => {
    const r = await createConversationAction(
      conversationInput({
        memberIds: ["user-alice"],
        wrap: {
          issuerPublicKeyB64: "KME",
          entries: [
            { userId: "user-me", publicKeyId: "dev-me", wrappedKeyB64: "W".repeat(257) },
            { userId: "user-alice", publicKeyId: "dev-alice", wrappedKeyB64: "W" },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(db.conversations).toHaveLength(0);
  });

  it("rejects an oversized issuer device key", async () => {
    // Valid entries so the length cap is the only thing that can reject this.
    const r = await createConversationAction(
      conversationInput({
        memberIds: ["user-alice"],
        wrap: {
          issuerPublicKeyB64: "K".repeat(513),
          entries: [
            { userId: "user-me", publicKeyId: "dev-me", wrappedKeyB64: "WME" },
            { userId: "user-alice", publicKeyId: "dev-alice", wrappedKeyB64: "W-ALICE" },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
    // Assert the length cap specifically. Without the cap this input is still
    // rejected later by the issuer-ownership check, so `ok === false` alone
    // would pass even with the cap removed.
    expect(r.ok === false && r.error).toMatch(/at most 512 character/);
    expect(db.conversations).toHaveLength(0);
  });

  it("rejects an issuer device key that is not the creator's own", async () => {
    // Otherwise a creator could name an arbitrary key (e.g. a victim's) as the
    // issuer, permanently breaking unwrapping for every participant without
    // any error being raised at creation time.
    const r = await createConversationAction(
      conversationInput({
        memberIds: ["user-alice"],
        wrap: {
          issuerPublicKeyB64: "K-ALICE-KEY",
          entries: [
            { userId: "user-me", publicKeyId: "dev-me", wrappedKeyB64: "WME" },
            { userId: "user-alice", publicKeyId: "dev-alice", wrappedKeyB64: "W-ALICE" },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/creator's own registered device/);
    expect(db.conversations).toHaveLength(0);
  });
});

describe("message input bounds are enforced server-side", () => {
  it("rejects an oversized ciphertext", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const r = await sendMessageAction({
      conversationId: created.conversationId,
      ciphertext: "c".repeat(64 * 1024 + 1),
      clientMessageId: "cm-big",
    });
    expect(r.ok).toBe(false);
    expect(db.messages).toHaveLength(0);
  });

  it("rejects an oversized clientMessageId", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const r = await sendMessageAction({
      conversationId: created.conversationId,
      ciphertext: "x",
      clientMessageId: "c".repeat(65),
    });
    expect(r.ok).toBe(false);
    expect(db.messages).toHaveLength(0);
  });

  it("ignores a future client-supplied lastReadAt instead of trusting it", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");
    const r = await markConversationReadAction({
      conversationId: created.conversationId,
      lastReadAt: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
    });
    expect(r.ok).toBe(false);
    const row = db.members.find(
      (m) => m.conversationId === created.conversationId && m.userId === "user-me",
    );
    expect(row?.lastReadAt).toBeFalsy();
  });
});

describe("workspace membership is re-checked on every conversation action", () => {
  it("revokes access to a team conversation when the reader is removed from the team", async () => {
    const created = await createConversationAction(conversationInput({ memberIds: ["user-alice"] }));
    if (!created.ok) throw new Error("setup failed");

    // The conversation membership row survives, but the person is no longer on
    // the team, so their thread key wraps must no longer be readable.
    db.teamMembers = db.teamMembers.filter((m) => m.userId !== "user-me");

    for (const result of [
      await getThreadKeyAction({ conversationId: created.conversationId }),
      await listMessagesAction({ conversationId: created.conversationId, limit: 30 }),
      await sendMessageAction({
        conversationId: created.conversationId,
        ciphertext: "x",
        clientMessageId: "cm-gone",
      }),
      await markConversationReadAction({ conversationId: created.conversationId }),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(db.messages).toHaveLength(0);
  });

  it("revokes access to an organization conversation when the reader leaves the org", async () => {
    db.orgMembers = [
      { organizationId: "org-1", userId: "user-me" },
      { organizationId: "org-1", userId: "user-alice" },
    ];
    const created = await createConversationAction(
      conversationInput({ teamId: undefined, orgId: "org-1", memberIds: ["user-alice"] }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Still a conversation participant, but no longer in the owning workspace.
    db.orgMembers = db.orgMembers.filter((m) => m.userId !== "user-me");

    for (const result of [
      await getThreadKeyAction({ conversationId: created.conversationId }),
      await listMessagesAction({ conversationId: created.conversationId, limit: 30 }),
      await sendMessageAction({
        conversationId: created.conversationId,
        ciphertext: "x",
        clientMessageId: "cm-left-org",
      }),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(db.messages).toHaveLength(0);
  });
});
