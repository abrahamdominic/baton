"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listConversationDevicesAction,
  submitConversationDeviceWrapsAction,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import {
  ensureDevice,
  rewrapThreadKeyForDevices,
} from "@/lib/messaging/client";
import {
  IconAlertCircle,
  IconCheckCircle,
  IconUsers,
} from "@/components/icons";

/**
 * Repair a device that holds no key to this conversation.
 *
 * The thread key is end-to-end encrypted, so the server only ever has wrapped
 * copies. That means a browser which lost its private key -- by signing out,
 * clearing site data, or simply being a new browser -- cannot be fixed by the
 * server, and there was previously no way to fix it at all: the error used to
 * tell the reader to ask an admin to include the device, but no such capability
 * existed anywhere in the product.
 *
 * The recovery is that any device which *does* hold the key re-wraps it for the
 * ones that do not. This panel is that action. It is offered to anyone who can
 * already decrypt the thread, because holding a wrap is the proof of possession
 * the server checks.
 */
export function DeviceRecovery({
  conversationId,
  currentUserId,
}: {
  conversationId: string;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [missing, setMissing] = useState<
    Array<{ userId: string; login: string; devices: Array<{ id: string }> }>
  >([]);

  const load = useCallback(async () => {
    const res = await listConversationDevicesAction({ conversationId });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!res.callerCanProvision) {
      setError(
        "This browser has no key to the conversation, so it cannot add one for others. Ask a teammate who can still read the thread.",
      );
      return;
    }
    setMissing(
      res.members
        .map((m) => ({
          userId: m.userId,
          login: m.login,
          devices: m.devices.filter((d) => !d.hasWrap),
        }))
        .filter((m) => m.devices.length > 0),
    );
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    void load();
  }, [open, load]);

  const provision = async () => {
    if (missing.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const device = await ensureDevice(currentUserId);
      if (!device) {
        setError("Could not set up this browser's device key.");
        return;
      }
      // The caller's own plaintext key, which only exists here because this
      // browser can already decrypt the thread.
      const tk =
        await import("@/app/dashboard/team/[teamId]/messaging/actions").then(
          (m) => m.getThreadKeyAction({ conversationId }),
        );
      if (!tk.ok) {
        setError(tk.error);
        return;
      }
      const { unwrapMyThreadKey } = await import("@/lib/messaging/client");
      const threadKeyB64 = await unwrapMyThreadKey({ device, wraps: tk.wraps });
      if (!threadKeyB64) {
        setError(
          "This browser no longer has the key, so it cannot re-share it.",
        );
        return;
      }

      const listed = await listConversationDevicesAction({ conversationId });
      if (!listed.ok) {
        setError(listed.error);
        return;
      }
      const targets = listed.members.flatMap((m) =>
        m.devices
          .filter((d) => !d.hasWrap)
          .map((d) => ({
            userId: m.userId,
            publicKeyId: d.id,
            publicKeyB64: d.publicKeyB64,
          })),
      );
      if (targets.length === 0) {
        setDone(0);
        setMissing([]);
        return;
      }
      const { entries, issuerPublicKeyB64 } = await rewrapThreadKeyForDevices({
        device,
        threadKeyB64,
        targets,
      });
      const res = await submitConversationDeviceWrapsAction({
        conversationId,
        wraps: entries.map((e) => ({ ...e, issuerPublicKeyB64 })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.saved);
      setMissing([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the devices.");
    } finally {
      setBusy(false);
    }
  };

  const deviceCount = missing.reduce((n, m) => n + m.devices.length, 0);

  return (
    <div className="border-b border-white/[0.07] px-5 py-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-500 hover:text-ink-300"
        >
          <IconUsers className="h-3 w-3" />
          Devices without access
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-ink-400">
              {deviceCount === 0 && done === null
                ? "Checking devices…"
                : deviceCount === 0
                  ? "Every registered device can read this conversation."
                  : `${deviceCount} device${deviceCount === 1 ? "" : "s"} cannot read this conversation.`}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] text-ink-500 hover:text-ink-300"
            >
              Close
            </button>
          </div>

          {missing.length > 0 ? (
            <ul className="space-y-0.5">
              {missing.map((m) => (
                <li
                  key={m.userId}
                  className="font-mono text-[10px] text-ink-500"
                >
                  @{m.login} · {m.devices.length} device
                  {m.devices.length === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          ) : null}

          {done !== null && done > 0 ? (
            <p className="flex items-center gap-1.5 text-[10px] text-success-300">
              <IconCheckCircle className="h-3 w-3" />
              {done} device{done === 1 ? "" : "s"} can now read this
              conversation.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-[10px] text-warn-300"
            >
              <IconAlertCircle className="mt-px h-3 w-3 shrink-0" />
              {error}
            </p>
          ) : null}

          {missing.length > 0 ? (
            <button
              type="button"
              onClick={provision}
              disabled={busy}
              className="btn btn-primary btn-sm h-7 text-[10px]"
            >
              {busy ? "Adding…" : "Give them access"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
