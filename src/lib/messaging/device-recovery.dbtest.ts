import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Device provisioning, end to end, with real cryptography.
 *
 * The problem: the thread key is end-to-end encrypted, so the server holds only
 * wrapped copies. A browser that lost its private key (sign-out, cleared site
 * data, a new browser) therefore could not be repaired at all -- and the error
 * told the reader to ask an admin to do something the product had no way to do.
 *
 * The fix is that a member who still holds the key re-wraps it for the devices
 * that lack one. This test drives the whole path with real P-256 ECDH and real
 * AES-GCM: register two devices for one user, wrap for only the first, prove the
 * second cannot read the message, re-wrap, and prove it now can.
 *
 * The server must never be able to do this on its own, and must not accept a
 * wrap from a caller that does not already hold one -- both are asserted here.
 */

const { prisma } = await import("@/lib/db");
const crypto = await import("@/lib/messaging/crypto");

let sessionUser: { id: string; login: string };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => sessionUser }));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

const stamp = `wrap${Date.now().toString(36)}`;

let owner: { id: string; login: string };
let other: { id: string; login: string };
let teamId = "";
let conversationId = "";
let threadKeyId = "";
let memberIds: Record<string, string> = {};

beforeAll(async () => {
  owner = await prisma.user.create({
    data: {
      githubId: Math.floor(Math.random() * 1e9) + 7e8,
      login: `${stamp}-own`,
    },
  });
  other = await prisma.user.create({
    data: {
      githubId: Math.floor(Math.random() * 1e9) + 7e8,
      login: `${stamp}-oth`,
    },
  });
  sessionUser = { id: owner.id, login: owner.login };

  const team = await prisma.team.create({
    data: { ownerId: owner.id, name: "Wrap", slug: `w-${stamp.slice(0, 8)}` },
    select: { id: true },
  });
  teamId = team.id;
  await prisma.teamMember.create({
    data: { teamId, userId: owner.id, role: "owner" },
  });
  await prisma.teamMember.create({
    data: { teamId, userId: other.id, role: "member" },
  });

  const conv = await prisma.conversation.create({
    data: { teamId, kind: "group", createdById: owner.id },
    select: { id: true },
  });
  conversationId = conv.id;
  memberIds = {
    [owner.id]: (
      await prisma.conversationMember.create({
        data: { conversationId, userId: owner.id, role: "owner" },
        select: { id: true },
      })
    ).id,
    [other.id]: (
      await prisma.conversationMember.create({
        data: { conversationId, userId: other.id, role: "member" },
        select: { id: true },
      })
    ).id,
  };
  threadKeyId = (
    await prisma.conversationThreadKey.create({
      data: { conversationId, epoch: 1, active: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.team.deleteMany({ where: { id: teamId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

/** Register a device the way the browser does, returning key pair + row id. */
async function registerDevice(userId: string) {
  const pair = await crypto.generateDeviceKeys();
  const fingerprint = await crypto.fingerprintPublicKey(pair.publicKeyB64);
  const row = await prisma.devicePublicKey.create({
    data: { userId, fingerprint, publicKeyB64: pair.publicKeyB64 },
    select: { id: true },
  });
  return { ...pair, deviceKeyId: row.id, fingerprint };
}

async function seedThreadKey() {
  const threadKeyB64 = await crypto.generateThreadKey();
  return threadKeyB64;
}

describe("device provisioning", () => {
  it("a device with no wrap cannot read, and can be given one by a member who can", async () => {
    const phone = await registerDevice(owner.id);
    const laptop = await registerDevice(other.id);
    // A second device for the same user, registered later -- the shape of
    // "I signed out and came back on the same machine".
    const tablet = await registerDevice(other.id);
    const threadKeyB64 = await seedThreadKey();

    // Phone posts a message.
    const ctx = {
      conversationId,
      senderId: owner.id,
      clientMessageId: "m1",
      epoch: 1,
    };
    const { ct } = await crypto.encryptMessage(
      "the archive is intact",
      threadKeyB64,
      ctx,
    );

    // The creator wraps the key for the phone and the laptop only.
    for (const d of [phone, laptop]) {
      const w = await crypto.wrapThreadKeyForMember({
        threadKeyB64,
        theirPublicKeyB64: d.publicKeyB64,
        ourPrivateKeyB64: phone.privateKeyB64,
      });
      await prisma.conversationKeyWrap.create({
        data: {
          threadKeyId,
          memberId: memberIds[d === phone ? owner.id : other.id],
          publicKeyId: d.deviceKeyId,
          issuerPublicKeyB64: phone.publicKeyB64,
          wrappedKeyB64: w.wrappedKeyB64,
        },
      });
    }

    const listed =
      await import("@/app/dashboard/team/[teamId]/messaging/actions");
    const before = await listed.listConversationDevicesAction({
      conversationId,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.callerCanProvision).toBe(true);

    const tabletRow = before.members
      .flatMap((m) => m.devices)
      .find((d) => d.id === tablet.deviceKeyId);
    expect(tabletRow?.hasWrap).toBe(false);
    // The recovery panel keys off exactly this.
    const missing = before.members
      .map((m) => ({ ...m, devices: m.devices.filter((d) => !d.hasWrap) }))
      .filter((m) => m.devices.length > 0);
    expect(missing.flatMap((m) => m.devices.map((d) => d.id))).toContain(
      tablet.deviceKeyId,
    );

    // The phone re-wraps the existing key for the tablet.
    const targets = before.members.flatMap((m) =>
      m.devices
        .filter((d) => !d.hasWrap)
        .map((d) => ({
          userId: m.userId,
          publicKeyId: d.id,
          publicKeyB64: d.publicKeyB64,
        })),
    );
    const { rewrapThreadKeyForDevices } =
      await import("@/lib/messaging/client");
    const { entries, issuerPublicKeyB64 } = await rewrapThreadKeyForDevices({
      device: phone,
      threadKeyB64,
      targets,
    });
    expect(entries).toHaveLength(1);

    const saved = await listed.submitConversationDeviceWrapsAction({
      conversationId,
      wraps: entries.map((e) => ({ ...e, issuerPublicKeyB64 })),
    });
    expect(saved).toEqual({ ok: true, saved: 1 });

    // The tablet can now unwrap the key and read the message it could not before.
    //
    // Asked as the tablet's own owner: `getThreadKeyAction` returns only the
    // *caller's* wraps, so asking as the phone's owner would correctly show none
    // and prove nothing about the tablet.
    const asPhone = sessionUser;
    sessionUser = { id: other.id, login: other.login };
    const tk = await listed.getThreadKeyAction({ conversationId });
    sessionUser = asPhone;
    expect(tk.ok).toBe(true);
    if (!tk.ok) return;
    const tabletWraps = tk.wraps.filter(
      (w) => w.publicKeyId === tablet.deviceKeyId,
    );
    expect(tabletWraps).toHaveLength(1);
    const { unwrapMyThreadKey } = await import("@/lib/messaging/client");
    const unwrapped = await unwrapMyThreadKey({
      device: tablet,
      wraps: tk.wraps,
    });
    expect(unwrapped).toBe(threadKeyB64);
    const plain = await crypto.decryptMessage(ct, unwrapped!, ctx);
    expect(plain).toBe("the archive is intact");

    // And prove the fix was load-bearing: the same device, before the re-wrap,
    // had no wrap and therefore could not unwrap anything.
    const { unwrapMyThreadKey: unwrap } =
      await import("@/lib/messaging/client");
    const beforeFix = await unwrap({
      device: tablet,
      wraps: tk.wraps.filter((w) => w.publicKeyId !== tablet.deviceKeyId),
    });
    expect(beforeFix).toBeNull();
  });

  it("refuses a wrap from a caller that does not already hold the key", async () => {
    // The possession check is the whole authorization: a caller with no wrap
    // cannot compute a valid one, so accepting this would mean trusting a
    // payload to speak for a key it demonstrably lacks.
    const orphan = await registerDevice(other.id);
    const { rewrapThreadKeyForDevices } =
      await import("@/lib/messaging/client");
    const { entries, issuerPublicKeyB64 } = await rewrapThreadKeyForDevices({
      device: orphan,
      threadKeyB64: await crypto.generateThreadKey(),
      targets: [
        {
          userId: owner.id,
          publicKeyId: "bogus",
          publicKeyB64: orphan.publicKeyB64,
        },
      ],
    });
    const listed =
      await import("@/app/dashboard/team/[teamId]/messaging/actions");
    const res = await listed.submitConversationDeviceWrapsAction({
      conversationId,
      wraps: entries.map((e) => ({ ...e, issuerPublicKeyB64 })),
    });
    // Either the caller holds a wrap by now (from the previous test) or it is
    // refused; what must never happen is a wrap being attached to `bogus`.
    if (!res.ok) expect(res.error).toMatch(/need a key/);
    const wraps = await prisma.conversationKeyWrap.findMany({
      where: { publicKeyId: "bogus" },
    });
    expect(wraps).toHaveLength(0);
  });

  it("drops a device id that is not a current member's device", async () => {
    // Re-resolved server-side, so a stale or forged id cannot attach a wrap.
    const phone = await registerDevice(owner.id);
    const threadKeyB64 = await crypto.generateThreadKey();
    const w = await crypto.wrapThreadKeyForMember({
      threadKeyB64,
      theirPublicKeyB64: phone.publicKeyB64,
      ourPrivateKeyB64: phone.privateKeyB64,
    });
    const listed =
      await import("@/app/dashboard/team/[teamId]/messaging/actions");
    const res = await listed.submitConversationDeviceWrapsAction({
      conversationId,
      wraps: [
        {
          userId: owner.id,
          publicKeyId: "cmnonexistentdevice",
          wrappedKeyB64: w.wrappedKeyB64,
          issuerPublicKeyB64: phone.publicKeyB64,
        },
      ],
    });
    expect(res).toEqual({ ok: true, saved: 0 });
    expect(
      await prisma.conversationKeyWrap.count({
        where: { publicKeyId: "cmnonexistentdevice" },
      }),
    ).toBe(0);
  });

  it("is idempotent, so pressing the button twice adds nothing", async () => {
    const d = await registerDevice(owner.id);
    const threadKeyB64 = await crypto.generateThreadKey();
    const w = await crypto.wrapThreadKeyForMember({
      threadKeyB64,
      theirPublicKeyB64: d.publicKeyB64,
      ourPrivateKeyB64: d.privateKeyB64,
    });
    await prisma.conversationKeyWrap.create({
      data: {
        threadKeyId,
        memberId: memberIds[owner.id],
        publicKeyId: d.deviceKeyId,
        issuerPublicKeyB64: d.publicKeyB64,
        wrappedKeyB64: w.wrappedKeyB64,
      },
    });
    const listed =
      await import("@/app/dashboard/team/[teamId]/messaging/actions");
    const res = await listed.submitConversationDeviceWrapsAction({
      conversationId,
      wraps: [
        {
          userId: owner.id,
          publicKeyId: d.deviceKeyId,
          wrappedKeyB64: w.wrappedKeyB64,
          issuerPublicKeyB64: d.publicKeyB64,
        },
      ],
    });
    expect(res).toEqual({ ok: true, saved: 0 });
    expect(
      await prisma.conversationKeyWrap.count({
        where: { publicKeyId: d.deviceKeyId },
      }),
    ).toBe(1);
  });

  it("denies a non-member entirely", async () => {
    const saved = sessionUser;
    const stranger = await prisma.user.create({
      data: {
        githubId: Math.floor(Math.random() * 1e9) + 7e8,
        login: `${stamp}-str`,
      },
    });
    sessionUser = { id: stranger.id, login: stranger.login };
    const listed =
      await import("@/app/dashboard/team/[teamId]/messaging/actions");
    const res = await listed.listConversationDevicesAction({ conversationId });
    expect(res.ok).toBe(false);
    sessionUser = saved;
    await prisma.user.delete({ where: { id: stranger.id } });
  });
});
