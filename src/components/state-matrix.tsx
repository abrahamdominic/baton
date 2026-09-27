"use client";

import { useState } from "react";
import { IconCheckCircle, IconBell } from "@/components/icons";
import { STATE_META, type BatonState } from "@/lib/engine/types";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";

interface StateDefinition {
  /** Engine state key; the GitHub label is read from STATE_META, not restated. */
  key: BatonState;
  state: string;
  turn: "Reviewers" | "Author" | "Maintainer" | "None";
  tone: "info" | "warn" | "danger" | "success" | "neutral";
  trigger: string;
  nudgeRule: string;
  actionText: string;
}

/**
 * Display copy for each engine state. The state key, the GitHub label, and the
 * default threshold are all read from the engine's own tables so this marketing
 * matrix cannot advertise a label or a threshold the product does not use.
 */
const ALL_STATES: StateDefinition[] = [
  {
    key: "awaiting_review",
    state: "Waiting for review",
    turn: "Reviewers",
    tone: "info",
    trigger: "PR opened, non-draft, reviewers requested or required by CODEOWNERS, 0 review decisions submitted yet.",
    nudgeRule: "Dispatches at most 1 targeted @-mention to requested reviewers. Timer resets if author pushes commits.",
    actionText: "Review the PR changes and submit Approve or Request Changes.",
  },
  {
    key: "awaiting_review_after_fix",
    state: "Fix pushed, re-review due",
    turn: "Reviewers",
    tone: "info",
    trigger: "A reviewer previously requested changes or commented, and author subsequently pushed new commits.",
    nudgeRule: "Mentions only the reviewers whose feedback was addressed. Spares reviewers who already approved.",
    actionText: "Verify the new commits resolve the prior objections.",
  },
  {
    key: "changes_required",
    state: "Changes required",
    turn: "Author",
    tone: "warn",
    trigger: "At least one reviewer submitted 'Request Changes'.",
    nudgeRule: "Reviewers are silenced. Author is nudged only after the grace period expires without new commits.",
    actionText: "Push changes or reply in thread to resolve reviewer concerns.",
  },
  {
    key: "ci_failing",
    state: "CI failing",
    turn: "Author",
    tone: "danger",
    trigger: "One or more required check suites or status contexts concluded as failure or timed out.",
    nudgeRule: "Strict safety rule: Reviewers are never nudged while CI is broken. Author is gently notified.",
    actionText: "Inspect CI logs, resolve tests/lint, and push fixes.",
  },
  {
    key: "conflicts",
    state: "Merge conflicts",
    turn: "Author",
    tone: "danger",
    trigger: "GitHub reports mergeable = CONFLICTING against the base branch.",
    nudgeRule: "Alerts author that the branch has drifted out of sync with main.",
    actionText: "Rebase onto base branch or merge target and resolve conflicts.",
  },
  {
    key: "ready_to_merge",
    state: "Ready to merge",
    turn: "Author",
    tone: "success",
    trigger: "Approved by required reviewers, all CI checks passed, zero merge conflicts.",
    nudgeRule: "Nudges author or maintainers if PR sits unmerged despite all lights being green.",
    actionText: "Perform merge (squash, rebase, or merge commit).",
  },
  {
    key: "blocked_on_checks",
    state: "Checks pending",
    turn: "None",
    tone: "neutral",
    trigger: "CI check suites are in-progress; mergeability cannot be evaluated yet.",
    nudgeRule: "Silent state. No one is nudged while automated jobs are still compiling or testing.",
    actionText: "Wait for CI pipelines to complete.",
  },
  {
    key: "draft",
    state: "Draft",
    turn: "None",
    tone: "neutral",
    trigger: "PR is explicitly marked as draft by the author.",
    nudgeRule: "Completely passive. Reviewers are never pinged on work-in-progress drafts.",
    actionText: "Mark as ready for review when prepared.",
  },
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

function hours(n: number): string {
  return n === 1 ? "1 hour" : `${n} hours`;
}

/** The real built-in threshold, or an explicit "no nudge" for silent states. */
function defaultThreshold(key: BatonState): string {
  const field = STATE_THRESHOLD[key];
  return field ? hours(REPO_SETTING_DEFAULTS[field]) : "No nudge";
}
/**
 * The label Baton actually writes to GitHub for a state. States with no label
 * (draft, checks-pending, merged, closed) are silent by design, so the marketing
 * matrix must not advertise a `baton:*` label that is never created.
 */
function githubLabel(key: BatonState): string {
  return STATE_META[key].labelName;
}

export function StateMatrix() {
  const [selectedState, setSelectedState] = useState<StateDefinition>(ALL_STATES[0]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* State List */}
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
        <div className="border-b border-white/[0.08] bg-ink-950/70 px-5 py-3 text-xs font-mono text-ink-400">
          Select a state to view deterministic logic &amp; nudge rules:
        </div>
        <div className="divide-y divide-white/[0.05]">
          {ALL_STATES.map((s) => {
            const isSelected = selectedState.key === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSelectedState(s)}
                className={`w-full text-left p-4 transition-all flex items-center justify-between gap-4 ${
                  isSelected
                    ? "bg-brand-500/10 border-l-2 border-brand-400"
                    : "hover:bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        s.tone === "warn"
                          ? "bg-warn-400"
                          : s.tone === "danger"
                          ? "bg-danger-400"
                          : s.tone === "success"
                          ? "bg-signal-400"
                          : s.tone === "info"
                          ? "bg-brand-400"
                          : "bg-ink-500"
                      }`}
                    />
                    <span className="font-medium text-sm text-white">{s.state}</span>
                  </div>
                  {githubLabel(s.key) ? (
                    <code className="mt-1 block font-mono text-xs text-ink-400">
                      {githubLabel(s.key)}
                    </code>
                  ) : (
                    <code className="mt-1 block font-mono text-xs text-ink-500">
                      No GitHub label (silent state)
                    </code>
                  )}
                </div>

                <div className="text-right">
                  <span className="rounded-full border border-white/[0.08] bg-ink-850 px-2.5 py-0.5 font-mono text-xs text-ink-300">
                    Turn: {s.turn}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected State Details Card */}
      <div className="rounded-xl border border-white/[0.1] bg-ink-900 p-6">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-4">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-brand-300">
              State Engine Spec
            </span>
            <h3 className="text-xl font-bold text-white mt-1">{selectedState.state}</h3>
          </div>
          <code className="rounded border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-xs text-brand-300">
            defaultThreshold(selectedState.key)
          </code>
        </div>

        <div className="mt-5 space-y-4 text-xs">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
              Exact Trigger Conditions
            </span>
            <p className="mt-1 text-sm text-ink-200 leading-relaxed font-sans">
              {selectedState.trigger}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-lg border border-white/[0.06] bg-ink-950/60 p-3">
              <span className="font-mono text-[10px] uppercase text-ink-500 block">Whose Turn</span>
              <span className="mt-1 font-bold text-sm text-white block">{selectedState.turn}</span>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-ink-950/60 p-3">
              <span className="font-mono text-[10px] uppercase text-ink-500 block">Default Threshold</span>
              <span className="mt-1 font-mono font-bold text-sm text-brand-300 block">
                {defaultThreshold(selectedState.key)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-brand-500/25 bg-brand-500/5 p-3.5">
            <div className="flex items-center gap-2 text-brand-300 font-semibold mb-1">
              <IconBell className="h-3.5 w-3.5" />
              <span>Nudge &amp; Politeness Policy</span>
            </div>
            <p className="text-ink-200 text-xs leading-relaxed">
              {selectedState.nudgeRule}
            </p>
          </div>

          <div className="rounded-lg border border-signal-500/25 bg-signal-500/5 p-3.5">
            <div className="flex items-center gap-2 text-signal-400 font-semibold mb-1">
              <IconCheckCircle className="h-3.5 w-3.5" />
              <span>Target Unblocking Action</span>
            </div>
            <p className="text-ink-200 text-xs leading-relaxed">
              {selectedState.actionText}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
