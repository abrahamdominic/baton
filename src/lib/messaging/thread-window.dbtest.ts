import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * The thread window, against a real database.
 *
 * Two defects could not be caught by the existing suite, which mocks Prisma and
 * ignores `orderBy` entirely:
 *
 *  1. `orderBy: { createdAt: "asc" }` with a bare `take: 60` returns the OLDEST
 *     60 rows, so a long thread opened on the beginning of history.
 *  2. Paging back filtered `id < beforeId` while sorting on `createdAt`. Those
 *     orderings disagree under concurrent writers, which permanently skipped
 *     messages.
 *
 * The cursor specifically needs a real database: it depends on how the provider
 * actually orders, and on whether messages sharing a timestamp get one total
 * order.
 */

const { prisma } = await import("@/lib/db");
const { fetchNewestMessageWindow, fetchMessagePage, countVisibleMessages } =
  await import("@/lib/messaging/thread-window");

const stamp = `msgwin${Date.now().toString(36)}`;
const owner = { id: "", login: "" };
const peer = { id: "", login: "" };
let teamId = "";
let conversationId = "";
let threadKeyId = "";

/** Ids in the order they were created, for order assertions. */
let created: string[] = [];

beforeAll(async () => {
  const a = await prisma.user.create({
    data: {
      githubId: Math.floor(Math.random() * 1e9) + 7e8,
      login: `${stamp}-a`,
    },
  });
  const b = await prisma.user.create({
    data: {
      githubId: Math.floor(Math.random() * 1e9) + 7e8,
      login: `${stamp}-b`,
    },
  });
  owner.id = a.id;
  owner.login = a.login;
  peer.id = b.id;
  peer.login = b.login;

  const team = await prisma.team.create({
    data: {
      ownerId: a.id,
      name: "Thread Window",
      slug: `tw-${stamp.slice(0, 8)}`,
    },
    select: { id: true },
  });
  teamId = team.id;
  await prisma.teamMember.create({
    data: { teamId, userId: a.id, role: "owner" },
  });
  await prisma.teamMember.create({
    data: { teamId, userId: b.id, role: "member" },
  });

  const conv = await prisma.conversation.create({
    data: { teamId, kind: "group", createdById: a.id },
    select: { id: true },
  });
  conversationId = conv.id;
  await prisma.conversationMember.create({
    data: { conversationId, userId: a.id, role: "owner" },
  });
  await prisma.conversationMember.create({
    data: { conversationId, userId: b.id, role: "member" },
  });

  const tk = await prisma.conversationThreadKey.create({
    data: { conversationId, epoch: 1, active: true },
    select: { id: true },
  });
  threadKeyId = tk.id;

  // 150 messages, alternating senders, one millisecond apart so the ordering is
  // unambiguous and the id tiebreaker never has to break a genuine tie.
  created = [];
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  for (let i = 0; i < 150; i += 1) {
    const m = await prisma.message.create({
      data: {
        conversationId,
        senderId: i % 2 === 0 ? a.id : b.id,
        ciphertext: `c${i}`,
        protocolVersion: "v2",
        clientMessageId: `${stamp}-c${i}`,
        createdAt: new Date(base + i),
        threadKeyId,
      },
      select: { id: true },
    });
    created.push(m.id);
  }
});

afterAll(async () => {
  await prisma.team.deleteMany({ where: { id: teamId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("thread message window", () => {
  it("opens on the newest messages, not the oldest", async () => {
    const page = await fetchNewestMessageWindow(conversationId, 60);

    expect(page.messages).toHaveLength(60);
    // The regression: the old query returned the first 60 created.
    expect(page.messages.map((m) => m.id)).toEqual(created.slice(-60));
    expect(page.hasMore).toBe(true);
  });

  it("returns the window in chronological order for rendering", async () => {
    const page = await fetchNewestMessageWindow(conversationId, 60);
    const times = page.messages.map((m) => m.createdAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("hands back a cursor that resumes exactly where the window ended", async () => {
    const first = await fetchNewestMessageWindow(conversationId, 60);
    expect(first.nextBeforeId).toBe(created[created.length - 60]);

    const second = await fetchMessagePage(
      conversationId,
      first.nextBeforeId,
      60,
    );
    expect(second.messages.map((m) => m.id)).toEqual(created.slice(-120, -60));
  });

  it("walks the entire conversation with no gap and no duplicate", async () => {
    // This is the property the old `id < beforeId` filter broke. Paging with a
    // cursor over the id tiebreaker must reproduce the full sequence exactly.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof fetchMessagePage>> =
        await fetchMessagePage(conversationId, cursor, 40);
      seen.unshift(...page.messages.map((m) => m.id));
      if (!page.hasMore || !page.nextBeforeId) break;
      cursor = page.nextBeforeId;
    }

    expect(seen).toEqual(created);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("reports hasMore exactly, not as a guess from a full page", async () => {
    // 150 = 60 + 60 + 30. A `length === limit` heuristic would have claimed
    // there was another page after the final 30 and then returned nothing.
    let cursor: string | null = null;
    const lengths: number[] = [];
    let pages = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await fetchMessagePage(conversationId, cursor, 60);
      lengths.push(page.messages.length);
      pages += 1;
      if (!page.hasMore || !page.nextBeforeId) break;
      cursor = page.nextBeforeId;
    }
    expect(lengths).toEqual([60, 60, 30]);
    expect(pages).toBe(3);
  });

  it("returns an empty page rather than throwing for an unknown cursor", async () => {
    // A cursor for a deleted row makes Prisma throw. That is a recoverable client
    // state, so it must resolve.
    const page = await fetchMessagePage(conversationId, "cmdoesnotexist", 30);
    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBeforeId).toBeNull();
  });

  it("keeps a whole conversation inside one window", async () => {
    const page = await fetchNewestMessageWindow(conversationId, 500);
    expect(page.messages).toHaveLength(150);
    expect(page.hasMore).toBe(false);
    expect(page.nextBeforeId).toBeNull();
  });

  it("carries the fields the client needs to decrypt", async () => {
    const page = await fetchNewestMessageWindow(conversationId, 1);
    const m = page.messages[0];
    // The epoch is half of the v2 AAD; without it nothing can be authenticated.
    expect(m.epoch).toBe(1);
    expect(m.protocolVersion).toBe("v2");
    expect(m.senderLogin).toBeTruthy();
    expect(m.conversationId).toBe(conversationId);
  });
});

describe("visible message count", () => {
  it("excludes soft-deleted rows, so a header cannot over-report", async () => {
    // A bare `_count: { select: { messages: true } }` counts these, while every
    // list filters them out -- which is how a fully-deleted conversation kept a
    // permanent unread dot.
    const target = await prisma.message.create({
      data: {
        conversationId,
        senderId: peer.id,
        ciphertext: "doomed",
        protocolVersion: "v2",
        clientMessageId: `${stamp}-doomed`,
        deletedAt: new Date(),
        threadKeyId,
      },
      select: { id: true },
    });

    expect(await countVisibleMessages(conversationId)).toBe(150);
    const page = await fetchNewestMessageWindow(conversationId, 500);
    expect(page.messages.some((m) => m.id === target.id)).toBe(false);

    await prisma.message.delete({ where: { id: target.id } });
    expect(await countVisibleMessages(conversationId)).toBe(150);
  });
});
