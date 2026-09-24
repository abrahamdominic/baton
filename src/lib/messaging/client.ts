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
 * Return the device for this browser profile, generating + registering one the
 * first time. The private key stays local; only the public key is ever sent to
 * the server.
 */
export async function ensureDevice(
  userId: string,
  register: boolean = true,
): Promise<ClientDevice | null> {
  const cached = loadDevice(userId);
  if (cached && cached.deviceKeyId) return cached;

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
  wraps: Array<{ publicKeyId: string; issuerPublicKeyB64: string; wrappedKeyB64: string }>;
}): Promise<string | null> {
  const wrap = input.wraps.find((w) => w.publicKeyId === input.device.deviceKeyId);
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
  entries: Array<{ userId: string; publicKeyId: string; wrappedKeyB64: string }>;
} | null> {
  const threadKeyB64 = await generateThreadKey();
  const entries: Array<{ userId: string; publicKeyId: string; wrappedKeyB64: string }> = [];

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

export { decryptMessage, encryptMessage };