"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageSummary } from "@/app/dashboard/team/[teamId]/messaging/actions";
import {
  getThreadKeyAction,
  listMessagesAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/app/dashboard/team/[teamId]/messaging/actions";
import { ensureDevice, unwrapMyThreadKey, decryptMessage } from "@/lib/messaging/client";
import { IconSend, IconLock, IconAlertCircle } from "@/components/icons";

interface ThreadProps {
  conversationId: string;
  teamId?: string;
  orgId?: string;
  backHref?: string;
  currentUserId: string;
  currentUserLogin: string;
  initialMembers: Array<{ userId: string; login: string; name: string | null; avatarUrl: string | null }>;
  initialMessages: MessageSummary[];
  initialMessageCount: number;
}

interface DecryptedMessage extends MessageSummary {
  plaintext: string;
}

export function MessageThread({
  conversationId,
  teamId,
  orgId,
  backHref,
  currentUserId,
  currentUserLogin,
  initialMembers,
  initialMessages,
  initialMessageCount,
}: ThreadProps) {
  const [threadKeyB64, setThreadKeyB64] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [unlocking, setUnlocking] = useState(true);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [total, setTotal] = useState(initialMessageCount);
  const latestRef = useRef<string | null>(initialMessages[initialMessages.length - 1]?.id ?? null);
  const keyRef = useRef<string | null>(null);

  const canDecrypt = Boolean(threadKeyB64);

  const markRead = useCallback(async () => {
    if (!latestRef.current) return;
    await markConversationReadAction({ conversationId }).catch(() => {});
  }, [conversationId]);

  const decryptBatch = useCallback(
    async (rows: MessageSummary[]): Promise<DecryptedMessage[]> => {
      const key = keyRef.current;
      if (!key) return [];
      const out: DecryptedMessage[] = [];
      for (const m of rows) {
        if (m.protocolVersion !== "v1") {
          out.push({ ...m, plaintext: "⚠ unsupported message scheme" });
          continue;
        }
        try {
          out.push({ ...m, plaintext: await decryptMessage(m.ciphertext, key) });
        } catch {
          out.push({ ...m, plaintext: "⚠ undecryptable message" });
        }
      }
      return out;
    },
    [],
  );

  // Unlock the thread key once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUnlocking(true);
      try {
        const device = await ensureDevice(currentUserId);
        if (!device) {
          if (!cancelled) {
            setUnlockError("Could not set up your device key for this browser.");
            setReady(true);
          }
          return;
        }
        const tk = await getThreadKeyAction({ conversationId });
        if (!tk.ok) {
          if (!cancelled) {
            setUnlockError(tk.error);
            setReady(true);
          }
          return;
        }
        const key = await unwrapMyThreadKey({ device, wraps: tk.wraps });
        if (!key) {
          if (!cancelled) {
            setUnlockError(
              "This device has no key to this conversation. A conversation admin needs to include this device when wrapping the thread key.",
            );
            setReady(true);
          }
          return;
        }
        keyRef.current = key;
        if (!cancelled) setThreadKeyB64(key);
      } finally {
        if (!cancelled) setUnlocking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, currentUserId]);

  // Decrypt the initial batch once the key is available.
  useEffect(() => {
    if (!threadKeyB64) return;
    (async () => {
      const decrypted = await decryptBatch(initialMessages);
      setMessages(decrypted);
      setReady(true);
      latestRef.current = decrypted[decrypted.length - 1]?.id ?? null;
      await markRead();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKeyB64]);

  // Poll for new messages while the thread is open.
  useEffect(() => {
    if (!threadKeyB64) return;
    const timer = setInterval(async () => {
      try {
        const res = await listMessagesAction({ conversationId, limit: 30 });
        if (!res.ok) return;
        const decrypted = await decryptBatch(res.messages);
        let newCount = 0;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = decrypted.filter((m) => !seen.has(m.id));
          if (fresh.length === 0) return prev;
          newCount = fresh.length;
          const next = [...prev, ...fresh].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
          latestRef.current = next[next.length - 1]?.id ?? latestRef.current;
          return next;
        });
        setTotal((t) => t + newCount);
        await markRead();
      } catch {
        // transient polling failure — retry next tick
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [threadKeyB64, conversationId, decryptBatch, markRead]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !threadKeyB64) return;
    setSending(true);
    setSendError(null);
    try {
      const { encryptMessage } = await import("@/lib/messaging/client");
      const wrapped = await encryptMessage(text, threadKeyB64);
      const clientMessageId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${currentUserId}-${Date.now()}`;
      const result = await sendMessageAction({
        conversationId,
        ciphertext: wrapped.ct,
        clientMessageId,
      });
      if (!result.ok) {
        setSendError(result.error);
        return;
      }
      const sent: DecryptedMessage = {
        id: result.messageId,
        senderId: currentUserId,
        senderLogin: currentUserLogin,
        senderName: null,
        senderAvatarUrl: null,
        ciphertext: wrapped.ct,
        protocolVersion: "v1",
        clientMessageId,
        createdAt: new Date(),
        plaintext: text,
      };
      setMessages((prev) => [...prev, sent]);
      setDraft("");
      setTotal((t) => t + 1);
      await markRead();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  };

  const others = useMemo(
    () =>
      initialMembers
        .filter((m) => m.userId !== currentUserId)
        .map((m) => (m.name ?? m.login).trim())
        .join(", ") || "No one else yet",
    [initialMembers, currentUserId],
  );

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{others}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-500">
            {total} message{total === 1 ? "" : "s"} · encrypted
          </p>
        </div>
        {canDecrypt ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-2 py-0.5 font-mono text-[10px] font-semibold text-signal-300">
            <IconLock className="h-3 w-3" />
            Decrypted locally
          </span>
        ) : null}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {!ready ? (
          <p className="text-center text-xs text-ink-500">
            {unlocking ? "Unlocking your thread key…" : "Setting up…"}
          </p>
        ) : unlockError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-warn-500/20 bg-warn-500/[0.05] px-4 py-6 text-center">
            <IconAlertCircle className="h-5 w-5 text-warn-400" />
            <p className="text-xs font-medium text-ink-200">{unlockError}</p>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-12 text-center text-xs text-ink-500">
            No messages yet. Say hello. Every message is encrypted on your device.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                    mine
                      ? "rounded-br-md bg-brand-500/90 text-white"
                      : "rounded-bl-md border border-white/[0.06] bg-ink-950/70 text-ink-100"
                  }`}
                >
                  {!mine ? (
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-ink-400">
                      @{m.senderLogin}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.plaintext}</p>
                  <p className={`mt-1 text-right font-mono text-[9px] ${mine ? "text-white/60" : "text-ink-500"}`}>
                    {m.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/[0.07] p-3">
        {sendError ? (
          <p role="alert" className="mb-2 text-[11px] font-medium text-danger-300">
            {sendError}
          </p>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canDecrypt ? "Write a message…" : "Unlock the thread to write."}
            disabled={!canDecrypt || sending}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="input h-10 min-h-10 flex-1 resize-none py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!canDecrypt || !draft.trim() || sending}
            aria-label="Send message"
            className="btn btn-primary btn-sm h-10 shrink-0"
          >
            <IconSend className="h-4 w-4" />
            <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
          </button>
        </form>
        <LinkBack teamId={teamId} orgId={orgId} backHref={backHref} />
      </div>
    </div>
  );
}

function LinkBack({ teamId, orgId, backHref }: { teamId?: string; orgId?: string; backHref?: string }) {
  const router = useRouter();
  const dest = backHref ?? (teamId ? `/dashboard/team/${teamId}/messaging` : orgId ? `/dashboard/organization/${orgId}/messaging` : "/dashboard/messages");
  return (
    <button
      type="button"
      onClick={() => router.push(dest)}
      className="mt-2 text-[10px] font-medium text-ink-500 transition-colors hover:text-brand-300"
    >
      ← Back to conversations
    </button>
  );
}