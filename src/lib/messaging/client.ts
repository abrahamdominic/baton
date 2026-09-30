// Client-only E2E messaging helpers.
//
// Device keypairs are generated here and the PRIVATE halve is persisted in
// localStorage — it never touches the network or the database. Thread keys are
// unwrapped in memory from the server's wraps (ECDH(our private, issuer public))
// and are never persisted at all.

import {
  decryptMessage,
  encryptMessage,
  fingerprintPublicKey,
  isCoherentDeviceKeyPair,
  generateDeviceKeys,
  generateThreadKey,
  unwrapThreadKeyForMember,
  wrapThreadKeyForMember,
  type DeviceKeyPair,
} from "@/lib/messaging/crypto";
import {
  registerDeviceKeyAction,
  type RegisterDeviceResult,
} from "@/app/dashboard/team/[teamId]/messaging/actions";

export type { DeviceKeyPair };

const STORAGE_PREFIX = "baton:msg:device";

export interface ClientDevice extends DeviceKeyPair {
  deviceKeyId: string;
  fingerprint: string;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function loadDevice(userId: string): ClientDevice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientDevice;
    if (!parsed.publicKeyB64 || !parsed.privateKeyB64) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDevice(userId: string, device: ClientDevice): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(device));
}

/**
 * Drop every device key stored for one account, or for all accounts when
 * `userId` is omitted.
 *
 * The ECDH private key lives only in this browser, so it is the only thing that
 * can unwrap this profile's thread keys. Signing out must clear it: on a
 * shared or kiosk machine the next person could otherwise pair the still
 * registered public key with the leftover private key and read every
 * conversation that device was ever given a wrap for.
 */
export function forgetDevice(userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.localStorage.removeItem(storageKey(userId));
      return;
    }
    // Sweep every account's key when the signed-out identity is unknown.
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(`${STORAGE_PREFIX}:`)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, quota). A failed clear must not
    // block sign-out; the server session is already revoked either way.
  }
}

/**
 * Return the device for this browser profile, generating + registering one the
 * first time. The private key stays local; only the public key is ever sent to
 * the server.
 */
export async function ensureDevice(
  userId: string,
  register: boolean = true,
): Promise<ClientDevice | null> {
  const cached = loadDevice(userId);
  if (cached && cached.deviceKeyId) {
    // Confirm the stored halves are a real pair before trusting them. A
    // mismatched or partially-corrupted pair makes every later unwrap fail
    // deep inside WebCrypto, which surfaced as the thread sitting on
    // "Setting up..." forever. Re-registering is the cheap, correct recovery.
    if (
      await isCoherentDeviceKeyPair(cached.publicKeyB64, cached.privateKeyB64)
    ) {
      return cached;
    }
    try {
      window.localStorage.removeItem(storageKey(userId));
    } catch {
      // Storage unavailable; a fresh key below will simply fail to persist and
      // re-register on the next load, which is the pre-existing behaviour.
    }
  }

  const pair = await generateDeviceKeys();
  const fingerprint = await fingerprintPublicKey(pair.publicKeyB64);

  let result: RegisterDeviceResult;
  if (register) {
    result = await registerDeviceKeyAction({ publicKeyB64: pair.publicKeyB64 });
    if (!result.ok) return null;
  } else {
    result = { ok: true, deviceKeyId: "", fingerprint };
  }

  const device: ClientDevice = {
    ...pair,
    deviceKeyId: result.deviceKeyId,
    fingerprint,
  };
  saveDevice(userId, device);
  return device;
}

/** Unwrap a thread key from one of the caller's wraps using the local key. */
export async function unwrapMyThreadKey(input: {
  device: ClientDevice;
  wraps: Array<{
    publicKeyId: string;
    issuerPublicKeyB64: string;
    wrappedKeyB64: string;
  }>;
}): Promise<string | null> {
  const wrap = input.wraps.find(
    (w) => w.publicKeyId === input.device.deviceKeyId,
  );
  if (!wrap) return null;
  return unwrapThreadKeyForMember(
    wrap.wrappedKeyB64,
    input.device.privateKeyB64,
    wrap.issuerPublicKeyB64,
  );
}

/** Generate a fresh thread key and wrap it for every selected member device. */
export async function buildConversationWraps(input: {
  device: ClientDevice;
  members: Array<{
    userId: string;
    devices: Array<{ id: string; publicKeyB64: string }>;
  }>;
}): Promise<{
  threadKeyB64: string;
  entries: Array<{
    userId: string;
    publicKeyId: string;
    wrappedKeyB64: string;
  }>;
} | null> {
  const threadKeyB64 = await generateThreadKey();
  const entries: Array<{
    userId: string;
    publicKeyId: string;
    wrappedKeyB64: string;
  }> = [];

  for (const member of input.members) {
    if (member.devices.length === 0) return null;
    // Wrap once per registered device so every device can decrypt.
    for (const device of member.devices) {
      const wrapped = await wrapThreadKeyForMember({
        threadKeyB64,
        theirPublicKeyB64: device.publicKeyB64,
        ourPrivateKeyB64: input.device.privateKeyB64,
      });
      entries.push({
        userId: member.userId,
        publicKeyId: device.id,
        wrappedKeyB64: wrapped.wrappedKeyB64,
      });
    }
  }

  return { threadKeyB64, entries };
}

/**
 * Re-wrap the *existing* thread key for devices that do not hold a copy.
 *
 * The server cannot do this for anyone: it stores only wrapped copies, so the
 * plaintext key exists solely in a browser that already decrypted it. That is
 * why a device which lost its private key (a sign-out, cleared site data, a new
 * browser) is unrecoverable on its own, and why the repair has to come from
 * another device that still holds the key.
 *
 * `threadKeyB64` is the caller's already-unwrapped copy. The output entries are
 * the same shape `buildConversationWraps` returns, so the submit path is
 * identical to conversation creation.
 */
export async function rewrapThreadKeyForDevices(input: {
  device: ClientDevice;
  /** The caller's existing plaintext thread key. */
  threadKeyB64: string;
  targets: Array<{ userId: string; publicKeyId: string; publicKeyB64: string }>;
}): Promise<{
  entries: Array<{
    userId: string;
    publicKeyId: string;
    wrappedKeyB64: string;
  }>;
  issuerPublicKeyB64: string;
}> {
  const entries: Array<{
    userId: string;
    publicKeyId: string;
    wrappedKeyB64: string;
  }> = [];
  for (const t of input.targets) {
    const wrapped = await wrapThreadKeyForMember({
      threadKeyB64: input.threadKeyB64,
      theirPublicKeyB64: t.publicKeyB64,
      ourPrivateKeyB64: input.device.privateKeyB64,
    });
    entries.push({
      userId: t.userId,
      publicKeyId: t.publicKeyId,
      wrappedKeyB64: wrapped.wrappedKeyB64,
    });
  }
  return { entries, issuerPublicKeyB64: input.device.publicKeyB64 };
}

export { decryptMessage, encryptMessage };
export type { MessageContext, ProtocolVersion } from "./crypto";
