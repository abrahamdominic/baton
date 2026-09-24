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
});