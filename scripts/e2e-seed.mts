/* E2E integration seed for Baton.
 * Unknowns only via the app's own modules (db client, session helpers, crypto),
 * then real HTTP checks run against the production build with these sessions.
 * All rows are namespaced by a unique run tag and removed on cleanup.
 */
import { prisma } from "../src/lib/db";
import { createSession, newSessionToken, hashToken } from "../src/lib/auth/session";
import {
  generateDeviceKeys,
  generateThreadKey,
  encryptMessage,
  decryptMessage,
  wrapThreadKeyForMember,
  unwrapThreadKeyForMember,
} from "../src/lib/messaging/crypto";

const tag = `e2e${Date.now()}`;
const LOGIN1 = `baton-${tag}-alice`;
const LOGIN2 = `baton-${tag}-bob`;
const GID1 = 100000000 + (Date.now() % 1000000);
const GID2 = GID1 + 1;

const out: Record<string, string> = { tag, LOGIN1, LOGIN2 };

async function seed() {
  // --- users + sessions (mirrors finishOAuthSignIn upsert) ---
  const alice = await prisma.user.upsert({
    where: { githubId: GID1 },
    create: { githubId: GID1, login: LOGIN1, name: "Alice E2E", email: null, avatarUrl: null, role: "user" },
    update: {},
  });
  const bob = await prisma.user.upsert({
    where: { githubId: GID2 },
    create: { githubId: GID2, login: LOGIN2, name: "Bob E2E", email: null, avatarUrl: null, role: "user" },
    update: {},
  });
  const [sa, sb] = await Promise.all([createSession(alice.id), createSession(bob.id)]);
  // admin test user
  const adm = await prisma.user.upsert({
    where: { githubId: GID2 + 10 },
    create: {
      githubId: GID2 + 10,
      login: `baton-${tag}-admin`,
      name: "Admin E2E",
      email: null,
      avatarUrl: null,
      role: "admin",
    },
    update: {},
  });
  const sAdmin = await createSession(adm.id);
  out["ALICE_TOKEN"] = sa.token;
  const sLogout = await createSession(alice.id); // throwaway for logout E2E
  out["LOGOUT_TOKEN"] = sLogout.token;
  out["BOB_TOKEN"] = sb.token;
  out["ADMIN_TOKEN"] = sAdmin.token;
  out["ALICE_ID"] = alice.id;
  out["BOB_ID"] = bob.id;
  out["ADMIN_ID"] = adm.id;

  // --- team owned by alice, bob a member ---
  const teamSlug = `${tag}-t`.slice(0, 50);
  const team = await prisma.team.create({
    data: {
      slug: teamSlug,
      name: `Team ${tag}`,
      ownerId: alice.id,
      members: {
        create: [
          { userId: alice.id, role: "owner" },
          { userId: bob.id, role: "member" },
        ],
      },
    },
  });
  out["TEAM_ID"] = team.id;

  // --- organization owned by bob (alice NOT a member) for isolation test ---
  const orgSlug = `${tag}-o`.slice(0, 50);
  const org = await prisma.organization.create({
    data: {
      slug: orgSlug,
      name: `Org ${tag}`,
      ownerId: bob.id,
      members: { create: { userId: bob.id, role: "owner" } },
    },
  });
  out["ORG_ID"] = org.id;

  // --- encrypted conversation on the team, alice + bob members ---
  const threadKeyB64 = await generateThreadKey();
  const aliceDev = await generateDeviceKeys();
  const bobDev = await generateDeviceKeys();

  await prisma.devicePublicKey.createMany({
    data: [
      { userId: alice.id, label: "E2E alice device", publicKeyB64: aliceDev.publicKeyB64, fingerprint: `${tag}-ad` },
      { userId: bob.id, label: "E2E bob device", publicKeyB64: bobDev.publicKeyB64, fingerprint: `${tag}-bd` },
    ],
  });

  const conv = await prisma.conversation.create({
    data: {
      kind: "team",
      teamId: team.id,
      createdById: alice.id,
      members: {
        create: [
          { userId: alice.id, role: "owner" },
          { userId: bob.id, role: "member" },
        ],
      },
    },
    include: { members: true },
  });

  const threadKey = await prisma.conversationThreadKey.create({
    data: { conversationId: conv.id, epoch: 1, active: true },
  });

  // alice wraps for herself and for bob
  const wrapAlice = conv.members.find((m) => m.userId === alice.id)!;
  const wrapBob = conv.members.find((m) => m.userId === bob.id)!;

  const aliceWrapSelf = await wrapThreadKeyForMember({ threadKeyB64, theirPublicKeyB64: aliceDev.publicKeyB64, ourPrivateKeyB64: aliceDev.privateKeyB64 });
  const aliceWrapBob = await wrapThreadKeyForMember({ threadKeyB64, theirPublicKeyB64: bobDev.publicKeyB64, ourPrivateKeyB64: aliceDev.privateKeyB64 });

  await prisma.conversationKeyWrap.createMany({
    data: [
      { threadKeyId: threadKey.id, memberId: wrapAlice.id, publicKeyId: (await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: alice.id } })).id, issuerPublicKeyB64: aliceDev.publicKeyB64, wrappedKeyB64: aliceWrapSelf.wrappedKeyB64 },
      { threadKeyId: threadKey.id, memberId: wrapBob.id, publicKeyId: (await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: bob.id } })).id, issuerPublicKeyB64: aliceDev.publicKeyB64, wrappedKeyB64: aliceWrapBob.wrappedKeyB64 },
    ],
  });

  // --- messages: encrypt with the real lib, verify round-trip unwrap+decrypt ---
  const msg1 = await encryptMessage(`hello bob from alice ${tag}`, threadKeyB64);
  const msg2 = await encryptMessage(`reply 2 from alice ${tag}`, threadKeyB64);
  const msg3 = await encryptMessage(`secret-sentinel-${tag}`, threadKeyB64);
  await prisma.message.createMany({
    data: [
      { conversationId: conv.id, senderId: alice.id, threadKeyId: threadKey.id, ciphertext: msg1.ct, protocolVersion: "v1", clientMessageId: `${tag}-m1` },
      { conversationId: conv.id, senderId: alice.id, threadKeyId: threadKey.id, ciphertext: msg2.ct, protocolVersion: "v1", clientMessageId: `${tag}-m2` },
      { conversationId: conv.id, senderId: alice.id, threadKeyId: threadKey.id, ciphertext: msg3.ct, protocolVersion: "v1", clientMessageId: `${tag}-m3` },
    ],
  });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });

  // bob unwrap + decrypt verifies receiver side (no plaintext on server)
  const bobPub = await prisma.devicePublicKey.findFirstOrThrow({ where: { userId: bob.id } });
  const bobWraps = await prisma.conversationKeyWrap.findMany({
    where: { threadKeyId: threadKey.id, publicKeyId: bobPub.id },
  });
  const unwrapped = await unwrapThreadKeyForMember(bobWraps[0].wrappedKeyB64, bobDev.privateKeyB64, bobWraps[0].issuerPublicKeyB64);
  if (unwrapped !== threadKeyB64) throw new Error("E2E unwrap mismatch");
  const dec = await decryptMessage(msg3.ct, threadKeyB64);
  if (dec !== `secret-sentinel-${tag}`) throw new Error("E2E decrypt mismatch");

  // raw ciphertext must not contain plaintext
  const mRow = await prisma.message.findFirstOrThrow({ where: { clientMessageId: `${tag}-m3` } });
  if (mRow.ciphertext.includes(`secret-sentinel-${tag}`)) throw new Error("ciphertext leaks plaintext");

  out["CONV_ID"] = conv.id;
  out["THREAD_KEY"] = threadKeyB64;

  // --- unread notification for bob on the thread (deep link) ---
  const notif = await prisma.notification.create({
    data: {
      userId: bob.id,
      type: "message",
      resourceType: "conversation",
      resourceId: conv.id,
      actorId: alice.id,
      contextJson: JSON.stringify({ conversationId: conv.id, teamId: team.id }),
    },
  });
  out["NOTIF_ID"] = notif.id;

  // --- a second conversation where bob is NOT a member (cross-user access test) ---
  const convX = await prisma.conversation.create({
    data: { kind: "team", teamId: team.id, createdById: alice.id, members: { create: { userId: alice.id, role: "owner" } } },
  });
  out["CONV_X_ID"] = convX.id;

  console.log(JSON.stringify(out));
  await prisma.$disconnect();
}

if (process.argv.includes("--cleanup")) {
  const { count } = await prisma.user.deleteMany({
    where: { login: { startsWith: "baton-e2e" } },
  });
  console.log(`CLEANED baton-e2e* users: ${count}`);
  await prisma.$disconnect();
} else {
  seed().catch(async (e) => {
    console.error("SEED FAILED", e);
    await prisma.$disconnect();
    process.exit(1);
  });
}