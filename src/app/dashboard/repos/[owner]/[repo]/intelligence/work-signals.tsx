"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmWorkSignalAction } from "./actions";
import { IconAlertCircle, IconBookmark, IconCheck } from "@/components/icons";
import { useTranslation } from "@/lib/i18n/provider";
import type { WorkSignal } from "@/lib/intelligence/work-detection";

/**
 * Work signals (aa.md §17).
 *
 * Two commitments shape this component.
 *
 * First, nothing is created without a click. Detection proposes; the developer
 * confirms. The button is the only thing that writes a work context.
 *
 * Second, confidence is shown. Signals proven by a stored row are marked "from
 * GitHub"; signals inferred purely from elapsed time are marked "inferred".
 * A developer deciding what to pick up is entitled to know which of these they
 * are looking at before they trust it.
 */
export function WorkSignalList({
  owner,
  repo,
  signals,
}: {
  owner: string;
  repo: string;
  signals: WorkSignal[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  if (signals.length === 0) return null;

  const confirm = (signalId: string) => {
    setPendingId(signalId);
    setError(null);
    startTransition(async () => {
      const res = await confirmWorkSignalAction({ owner, repo, signalId });
      if (res.ok) {
        setSaved((prev) => new Set(prev).add(signalId));
        router.refresh();
      } else {
        setError(res.error);
      }
      setPendingId(null);
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
      <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
        <h2 className="text-sm font-semibold text-white">{t("intelligence:work_title")}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{t("intelligence:work_subtitle")}</p>
      </div>

      {error ? (
        <p className="flex items-start gap-2 border-b border-white/[0.05] px-5 py-3 text-xs text-danger-300">
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-white/[0.05]">
        {signals.map((s) => {
          const isSaved = saved.has(s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={s.href}
                    className="truncate text-xs font-semibold text-white underline-offset-2 hover:underline"
                  >
                    {s.title}
                  </a>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wide ${
                      s.confidence === "high" ? "text-brand-300" : "text-warn-300"
                    }`}
                  >
                    {s.confidence === "high" ? "from GitHub" : "inferred from inactivity"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{s.detail}</p>
                {s.evidence.length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.evidence.map((e) => (
                      <li
                        key={e.label}
                        className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-ink-400"
                      >
                        {e.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => confirm(s.id)}
                disabled={pendingId === s.id || isSaved}
                className="btn btn-ghost btn-sm shrink-0 justify-center text-xs text-brand-300 hover:text-white disabled:opacity-60"
              >
                {isSaved ? (
                  <>
                    <IconCheck className="h-3 w-3" />
                    <span>{t("intelligence:work_saved")}</span>
                  </>
                ) : (
                  <>
                    <IconBookmark className="h-3 w-3" />
                    <span>
                      {pendingId === s.id ? t("intelligence:work_saving") : t("intelligence:work_save")}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
