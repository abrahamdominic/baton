"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordDecisionAction, forgetDecisionAction } from "./actions";
import { IconAlertCircle, IconBrain, IconCheck, IconTrash, IconExternalLink } from "@/components/icons";
import { useTranslation } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui";
import type { KnowledgeFact, KnowledgeKind } from "@/lib/intelligence/knowledge";

/**
 * Repository memory (skill.md §15).
 *
 * The panel makes three distinctions visible, because collapsing them is how a
 * "memory" feature turns into a source of quiet misinformation:
 *
 *  - **observed** vs **recorded**: the first was read out of the repository, the
 *    second was written down by a person. Only the second can be edited or
 *    removed here.
 *  - **strength**: how strongly the evidence supports the claim. A hot directory
 *    found in 200 commits is not the same claim as one found in 3.
 *  - **observations**: how many collection runs have re-confirmed it unchanged.
 *    That count is what separates a durable fact from a one-off observation.
 */

const KIND_ORDER: KnowledgeKind[] = [
  "architecture",
  "workflow",
  "module",
  "ownership",
  "deployment",
  "hot_area",
  "failure_pattern",
  "documentation",
  "decision",
];

const SOURCE_TONE: Record<string, "info" | "warn" | "neutral"> = {
  observed: "neutral",
  inferred: "warn",
  recorded: "info",
};

export function KnowledgePanel({
  owner,
  repo,
  facts,
  evidenceLabels,
  repoUrlForPath,
}: {
  owner: string;
  repo: string;
  facts: KnowledgeFact[];
  /** `RepoEvidence.id` -> `{ label, url }`, for citations. */
  evidenceLabels: Map<string, { label: string; url: string | null }>;
  /** Builds a GitHub blob URL for a repository-relative path. */
  repoUrlForPath: (path: string) => string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: facts.filter((f) => f.kind === kind),
  })).filter((g) => g.items.length > 0);

  const record = () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    startTransition(async () => {
      const res = await recordDecisionAction({ owner, repo, title, detail });
      if (res.ok) {
        setTitle("");
        setDetail("");
        setNotice(t("intelligence:knowledge_recorded"));
        router.refresh();
      } else {
        setError(res.error);
      }
      setBusy(false);
    });
  };

  const forget = (id: string) => {
    setError(null);
    setNotice(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await forgetDecisionAction({ owner, repo, knowledgeId: id });
      if (res.ok) {
        setNotice(t("intelligence:knowledge_removed"));
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
        <div className="flex items-center gap-2">
          <IconBrain className="h-4 w-4 text-brand-300" />
          <h2 className="text-sm font-semibold text-white">{t("intelligence:knowledge_title")}</h2>
        </div>
        <p className="mt-0.5 text-xs text-ink-500">{t("intelligence:knowledge_subtitle")}</p>
      </div>

      {error ? (
        <p
          className="flex items-start gap-2 border-b border-white/[0.05] px-5 py-3 text-xs text-danger-300"
          role="alert"
        >
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="flex items-center gap-2 border-b border-white/[0.05] px-5 py-3 text-xs text-signal-400">
          <IconCheck className="h-3.5 w-3.5 shrink-0" />
          {notice}
        </p>
      ) : null}

      {facts.length === 0 ? (
        <p className="px-5 py-6 text-center text-[11px] leading-relaxed text-ink-400">
          {t("intelligence:knowledge_empty")}
        </p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {grouped.map((group) => (
            <div key={group.kind} className="px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                  {t(`intelligence:knowledge_kind_${group.kind}`)}
                </span>
                <span className="font-mono text-[10px] text-ink-600">({group.items.length})</span>
              </div>
              <ul className="space-y-2.5">
                {group.items.map((f) => {
                  const citations = f.evidenceIds
                    .map((id) => evidenceLabels.get(id))
                    .filter((x): x is { label: string; url: string | null } => Boolean(x))
                    .slice(0, 3);
                  const pathUrl = f.path ? repoUrlForPath(f.path) : null;
                  return (
                    <li
                      key={f.id}
                      className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white">{f.title}</p>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={SOURCE_TONE[f.source] ?? "neutral"}>
                            {t(`intelligence:knowledge_source_${f.source}`)}
                          </Badge>
                          <span
                            className="font-mono text-[10px] text-ink-500"
                            title={t("intelligence:knowledge_strength_hint")}
                          >
                            {t("intelligence:knowledge_strength", { value: f.strength })}
                          </span>
                          {f.observations > 1 ? (
                            <span
                              className="font-mono text-[10px] text-signal-400"
                              title={t("intelligence:knowledge_observations_hint")}
                            >
                              &times;{f.observations}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-300">{f.detail}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {pathUrl ? (
                          <a
                            href={pathUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-400 transition-colors hover:text-brand-300"
                          >
                            {f.path}
                            <IconExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : f.path ? (
                          <span className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
                            {f.path}
                          </span>
                        ) : null}
                        {citations.map((c, i) =>
                          c.url ? (
                            <a
                              key={`${f.id}-c${i}`}
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-400 transition-colors hover:text-brand-300"
                            >
                              <span className="truncate">{c.label}</span>
                              <IconExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          ) : (
                            <span
                              key={`${f.id}-c${i}`}
                              className="inline-flex max-w-[14rem] items-center rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-500"
                            >
                              <span className="truncate">{c.label}</span>
                            </span>
                          ),
                        )}
                        {f.source === "recorded" ? (
                          <button
                            type="button"
                            onClick={() => forget(f.id)}
                            disabled={pendingId === f.id}
                            className="ml-auto inline-flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-ink-400 transition-colors hover:text-danger-300 disabled:opacity-60"
                          >
                            <IconTrash className="h-2.5 w-2.5" />
                            {t("intelligence:knowledge_remove")}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Recording a decision. Present only here, because a decision without the
          repository it belongs to is trivia. */}
      <div className="border-t border-white/[0.07] bg-ink-950/50 px-5 py-4">
        <p className="text-xs font-semibold text-white">{t("intelligence:knowledge_decision_title")}</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          {t("intelligence:knowledge_decision_hint")}
        </p>
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            placeholder={t("intelligence:knowledge_decision_title_placeholder")}
            className="w-full rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2 text-xs text-white placeholder:text-ink-600 focus:border-brand-500/50 focus:outline-none"
          />
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={2_000}
            rows={3}
            placeholder={t("intelligence:knowledge_decision_detail_placeholder")}
            className="w-full resize-y rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-2 text-xs text-white placeholder:text-ink-600 focus:border-brand-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={record}
            disabled={busy || title.trim().length < 4 || detail.trim().length < 10}
            className="btn btn-ghost btn-sm justify-center text-xs text-brand-300 hover:text-white disabled:opacity-60"
          >
            {busy ? t("intelligence:knowledge_recording") : t("intelligence:knowledge_record")}
          </button>
        </div>
      </div>
    </section>
  );
}