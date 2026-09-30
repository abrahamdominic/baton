import { describe, it, expect } from "vitest";
import {
  AES_GCM_BYTES,
  generateDeviceKeys,
  generateThreadKey,
  wrapThreadKeyForMember,
  unwrapThreadKeyForMember,
  encryptMessage,
  decryptMessage,
  fingerprintPublicKey,
  isValidDevicePublicKey,
  isCoherentDeviceKeyPair,
} from "@/lib/messaging/crypto";

describe("messaging crypto (E2E round-trips)", () => {
  it("generates two distinct, persistent device keypairs", async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();

    expect(alice.publicKeyB64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(bob.publicKeyB64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(alice.publicKeyB64).not.toBe(bob.publicKeyB64);
    expect(alice.privateKeyB64).not.toBe(bob.privateKeyB64);
    expect(alice.publicKeyB64).not.toBe(alice.privateKeyB64);
  });

  it("wrap→unwrap restores the exact thread key (Alice wraps for Bob)", async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const threadKeyB64 = await generateThreadKey();

    const wrapped = await wrapThreadKeyForMember({
      threadKeyB64,
      theirPublicKeyB64: bob.publicKeyB64,
      ourPrivateKeyB64: alice.privateKeyB64,
    });

    // Bob unwraps using his private key + Alice's public key.
    const unwrapped = await unwrapThreadKeyForMember(
      wrapped.wrappedKeyB64,
      bob.privateKeyB64,
      alice.publicKeyB64,
    );

    expect(unwrapped).toBe(threadKeyB64);
  });

  it("encrypt→decrypt restores the original plaintext with a fresh nonce each time", async () => {
    const threadKeyB64 = await generateThreadKey();
    const plaintext = "double/secret/baton\nline two";

    const a = await encryptMessage(plaintext, threadKeyB64);
    const b = await encryptMessage(plaintext, threadKeyB64);

    // Same plaintext, two ciphertexts (random IV) — never identical.
    expect(a.ct).not.toBe(b.ct);
    expect(a.ct).toMatch(/^[A-Za-z0-9+/=]+$/);

    const round = await decryptMessage(a.ct, threadKeyB64);
    expect(round).toBe(plaintext);
  });

  it("produces stable fingerprints per public key, unique across keys", async () => {
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();

    expect(await fingerprintPublicKey(a.publicKeyB64)).toBe(
      await fingerprintPublicKey(a.publicKeyB64),
    );
    expect(await fingerprintPublicKey(a.publicKeyB64)).not.toBe(
      await fingerprintPublicKey(b.publicKeyB64),
    );
  });

  it("uses a 96-bit nonce per GCM operation", async () => {
    const key = await generateThreadKey();
    const msg = await encryptMessage("x", key);
    // ct = base64(iv(12) | ciphertext) — iv must be first 12 bytes.
    const raw = Buffer.from(msg.ct, "base64");
    expect(raw.slice(0, AES_GCM_BYTES).length).toBe(12);
  });

  it("validates device public keys (accepts real keys, rejects garbage)", async () => {
    const real = await generateDeviceKeys();
    expect(await isValidDevicePublicKey(real.publicKeyB64)).toBe(true);

    expect(await isValidDevicePublicKey("")).toBe(false);
    expect(await isValidDevicePublicKey("not-base64!!")).toBe(false);
    expect(await isValidDevicePublicKey("aGVsbG8=")).toBe(false); // valid base64, not a key
  });
});

describe("messaging crypto (security boundary)", () => {
  it("rejects tampered ciphertext (GCM authentication fails)", async () => {
    const threadKeyB64 = await generateThreadKey();
    const msg = await encryptMessage("integrity must hold", threadKeyB64);

    const raw = Buffer.from(msg.ct, "base64");
    // Flip bits inside the ciphertext body (not the leading IV).
    raw[raw.length - 5] ^= 0xff;
    const tampered = raw.toString("base64");

    await expect(decryptMessage(tampered, threadKeyB64)).rejects.toThrow();
  });

  it("rejects decryption under the wrong thread key", async () => {
    const senderKey = await generateThreadKey();
    const wrongKey = await generateThreadKey();
    const msg = await encryptMessage("secret", senderKey);

    await expect(decryptMessage(msg.ct, wrongKey)).rejects.toThrow();
    expect(await decryptMessage(msg.ct, senderKey)).toBe("secret");
  });

  it("does not let an unauthorized member unwrap another member's wrap", async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const mallory = await generateDeviceKeys();
    const threadKeyB64 = await generateThreadKey();

    // Alice wraps the thread key for Bob only.
    const wrapped = await wrapThreadKeyForMember({
      threadKeyB64,
      theirPublicKeyB64: bob.publicKeyB64,
      ourPrivateKeyB64: alice.privateKeyB64,
    });

    // Bob (the intended recipient) can unwrap…
    const bobKey = await unwrapThreadKeyForMember(
      wrapped.wrappedKeyB64,
      bob.privateKeyB64,
      alice.publicKeyB64,
    );
    expect(bobKey).toBe(threadKeyB64);

    // …but Mallory, who lacks Bob's private key, cannot.
    await expect(
      unwrapThreadKeyForMember(
        wrapped.wrappedKeyB64,
        mallory.privateKeyB64,
        alice.publicKeyB64,
      ),
    ).rejects.toThrow();
  });

  it("never embeds plaintext or key material in the persisted ciphertext", async () => {
    const threadKeyB64 = await generateThreadKey();
    const secret = "PLAINTEXT-SENTINEL-TOKPONLYLOCAL";
    const msg = await encryptMessage(secret, threadKeyB64);

    const raw = Buffer.from(msg.ct, "base64");
    expect(raw.includes(Buffer.from(secret))).toBe(false);
    expect(raw.includes(Buffer.from(threadKeyB64, "base64"))).toBe(false);
    // Persisted form is base64 only.
    expect(msg.ct).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("supports multi-member thread key distribution (Alice, Bob, Charlie) while excluding Mallory", async () => {
    const alice = await generateDeviceKeys();
    const bob = await generateDeviceKeys();
    const charlie = await generateDeviceKeys();
    const mallory = await generateDeviceKeys();

    const threadKey = await generateThreadKey();

    // Alice wraps for Bob and Charlie (and herself)
    const wrapForAlice = await wrapThreadKeyForMember({
      threadKeyB64: threadKey,
      theirPublicKeyB64: alice.publicKeyB64,
      ourPrivateKeyB64: alice.privateKeyB64,
    });
    const wrapForBob = await wrapThreadKeyForMember({
      threadKeyB64: threadKey,
      theirPublicKeyB64: bob.publicKeyB64,
      ourPrivateKeyB64: alice.privateKeyB64,
    });
    const wrapForCharlie = await wrapThreadKeyForMember({
      threadKeyB64: threadKey,
      theirPublicKeyB64: charlie.publicKeyB64,
      ourPrivateKeyB64: alice.privateKeyB64,
    });

    // Alice encrypts a sensitive organization message
    const plaintext = "Confidential sprint retrospective details";
    const encrypted = await encryptMessage(plaintext, threadKey);

    // Alice unwraps and decrypts (sender can read back their own thread)
    const aliceThreadKey = await unwrapThreadKeyForMember(
      wrapForAlice.wrappedKeyB64,
      alice.privateKeyB64,
      alice.publicKeyB64,
    );
    expect(aliceThreadKey).toBe(threadKey);
    const alicePlaintext = await decryptMessage(encrypted.ct, aliceThreadKey);
    expect(alicePlaintext).toBe(plaintext);

    // Bob unwraps and decrypts
    const bobThreadKey = await unwrapThreadKeyForMember(
      wrapForBob.wrappedKeyB64,
      bob.privateKeyB64,
      alice.publicKeyB64,
    );
    expect(bobThreadKey).toBe(threadKey);
    const bobPlaintext = await decryptMessage(encrypted.ct, bobThreadKey);
    expect(bobPlaintext).toBe(plaintext);

    // Charlie unwraps and decrypts
    const charlieThreadKey = await unwrapThreadKeyForMember(
      wrapForCharlie.wrappedKeyB64,
      charlie.privateKeyB64,
      alice.publicKeyB64,
    );
    expect(charlieThreadKey).toBe(threadKey);
    const charliePlaintext = await decryptMessage(
      encrypted.ct,
      charlieThreadKey,
    );
    expect(charliePlaintext).toBe(plaintext);

    // Mallory tries to unwrap Bob's wrap or Charlie's wrap using Mallory's private key -> fails
    await expect(
      unwrapThreadKeyForMember(
        wrapForBob.wrappedKeyB64,
        mallory.privateKeyB64,
        alice.publicKeyB64,
      ),
    ).rejects.toThrow();
    await expect(
      unwrapThreadKeyForMember(
        wrapForCharlie.wrappedKeyB64,
        mallory.privateKeyB64,
        alice.publicKeyB64,
      ),
    ).rejects.toThrow();
  });
});
describe("message AAD binds ciphertext to its own identity", () => {
  const ctx = {
    conversationId: "conv-1",
    senderId: "user-alice",
    clientMessageId: "cm-1",
    epoch: 3,
  };

  it("round-trips a v2 message", async () => {
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("hello", tk, ctx);
    expect(await decryptMessage(ct, tk, ctx)).toBe("hello");
  });

  it("rejects the same ciphertext in a different conversation", async () => {
    // Without AAD a member could lift a blob from one thread and drop it into
    // another they also hold the key for, and it would decrypt as valid text.
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("hello", tk, ctx);
    await expect(
      decryptMessage(ct, tk, { ...ctx, conversationId: "conv-2" }),
    ).rejects.toBeTruthy();
  });

  it("rejects the same ciphertext attributed to a different sender", async () => {
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("hello", tk, ctx);
    await expect(
      decryptMessage(ct, tk, { ...ctx, senderId: "user-mallory" }),
    ).rejects.toBeTruthy();
  });

  it("rejects a replay under a new clientMessageId", async () => {
    // This is what defeated the senderId+clientMessageId idempotency check
    // before: the row was new, so the ciphertext was accepted as fresh.
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("hello", tk, ctx);
    await expect(
      decryptMessage(ct, tk, { ...ctx, clientMessageId: "cm-2" }),
    ).rejects.toBeTruthy();
  });

  it("rejects the same ciphertext after a thread key rotation", async () => {
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("hello", tk, ctx);
    await expect(
      decryptMessage(ct, tk, { ...ctx, epoch: 4 }),
    ).rejects.toBeTruthy();
  });

  it("does not let field boundaries collide", async () => {
    // "ab" + "c" must not authenticate the same as "a" + "bc".
    const tk = await generateThreadKey();
    const a = await encryptMessage("x", tk, {
      conversationId: "ab",
      senderId: "c",
      clientMessageId: "k",
      epoch: 1,
    });
    await expect(
      decryptMessage(a.ct, tk, {
        conversationId: "a",
        senderId: "bc",
        clientMessageId: "k",
        epoch: 1,
      }),
    ).rejects.toBeTruthy();
  });

  it("still decrypts a legacy v1 message, which has no AAD", async () => {
    // Omitting the context reproduces the original v1 blob byte-for-byte, so
    // already-stored messages must keep opening.
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("legacy", tk);
    expect(await decryptMessage(ct, tk)).toBe("legacy");
  });

  it("will not open a v2 ciphertext when the context is withheld", async () => {
    // A reader that skips the context must not silently accept a v2 blob.
    const tk = await generateThreadKey();
    const { ct } = await encryptMessage("bound", tk, ctx);
    await expect(decryptMessage(ct, tk)).rejects.toBeTruthy();
  });
});

describe("isCoherentDeviceKeyPair", () => {
  it("accepts a freshly generated pair", async () => {
    const pair = await generateDeviceKeys();
    expect(
      await isCoherentDeviceKeyPair(pair.publicKeyB64, pair.privateKeyB64),
    ).toBe(true);
  });

  it("rejects a public key paired with a different private key", async () => {
    // Exactly the state that used to reach `unwrapMyThreadKey`: both fields
    // present, but they are not the two halves of one key. The unwrap then
    // produced the wrong secret and the thread hung on "Setting up...".
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();
    expect(await isCoherentDeviceKeyPair(a.publicKeyB64, b.privateKeyB64)).toBe(
      false,
    );
  });

  it("rejects garbage in either half rather than throwing", async () => {
    const pair = await generateDeviceKeys();
    expect(
      await isCoherentDeviceKeyPair("not-base64", pair.privateKeyB64),
    ).toBe(false);
    expect(await isCoherentDeviceKeyPair(pair.publicKeyB64, "not-base64")).toBe(
      false,
    );
    expect(await isCoherentDeviceKeyPair("", "")).toBe(false);
  });

  it("rejects a swapped public key that is valid but not the pair's", async () => {
    // A structurally valid P-256 key is not sufficient; it has to be the public
    // half of *this* private key.
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();
    expect(await isValidDevicePublicKey(b.publicKeyB64)).toBe(true);
    expect(await isCoherentDeviceKeyPair(b.publicKeyB64, a.privateKeyB64)).toBe(
      false,
    );
  });
});
