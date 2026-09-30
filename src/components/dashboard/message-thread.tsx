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
import {
  ensureDevice,
  unwrapMyThreadKey,
  decryptMessage,
} from "@/lib/messaging/client";
import { IconSend, IconLock, IconAlertCircle } from "@/components/icons";
import { DeviceRecovery } from "@/components/dashboard/device-recovery";
import { useI18n } from "@/lib/i18n/provider";

interface ThreadProps {
  conversationId: string;
  teamId?: string;
  orgId?: string;
  backHref?: string;
  currentUserId: string;
  currentUserLogin: string;
  initialMembers: Array<{
    userId: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  }>;
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
  const { t } = useI18n();
  const [threadKeyB64, setThreadKeyB64] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  // Mirrors `messages` so the poll tick can dedupe and count against the
  // current list without reading a stale render closure or reaching into a
  // state updater for a side effect.
  const messagesRef = useRef<DecryptedMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [unlocking, setUnlocking] = useState(true);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [total, setTotal] = useState(initialMessageCount);
  // Older history beyond the server-rendered window. Without this the window
  // was a one-way door: `listMessagesAction` accepted a `beforeId` cursor and
  // returned `hasMore`, but nothing ever read either, so a long thread could
  // only ever show its most recent page.
  const [olderCursor, setOlderCursor] = useState<string | null>(
    initialMessages.length > 0 ? initialMessages[0].id : null,
  );
  const [hasOlder, setHasOlder] = useState(
    initialMessageCount > initialMessages.length,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const latestRef = useRef<string | null>(
    initialMessages[initialMessages.length - 1]?.id ?? null,
  );
  const keyRef = useRef<string | null>(null);
  // Thread key epoch in force for this session; part of the v2 AAD on send.
  const epochRef = useRef<number>(0);
  // Idempotency key for the message currently being sent, held across retries
  // of the same draft so an ambiguous failure cannot duplicate it.
  const pendingIdRef = useRef<string | null>(null);
  const pendingTextRef = useRef<string | null>(null);

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
        if (m.protocolVersion !== "v1" && m.protocolVersion !== "v2") {
          out.push({ ...m, plaintext: "⚠ unsupported message scheme" });
          continue;
        }
        try {
          // v2 binds the ciphertext to its own conversation, sender, client
          // id, and epoch, so a blob moved or relabelled between messages
          // fails the GCM tag instead of decrypting as valid content.
          out.push({
            ...m,
            plaintext: await decryptMessage(m.ciphertext, key, {
              conversationId: m.conversationId,
              senderId: m.senderId,
              clientMessageId: m.clientMessageId,
              epoch: m.epoch,
            }),
          });
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
            setUnlockError(
              "Could not set up your device key for this browser.",
            );
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
            // The previous copy told the reader to ask an admin to wrap this
            // device, but no such capability existed anywhere in the product, so
            // the instruction was impossible to follow. There is one now: any
            // member who can still read the thread can re-share the key from the
            // "Devices without access" control below.
            setUnlockError(
              "This browser has no key to this conversation, so its history cannot be decrypted here. If you signed out, cleared site data, or switched browsers, the old device key is gone. A teammate who can still read this conversation can restore access from the control below.",
            );
            setReady(true);
          }
          return;
        }
        keyRef.current = key;
        epochRef.current = tk.epoch;
        if (!cancelled) setThreadKeyB64(key);
      } catch (e) {
        // Without this the rejection escaped as an unhandled promise, `finally`
        // cleared `unlocking`, and `ready` stayed false -- so the thread sat on
        // "Setting up..." forever with a disabled composer and no way to retry
        // short of a full page reload. Any of ensureDevice / getThreadKeyAction
        // / unwrapMyThreadKey can reject (expired session, WebCrypto failure,
        // a device key that no longer matches its wrap).
        if (!cancelled) {
          setUnlockError(
            e instanceof Error && e.message
              ? e.message
              : "Could not unlock this conversation on this device.",
          );
          setReady(true);
        }
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
      messagesRef.current = decrypted;
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

        // The count has to come from the *same* deduplication that decides
        // whether to append, and both have to be settled before either setter
        // runs.
        //
        // This previously assigned `newCount` from inside the `setMessages`
        // updater and then read it in `setTotal`. React only calls an updater
        // during the next render, so `setTotal` saw `0` and the header stayed
        // frozen at the server's count while messages visibly streamed in. It
        // was also a side effect inside a state updater, which React is free to
        // invoke more than once.
        const seen = new Set(messagesRef.current.map((m) => m.id));
        const fresh = decrypted.filter((m) => !seen.has(m.id));
        if (fresh.length > 0) {
          const next = [...messagesRef.current, ...fresh].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
          messagesRef.current = next;
          setMessages(next);
          setTotal((t) => t + fresh.length);
          latestRef.current = next[next.length - 1]?.id ?? latestRef.current;
        }
        await markRead();
      } catch {
        // transient polling failure — retry next tick
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [threadKeyB64, conversationId, decryptBatch, markRead]);

  /** Prepend one older page. Cursor comes from the server, never computed here. */
  const loadOlder = async () => {
    if (!threadKeyB64 || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await listMessagesAction({
        conversationId,
        beforeId: olderCursor,
        limit: 60,
      });
      if (!res.ok) {
        setHasOlder(false);
        return;
      }
      const decrypted = await decryptBatch(res.messages);
      const known = new Set(messagesRef.current.map((m) => m.id));
      const fresh = decrypted.filter((m) => !known.has(m.id));
      if (fresh.length > 0) {
        const merged = [...fresh, ...messagesRef.current].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
        messagesRef.current = merged;
        setMessages(merged);
      }
      setHasOlder(res.hasMore);
      setOlderCursor(res.nextBeforeId);
    } catch (e) {
      // Leave the cursor where it is so the button can be pressed again.
      setSendError(
        e instanceof Error ? e.message : "Could not load earlier messages.",
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !threadKeyB64) return;
    setSending(true);
    setSendError(null);
    try {
      const { encryptMessage } = await import("@/lib/messaging/client");
      // The idempotency key is minted once per *draft*, not once per attempt,
      // and is discarded only when the send definitively resolves.
      //
      // The server deduplicates on @@unique([senderId, clientMessageId]) and
      // short-circuits a repeat to the original message. That guarantee is worth
      // nothing if the client re-mints the id on every retry: if the first call
      // committed but its response was lost (mobile network drop, proxy
      // timeout, failed revalidatePath), the user's retry looked like a new
      // message and posted a permanent duplicate.
      let clientMessageId = pendingIdRef.current;
      if (!clientMessageId || pendingTextRef.current !== text) {
        clientMessageId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${currentUserId}-${Date.now()}`;
        pendingIdRef.current = clientMessageId;
        pendingTextRef.current = text;
      }
      // Bind the ciphertext to this exact message's identity. Without it a
      // member could copy a blob out of one conversation, or replay it under a
      // new client id, and it would decrypt as valid content elsewhere.
      const context = {
        conversationId,
        senderId: currentUserId,
        clientMessageId,
        epoch: epochRef.current,
      };
      const wrapped = await encryptMessage(text, threadKeyB64, context);
      const result = await sendMessageAction({
        conversationId,
        ciphertext: wrapped.ct,
        clientMessageId,
        protocolVersion: "v2",
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
        protocolVersion: "v2",
        clientMessageId,
        epoch: context.epoch,
        conversationId,
        createdAt: new Date(),
        plaintext: text,
      };
      const appended = [...messagesRef.current, sent];
      messagesRef.current = appended;
      setMessages(appended);
      // The message is durably stored, so the draft's identity has served its
      // purpose and a later draft must get a fresh key.
      pendingIdRef.current = null;
      pendingTextRef.current = null;
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

      <DeviceRecovery
        conversationId={conversationId}
        currentUserId={currentUserId}
      />

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
        ) : (
          <div className="space-y-3">
            {hasOlder ? (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="btn btn-ghost btn-sm text-[11px]"
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            ) : messages.length > 0 ? (
              <p className="pb-1 text-center text-[10px] text-ink-500">
                Start of conversation
              </p>
            ) : null}
            {messages.length === 0 ? (
              <p className="py-12 text-center text-xs text-ink-500">
                No messages yet. Say hello. Every message is encrypted on your
                device.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === currentUserId;
                return (
                  <div
                    key={m.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                        mine
                          ? "rounded-br-md bg-brand-500/90 text-on-brand"
                          : "rounded-bl-md border border-white/[0.06] bg-ink-950/70 text-ink-100"
                      }`}
                    >
                      {!mine ? (
                        <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-ink-400">
                          @{m.senderLogin}
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                        {m.plaintext}
                      </p>
                      <p
                        className={`mt-1 text-right font-mono text-[9px] ${mine ? "text-on-brand/70" : "text-ink-500"}`}
                      >
                        {m.createdAt.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/[0.07] p-3">
        {sendError ? (
          <p
            role="alert"
            className="mb-2 text-[11px] font-medium text-danger-300"
          >
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
            placeholder={
              canDecrypt ? "Write a message…" : "Unlock the thread to write."
            }
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
            aria-label={t("messaging:send_message")}
            className="btn btn-primary btn-sm h-10 shrink-0"
          >
            <IconSend className="h-4 w-4" />
            <span className="hidden sm:inline">
              {sending ? "Sending…" : "Send"}
            </span>
          </button>
        </form>
        <LinkBack teamId={teamId} orgId={orgId} backHref={backHref} />
      </div>
    </div>
  );
}

function LinkBack({
  teamId,
  orgId,
  backHref,
}: {
  teamId?: string;
  orgId?: string;
  backHref?: string;
}) {
  const router = useRouter();
  const dest =
    backHref ??
    (teamId
      ? `/dashboard/team/${teamId}/messaging`
      : orgId
        ? `/dashboard/organization/${orgId}/messaging`
        : "/dashboard/messages");
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
