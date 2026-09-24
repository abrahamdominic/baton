// Baton messaging E2E cryptography.
//
// All primitives come from the WebCrypto API: ECDH P-256 for device-device key
// exchange, HKDF-SHA-256 to derive AES-256 keys, and AES-256-GCM for at-rest
// encryption and per-member key wrapping. This module never implements bespoke
// crypto: it only composes the shipped, audited WebCrypto operations. Private
// keys (device and thread) are generated and used on the client and are never
// transmitted to (or stored by) the server.
//
// Shape notes
//   - A "device" is a browser profile with its own ECDH keypair. Its public
//     key is exported as SPKI base64 and stored server-side so other members
//     can wrap the thread key for us; the private key stays in the client.
//   - A "thread" is one encrypted conversation. Its AES-256 "thread key" is
//     generated client-side and never stored in plaintext. Each member of the
//     thread receives a per-member "key wrap": the thread key encrypted under
//     an AES-256 key derived from ECDH(our device private key, their device
//     public key). Removed/added membership rotates the epoch so wraps are
//     freshly issued each time.
//
// Every value meant to be persisted is base64 (B64) of raw bytes, keeping the
// database layer oblivious to the exact byte layout.

const textEnc = new TextEncoder();
const textDec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

/** Length of an AES-GCM nonce (96 bits / 12 bytes). */
export const AES_GCM_BYTES = 12;

/** HKDF bindings — app-fixed salts/info, never per-message. */
const HKDF_SALT = strBytes("baton-thread-key-v1");
const HKDF_INFO_THREAD = strBytes("baton-thread-wrap-v1");

export interface DeviceKeyPair {
  /** SPKI base64 — safe to store server-side. */
  publicKeyB64: string;
  /** PKCS8 base64 — NEVER send this anywhere. */
  privateKeyB64: string;
}

export interface WrappedMessage {
  /** base64(iv | ciphertext). */
  ct: string;
  /** Thread epoch this message belongs to. */
  epoch: number;
  /** Sender device public key SPKI base64, for sender-auth readback. */
  publicKeyB64: string;
}

export interface KeyWrapInput {
  threadKeyB64: string; // AES-256 thread key, base64
  theirPublicKeyB64: string; // other member's SPKI, base64
  ourPrivateKeyB64: string; // our device PKCS8, base64 (client only)
}

export interface KeyWrapOutput {
  wrappedKeyB64: string; // base64(iv | ciphertext of the thread key)
}

/** Generate a fresh ECDH P-256 device keypair for this client profile. */
export async function generateDeviceKeys(): Promise<DeviceKeyPair> {
  const kp = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  const pub = await subtle.exportKey("spki", kp.publicKey);
  const priv = await subtle.exportKey("pkcs8", kp.privateKey);
  return { publicKeyB64: bufToB64(pub), privateKeyB64: bufToB64(priv) };
}

/**
 * ECDH(P-256) shared secret -> HKDF-SHA256 -> a 256-bit AES-GCM key. This is
 * the raw "device-to-device" key used only to wrap the thread key.
 */
async function deriveDeviceSharedKey(
  ourPrivateKeyB64: string,
  theirPublicKeyB64: string,
  ctx: Uint8Array<ArrayBuffer> = HKDF_INFO_THREAD,
): Promise<CryptoKey> {
  const theirPub = await subtle.importKey(
    "spki",
    b64ToBuf(theirPublicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ourPriv = await subtle.importKey(
    "pkcs8",
    b64ToBuf(ourPrivateKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );

  const shared = await subtle.deriveBits(
    { name: "ECDH", public: theirPub },
    ourPriv,
    256,
  );

  const keyBits = await subtle.importKey(
    "raw",
    toBufferSource(shared),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: ctx },
    keyBits,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Wrap one member's copy of the thread key under the AES key derived from
 * ECDH(our device, their device). Returns only ciphertext.
 */
export async function wrapThreadKeyForMember(
  input: KeyWrapInput,
): Promise<KeyWrapOutput> {
  const key = await deriveDeviceSharedKey(
    input.ourPrivateKeyB64,
    input.theirPublicKeyB64,
  );
  const iv = subtleIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    b64ToBuf(input.threadKeyB64),
  );
  return { wrappedKeyB64: bufToB64(concatBytes(iv, new Uint8Array(ct))) };
}

/** Inverse of wrapThreadKeyForMember — runs entirely on the client. */
export async function unwrapThreadKeyForMember(
  wrappedKeyB64: string,
  ourPrivateKeyB64: string,
  theirPublicKeyB64: string,
): Promise<string> {
  const key = await deriveDeviceSharedKey(
    ourPrivateKeyB64,
    theirPublicKeyB64,
  );
  const raw = b64ToBuf(wrappedKeyB64);
  const iv = raw.slice(0, AES_GCM_BYTES);
  const body = raw.slice(AES_GCM_BYTES);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    body,
  );
  return bufToB64(new Uint8Array(plain));
}

/**
 * Generate a fresh AES-256 thread key. The key is materialized only in this
 * client; what the server sees is only per-member wraps.
 */
export async function generateThreadKey(): Promise<string> {
  const k = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await subtle.exportKey("raw", k);
  return bufToB64(new Uint8Array(raw));
}

/** Encrypt a plaintext message with the thread key. Never persists plaintext. */
export async function encryptMessage(
  plaintext: string,
  threadKeyB64: string,
): Promise<WrappedMessage> {
  const key = await importThreadKey(threadKeyB64);
  const iv = subtleIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    textEnc.encode(plaintext),
  );
  return {
    ct: bufToB64(concatBytes(iv, new Uint8Array(ct))),
    epoch: CORRUPT_EPOCH,
    publicKeyB64: "",
  };
}

/** Decrypt a ciphertext blob with the thread key. */
export async function decryptMessage(
  ct: string,
  threadKeyB64: string,
): Promise<string> {
  const key = await importThreadKey(threadKeyB64);
  const raw = b64ToBuf(ct);
  const iv = raw.slice(0, AES_GCM_BYTES);
  const body = raw.slice(AES_GCM_BYTES);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    body,
  );
  return textDec.decode(plain);
}

/** Derive a stable thread-id / fingerprint to bind a wrap to its owner. */
export async function fingerprintPublicKey(
  publicKeyB64: string,
): Promise<string> {
  const digest = await subtle.digest("SHA-256", b64ToBuf(publicKeyB64));
  return bufToB64(new Uint8Array(digest));
}

/**
 * Validate that a base64 blob is a real, importable ECDH P-256 SPKI public key.
 * The server uses this before persisting a registered device key so garbage or
 * non-ECDH material never reaches the wraps table.
 */
export async function isValidDevicePublicKey(
  publicKeyB64: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKeyB64) || publicKeyB64.length < 32) {
    return false;
  }
  try {
    await subtle.importKey(
      "spki",
      b64ToBuf(publicKeyB64),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

function importThreadKey(threadKeyB64: string): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    b64ToBuf(threadKeyB64),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Marker for messages whose epoch guard failed — never stored in plaintext. */
const CORRUPT_EPOCH = -1;

function subtleIv(): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(AES_GCM_BYTES);
  crypto.getRandomValues(iv);
  return iv;
}

function bufToB64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** TextEncoder results that must satisfy WebCrypto's BufferSource contract. */
function strBytes(s: string): Uint8Array<ArrayBuffer> {
  return textEnc.encode(s);
}

/** Copies any ArrayBuffer into a fresh ArrayBuffer (BufferSource-friendly). */
function toBufferSource(buf: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/** btoa/atob are absent in some Node test runners; RFC-4648 shims. */
function btoa(s: string): string {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}
function atob(s: string): string {
  if (typeof globalThis.atob === "function") return globalThis.atob(s);
  return Buffer.from(s, "base64").toString("binary");
}
