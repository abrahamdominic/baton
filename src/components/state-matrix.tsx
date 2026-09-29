"use client";

import { useState } from "react";
import { IconCheckCircle, IconBell } from "@/components/icons";
import { STATE_META, type BatonState } from "@/lib/engine/types";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";
import { useI18n } from "@/lib/i18n/provider";

/**
 * A row in the state matrix.
 *
 * The engine state key, the GitHub label and the default threshold are read from
 * the engine's own tables, so this marketing surface cannot advertise a label or
 * a threshold the product does not use. Only the prose is a resource string.
 */
interface StateDefinition {
  /** Engine state key; the GitHub label is read from STATE_META, not restated. */
  key: BatonState;
  /** Whose turn it is, as a `marketing:states_owner_*` key. */
  turnKey: string;
  tone: "info" | "warn" | "danger" | "success" | "neutral";
}

const ALL_STATES: StateDefinition[] = [
  { key: "awaiting_review", turnKey: "marketing:states_owner_reviewers", tone: "info" },
  { key: "awaiting_review_after_fix", turnKey: "marketing:states_owner_reviewers", tone: "info" },
  { key: "changes_required", turnKey: "marketing:states_owner_author", tone: "warn" },
  { key: "ci_failing", turnKey: "marketing:states_owner_author", tone: "danger" },
  { key: "conflicts", turnKey: "marketing:states_owner_author", tone: "danger" },
  { key: "ready_to_merge", turnKey: "marketing:states_owner_author", tone: "success" },
  { key: "blocked_on_checks", turnKey: "marketing:states_owner_none", tone: "neutral" },
  { key: "draft", turnKey: "marketing:states_owner_none", tone: "neutral" },
];

/** Which engine threshold drives each state's default. */
const STATE_THRESHOLD: Partial<Record<BatonState, keyof typeof REPO_SETTING_DEFAULTS>> = {
  awaiting_review: "firstResponseHours",
  awaiting_review_after_fix: "reviewFollowUpHours",
  changes_required: "changesRequiredHours",
  ci_failing: "ciFailHours",
  conflicts: "conflictHours",
  ready_to_merge: "readyToMergeHours",
};

/**
 * The label Baton actually writes to GitHub for a state. States with no label
 * (draft, checks-pending, merged, closed) are silent by design, so the marketing
 * matrix must not advertise a `baton:*` label that is never created.
 */
function githubLabel(key: BatonState): string {
  return STATE_META[key].labelName;
}

const TONE_DOT: Record<StateDefinition["tone"], string> = {
  warn: "bg-warn-400",
  danger: "bg-danger-400",
  success: "bg-signal-400",
  info: "bg-brand-400",
  neutral: "bg-ink-500",
};

export function StateMatrix() {
  const { t, tc } = useI18n();
  const [selectedKey, setSelectedKey] = useState<BatonState>("awaiting_review");
  const selected = ALL_STATES.find((s) => s.key === selectedKey) ?? ALL_STATES[0]!;

  /** The real built-in threshold, or an explicit "no nudge" for silent states. */
  const defaultThreshold = (key: BatonState): string => {
    const field = STATE_THRESHOLD[key];
    if (!field) return t("marketing:threshold_none");
    return tc("marketing:threshold", REPO_SETTING_DEFAULTS[field]);
  };

  const selectedLabel = t(`marketing:matrix_${selected.key}_label`);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
        <div className="border-b border-white/[0.08] bg-ink-950/70 px-5 py-3 text-xs font-mono text-ink-400">
          {t("marketing:select_prompt")}
        </div>
        <div className="divide-y divide-white/[0.05]">
          {ALL_STATES.map((s) => {
            const isSelected = selected.key === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedKey(s.key)}
                className={`w-full p-4 text-start transition-all flex items-center justify-between gap-4 ${
                  isSelected
                    ? "bg-brand-500/10 border-s-2 border-brand-400"
                    : "hover:bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[s.tone]}`} />
                    <span className="text-sm font-medium text-white">
                      {t(`marketing:matrix_${s.key}_label`)}
                    </span>
                  </div>
                  <code className="mt-1 block font-mono text-xs text-ink-400">
                    {githubLabel(s.key) || t("marketing:silent_state")}
                  </code>
                </div>

                <div className="shrink-0 text-end">
                  <span className="rounded-full border border-white/[0.08] bg-ink-850 px-2.5 py-0.5 font-mono text-xs text-ink-300">
                    {t("marketing:turn_prefix")} {t(s.turnKey)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.1] bg-ink-900 p-6">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-4">
          <div className="min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-wider text-brand-300">
              {t("marketing:spec_eyebrow")}
            </span>
            <h3 className="mt-1 text-xl font-bold text-white">{selectedLabel}</h3>
          </div>
          <code className="shrink-0 rounded border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-xs text-brand-300">
            {defaultThreshold(selected.key)}
          </code>
        </div>

        <div className="mt-5 space-y-4 text-xs">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
              {t("marketing:trigger_heading")}
            </span>
            <p className="mt-1 font-sans text-sm leading-relaxed text-ink-200">
              {t(`marketing:matrix_${selected.key}_trigger`)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-lg border border-white/[0.06] bg-ink-950/60 p-3">
              <span className="block font-mono text-[10px] uppercase text-ink-500">
                {t("marketing:whose_turn_heading")}
              </span>
              <span className="mt-1 block text-sm font-bold text-white">{t(selected.turnKey)}</span>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-ink-950/60 p-3">
              <span className="block font-mono text-[10px] uppercase text-ink-500">
                {t("marketing:threshold_heading")}
              </span>
              <span className="mt-1 block font-mono text-sm font-bold text-brand-300">
                {defaultThreshold(selected.key)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-brand-500/25 bg-brand-500/5 p-3.5">
            <div className="mb-1 flex items-center gap-2 font-semibold text-brand-300">
              <IconBell className="h-3.5 w-3.5" />
              <span>{t("marketing:nudge_heading")}</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-200">
              {t(`marketing:matrix_${selected.key}_nudge`)}
            </p>
          </div>

          <div className="rounded-lg border border-signal-500/25 bg-signal-500/5 p-3.5">
            <div className="mb-1 flex items-center gap-2 font-semibold text-signal-400">
              <IconCheckCircle className="h-3.5 w-3.5" />
              <span>{t("marketing:action_heading")}</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-200">
              {t(`marketing:matrix_${selected.key}_action`)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
