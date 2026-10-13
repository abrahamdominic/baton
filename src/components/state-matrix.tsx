"use client";

import { useState } from "react";
import { IconBell, IconCheckCircle } from "@/components/marketing/icons";
import { STATE_META, type BatonState } from "@/lib/engine/types";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";
import { useI18n } from "@/lib/i18n/provider";
import { StateBadge, type BatonTone } from "@/components/marketing/state-badge";
import { cx } from "@/components/marketing/section";

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
  tone: BatonTone;
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
 * (draft, checks-pending) are silent by design, so the marketing matrix must not
 * advertise a `baton:*` label that is never created.
 */
function githubLabel(key: BatonState): string {
  return STATE_META[key].labelName;
}

export function StateMatrix() {
  const { t, tc } = useI18n();
  const [selectedKey, setSelectedKey] = useState<BatonState>("awaiting_review");
  const selected = ALL_STATES.find((s) => s.key === selectedKey) ?? ALL_STATES[0]!;
  const label = githubLabel(selected.key);

  /** The real built-in threshold, or an explicit "no nudge" for silent states. */
  const defaultThreshold = (key: BatonState): string => {
    const field = STATE_THRESHOLD[key];
    if (!field) return t("marketing:threshold_none");
    return tc("marketing:threshold", REPO_SETTING_DEFAULTS[field]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60">
        <p className="border-b border-hairline bg-ink-950/70 px-5 py-3 font-mono text-xs text-ink-400">
          {t("marketing:select_prompt")}
        </p>
        <div className="divide-y divide-hairline">
          {ALL_STATES.map((s) => {
            const isSelected = selected.key === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedKey(s.key)}
                className={cx(
                  "flex w-full items-center justify-between gap-4 border-s-2 p-4 text-start transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400",
                  isSelected
                    ? "border-brand-400 bg-brand-500/10"
                    : "border-transparent hover:bg-ink-850/60",
                )}
              >
                <span className="min-w-0">
                  <StateBadge tone={s.tone} label={t(`marketing:matrix_${s.key}_label`)} />
                  <code className="mt-1.5 block font-mono text-xs text-ink-400">
                    {githubLabel(s.key) || t("marketing:silent_state")}
                  </code>
                </span>
                <span className="shrink-0 rounded-full border border-hairline bg-ink-850 px-2.5 py-0.5 font-mono text-[11px] text-ink-300">
                  {t("marketing:turn_prefix")} {t(s.turnKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-panel border border-hairline-strong bg-ink-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline pb-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-wide text-brand-300">
              {t("marketing:spec_eyebrow")}
            </p>
            <h3 className="mt-1 text-xl text-ink-50">{t(`marketing:matrix_${selected.key}_label`)}</h3>
          </div>
          <code className="shrink-0 rounded border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-xs text-brand-300">
            {label || t("marketing:threshold_none")}
          </code>
        </div>

        <div className="mt-5 space-y-4 text-xs">
          <div>
            <h4 className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
              {t("marketing:trigger_heading")}
            </h4>
            <p className="mt-1 max-w-measure text-sm leading-reading text-ink-200">
              {t(`marketing:matrix_${selected.key}_trigger`)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-control border border-hairline bg-ink-950/60 p-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                {t("marketing:whose_turn_heading")}
              </h4>
              <p className="mt-1 text-sm font-semibold text-ink-50">{t(selected.turnKey)}</p>
            </div>
            <div className="rounded-control border border-hairline bg-ink-950/60 p-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                {t("marketing:threshold_heading")}
              </h4>
              <p className="tabular mt-1 font-mono text-sm font-semibold text-brand-300">
                {defaultThreshold(selected.key)}
              </p>
            </div>
          </div>

          <div className="rounded-control border border-brand-500/25 bg-brand-500/5 p-3.5">
            <div className="mb-1 flex items-center gap-2 font-semibold text-brand-300">
              <IconBell className="h-3.5 w-3.5" aria-hidden="true" />
              <h4 className="text-xs">{t("marketing:nudge_heading")}</h4>
            </div>
            <p className="text-xs leading-reading text-ink-200">
              {t(`marketing:matrix_${selected.key}_nudge`)}
            </p>
          </div>

          <div className="rounded-control border border-signal-500/25 bg-signal-500/5 p-3.5">
            <div className="mb-1 flex items-center gap-2 font-semibold text-signal-400">
              <IconCheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <h4 className="text-xs">{t("marketing:action_heading")}</h4>
            </div>
            <p className="text-xs leading-reading text-ink-200">
              {t(`marketing:matrix_${selected.key}_action`)}
            </p>
          </div>

          {!label ? (
            <p className="rounded-control border border-hairline bg-ink-950/60 p-3 text-[11px] leading-reading text-ink-400">
              {t("marketing:states_silent_note")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
