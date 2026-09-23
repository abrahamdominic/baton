"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { giftPlanAction, type GiftActionResult } from "./actions";
import { IconGift, IconSearch, IconCheck, IconChevronDown, IconX, IconShield } from "@/components/icons";

export interface GiftUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  suspendedAt: string | null;
}

export interface GiftPlanOption {
  id: string;
  slug: string;
  name: string;
  price_custom: boolean;
  monthly_price_cents: number;
  annual_price_cents: number;
}

export function GiftForm({
  users,
  plans,
}: {
  users: GiftUser[];
  plans: GiftPlanOption[];
}) {
  const [state, formAction, pending] = useActionState<GiftActionResult, FormData>(giftPlanAction, { ok: false });

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [durationType, setDurationType] = useState<"monthly" | "annual">("monthly");
  const [monthsValue, setMonthsValue] = useState(3);
  const [yearsValue, setYearsValue] = useState(1);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"form" | "confirm" | "success">("form");
  const comboRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 50);
    return users.filter(
      (u) =>
        u.login.toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q),
    ).slice(0, 50);
  }, [users, query]);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;
  const selectedPlan = plans.find((p) => p.id === planId) ?? null;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (state.ok) setMode("success");
  }, [state]);

  const months = durationType === "monthly" ? monthsValue : Math.min(10, yearsValue) * 12;
  const accessEndsAt = useMemo(() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  }, [months]);

  const priceLabel =
    selectedPlan && !selectedPlan.price_custom
      ? durationType === "annual"
        ? `$${(selectedPlan.annual_price_cents / 100).toFixed(2)}/year value`
        : `$${(selectedPlan.monthly_price_cents / 100).toFixed(2)}/month value`
      : "custom priced";

  const resetAll = () => {
    setSelectedUserId(null);
    setQuery("");
    setPlanId(plans[0]?.id ?? "");
    setDurationType("monthly");
    setMonthsValue(3);
    setYearsValue(1);
    setNote("");
    setMode("form");
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3.5">
          <IconGift className="h-4 w-4 text-brand-300" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-300">
            Gift a paid plan
          </span>
        </div>

        <div className="p-5">
          {mode === "success" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-signal-500/30 bg-signal-500/10 p-4">
                <IconCheck className="mt-0.5 h-5 w-5 shrink-0 text-signal-300" />
                <div>
                  <p className="text-sm font-semibold text-white">Paid plan gifted</p>
                  <p className="mt-0.5 text-sm text-ink-300">{state.detail}</p>
                  <p className="mt-1 text-xs text-ink-400">
                    Recorded in the audit log, gift grants ledger, and subscription history. The user&apos;s
                    billing page shows an admin-gifted badge and the exact access-end date.
                  </p>
                </div>
              </div>
              <button type="button" onClick={resetAll} className="btn btn-ghost btn-sm">
                Gift another plan
              </button>
            </div>
          ) : null}

          {mode === "form" ? (
            <div className="space-y-5">
              {/* Row 1: user + plan + duration */}
              <div className="grid gap-5 md:grid-cols-2">
                {/* User search combobox */}
                <div ref={comboRef} className="relative">
                  <label className="mb-1.5 block text-xs font-medium text-ink-300">Recipient</label>
                  {selectedUser ? (
                    <div className="flex items-center justify-between rounded-lg border border-brand-500/40 bg-ink-950/60 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        {selectedUser.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedUser.avatarUrl}
                            alt={selectedUser.login}
                            className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15"
                          />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
                            {selectedUser.login.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-semibold text-white">@{selectedUser.login}</p>
                          {selectedUser.name ? (
                            <p className="truncate text-xs text-ink-400">{selectedUser.name}</p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUserId(null);
                          setQuery("");
                        }}
                        aria-label="Clear selected user"
                        className="rounded-md p-1 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        <IconX className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <IconSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-500" />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        placeholder="Search @login or name…"
                        className="w-full rounded-lg border border-white/[0.1] bg-ink-950/60 pl-9 pr-9 py-2.5 text-sm text-white placeholder:text-ink-500 outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
                      />
                      <IconChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-ink-500" />
                    </div>
                  )}

                  {!selectedUser && open ? (
                    <ul className="absolute z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-white/[0.1] bg-ink-900 shadow-2xl">
                      {filtered.length === 0 ? (
                        <li className="px-3 py-3 text-sm text-ink-500">No users match “{query}”.</li>
                      ) : (
                        filtered.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedUserId(u.id);
                                setOpen(false);
                                setQuery("");
                              }}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04]"
                            >
                              {u.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={u.avatarUrl}
                                  alt={u.login}
                                  className="h-7 w-7 shrink-0 rounded-full ring-1 ring-white/10"
                                />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-[11px] font-bold text-ink-200">
                                  {u.login.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="font-mono text-sm text-white">@{u.login}</span>
                                {u.name ? <span className="text-xs text-ink-400"> · {u.name}</span> : null}
                              </div>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>

                {/* Plan select */}
                <div>
                  <label htmlFor="gift-plan" className="mb-1.5 block text-xs font-medium text-ink-300">
                    Plan
                  </label>
                  <select
                    id="gift-plan"
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.1] bg-ink-950/60 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id} className="bg-ink-900">
                        {p.name} — ${(p.monthly_price_cents / 100).toFixed(2)}/mo
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Duration */}
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-300">Duration</label>
                  <div className="flex overflow-hidden rounded-lg border border-white/[0.1]">
                    <button
                      type="button"
                      onClick={() => setDurationType("monthly")}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                        durationType === "monthly"
                          ? "bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/30"
                          : "text-ink-400 hover:bg-white/[0.04]"
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setDurationType("annual")}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                        durationType === "annual"
                          ? "bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/30"
                          : "text-ink-400 hover:bg-white/[0.04]"
                      }`}
                    >
                      Annual
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    {durationType === "annual"
                      ? "One year-long grant per selected year."
                      : "The grant renews at the end unless an administrator extends it."}
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-300">
                    {durationType === "monthly" ? "Months of access" : "Years of access"}
                  </label>
                  {durationType === "monthly" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 3, 6, 12].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMonthsValue(m)}
                            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              monthsValue === m
                                ? "border-brand-500/50 bg-brand-500/10 text-brand-300"
                                : "border-white/[0.08] text-ink-400 hover:border-white/[0.16]"
                            }`}
                          >
                            {m}mo
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-ink-950/50 px-2.5 py-1">
                        <span className="text-[11px] text-ink-500">Custom</span>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={monthsValue}
                          onChange={(e) => setMonthsValue(Number(e.target.value))}
                          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-ink-600"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex gap-1.5">
                        {[1, 2, 3].map((y) => (
                          <button
                            key={y}
                            type="button"
                            onClick={() => setYearsValue(y)}
                            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              yearsValue === y
                                ? "border-brand-500/50 bg-brand-500/10 text-brand-300"
                                : "border-white/[0.08] text-ink-400 hover:border-white/[0.16]"
                            }`}
                          >
                            {y}y
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-ink-950/50 px-2.5 py-1">
                        <span className="text-[11px] text-ink-500">Custom</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={yearsValue}
                          onChange={(e) => setYearsValue(Number(e.target.value))}
                          className="w-full bg-transparent text-sm text-white outline-none"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Note */}
              <div>
                <label htmlFor="gift-note" className="mb-1.5 block text-xs font-medium text-ink-300">
                  Note (optional)
                </label>
                <textarea
                  id="gift-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Why is this being gifted? (visible to other admins and in the audit trail)"
                  className="w-full resize-none rounded-lg border border-white/[0.1] bg-ink-950/60 px-3 py-2.5 text-sm text-white placeholder:text-ink-500 outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              {!state.ok && state.error ? (
                <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-300">
                  {state.error}
                </p>
              ) : null}

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
                <p className="text-[11px] text-ink-500">
                  No money moves. Access expires automatically. Fully audited.
                </p>
                <button
                  type="button"
                  disabled={!selectedUser || !planId}
                  onClick={() => setMode("confirm")}
                  className="btn btn-primary btn-sm"
                >
                  Review gift
                </button>
              </div>
            </div>
          ) : null}

          {mode === "confirm" ? (
            <form action={formAction} className="space-y-5">
              {/* Summary */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-ink-950/50 p-4">
                  {selectedUser?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedUser.avatarUrl}
                      alt={selectedUser.login}
                      className="h-10 w-10 shrink-0 rounded-full ring-1 ring-white/15"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-sm font-bold text-ink-200">
                      {selectedUser?.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-white">@{selectedUser?.login}</p>
                    <p className="truncate text-xs text-ink-400">{selectedUser?.name ?? "GitHub user"}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-ink-950/50 p-4">
                  <p className="text-xs font-medium text-ink-300">Grant summary</p>
                  <p className="mt-1.5 text-sm text-white">
                    <span className="font-semibold text-brand-300">{selectedPlan?.name}</span> ·{" "}
                    {months} month{months === 1 ? "" : "s"} ({durationType})
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {priceLabel} · access until {accessEndsAt}
                  </p>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-4 text-xs">
                <p className="flex items-center gap-2 font-medium text-amber-300">
                  <IconShield className="h-4 w-4" />
                  This is real paid access. Confirm the details before granting.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-ink-300">
                  <li>No payment or Stripe/USDC charge is created against the user.</li>
                  <li>The user&apos;s plan features and limits unlock immediately.</li>
                  <li>Access ends automatically on {accessEndsAt} — it never renews or charges.</li>
                  <li>The action is recorded in the immutable audit log and subscription history.</li>
                </ul>
              </div>

              {note ? (
                <p className="rounded-lg border border-white/[0.08] bg-ink-950/50 px-3 py-2 text-xs text-ink-300">
                  <span className="font-medium text-ink-400">Note:</span> {note}
                </p>
              ) : null}

              <input type="hidden" name="userId" value={selectedUserId ?? ""} />
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="durationType" value={durationType} />
              <input type="hidden" name="months" value={String(months)} />
              <textarea name="note" value={note} readOnly className="hidden" aria-hidden="true" tabIndex={-1} />

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.1] bg-ink-950/50 px-3 py-2.5 text-sm text-ink-200">
                <input
                  type="checkbox"
                  name="confirm"
                  className="h-4 w-4 rounded accent-brand-500"
                  defaultChecked={false}
                />
                I confirm that gifting this plan grants real paid access without payment.
              </label>

              {!state.ok && state.error ? (
                <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-300">
                  {state.error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-4">
                <button type="button" onClick={() => setMode("form")} className="btn btn-ghost btn-sm">
                  Back
                </button>
                <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
                  {pending ? "Gifting…" : "Confirm gift"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}