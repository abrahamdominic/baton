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
      unwrapThreadKeyForMember(wrapped.wrappedKeyB64, mallory.privateKeyB64, alice.publicKeyB64),
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
    const charliePlaintext = await decryptMessage(encrypted.ct, charlieThreadKey);
    expect(charliePlaintext).toBe(plaintext);

    // Mallory tries to unwrap Bob's wrap or Charlie's wrap using Mallory's private key -> fails
    await expect(
      unwrapThreadKeyForMember(wrapForBob.wrappedKeyB64, mallory.privateKeyB64, alice.publicKeyB64),
    ).rejects.toThrow();
    await expect(
      unwrapThreadKeyForMember(wrapForCharlie.wrappedKeyB64, mallory.privateKeyB64, alice.publicKeyB64),
    ).rejects.toThrow();
  });
});