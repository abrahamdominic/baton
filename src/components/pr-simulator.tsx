"use client";

import { useState } from "react";
import { IconCheckCircle, IconClock, IconGitPullRequest, IconBell } from "@/components/icons";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";
import { useI18n } from "@/lib/i18n/provider";
import type { BatonState } from "@/lib/engine/types";

/** Which built-in threshold the scenario demonstrates. */
type ThresholdField = keyof typeof REPO_SETTING_DEFAULTS;

interface Scenario {
  id: string;
  /** Derived from REPO_SETTING_DEFAULTS so the demo cannot contradict the engine. */
  thresholdField: ThresholdField;
  /** The engine state this scenario is in; drives the badge and its copy. */
  state: BatonState;
  /** Whose turn it is, as a `marketing:states_owner_*` key. */
  turnKey: string;
  badgeTone: "info" | "warn" | "danger" | "success";
  /** Mock data: a GitHub handle, a duration, a check summary. */
  whoseTurn: string;
  blockedFor: string;
  labelApplied: string;
  nudgeSent: boolean;
  /** 1-5, used to build this scenario's `marketing:sim_*` keys. */
  n: 1 | 2 | 3 | 4 | 5;
}

const SCENARIOS: Scenario[] = [
  {
    id: "stalled-review",
    thresholdField: "firstResponseHours",
    state: "awaiting_review",
    turnKey: "marketing:states_owner_reviewers",
    badgeTone: "info",
    whoseTurn: "@sarah-chen",
    blockedFor: "48h 12m",
    labelApplied: "baton:awaiting-review",
    nudgeSent: true,
    n: 1,
  },
  {
    id: "changes-requested",
    thresholdField: "changesRequiredHours",
    state: "changes_required",
    turnKey: "marketing:states_owner_author",
    badgeTone: "warn",
    whoseTurn: "@dev-alex (Author)",
    blockedFor: "6h 40m",
    labelApplied: "baton:changes-required",
    nudgeSent: false,
    n: 2,
  },
  {
    id: "re-review",
    thresholdField: "reviewFollowUpHours",
    state: "awaiting_review_after_fix",
    turnKey: "marketing:states_owner_reviewers",
    badgeTone: "info",
    whoseTurn: "@sarah-chen",
    blockedFor: "3h 15m",
    labelApplied: "baton:re-review",
    nudgeSent: false,
    n: 3,
  },
  {
    id: "ci-failing",
    thresholdField: "ciFailHours",
    state: "ci_failing",
    turnKey: "marketing:states_owner_author",
    badgeTone: "danger",
    whoseTurn: "@dev-alex (Author)",
    blockedFor: "1h 05m",
    labelApplied: "baton:ci-failing",
    nudgeSent: false,
    n: 4,
  },
  {
    id: "ready-to-merge",
    thresholdField: "readyToMergeHours",
    state: "ready_to_merge",
    turnKey: "marketing:states_owner_maintainer",
    badgeTone: "success",
    whoseTurn: "@dev-alex or Maintainer",
    blockedFor: "18h 30m",
    labelApplied: "baton:ready-to-merge",
    nudgeSent: false,
    n: 5,
  },
];

const BADGE_TONE_CLASS: Record<Scenario["badgeTone"], string> = {
  warn: "border-warn-400/40 bg-warn-500/15 text-warn-300",
  danger: "border-danger-400/40 bg-danger-500/15 text-danger-300",
  success: "border-signal-400/40 bg-signal-500/15 text-signal-300",
  info: "border-brand-400/40 bg-brand-500/15 text-brand-300",
};

const BADGE_DOT_CLASS: Record<Scenario["badgeTone"], string> = {
  warn: "bg-warn-400",
  danger: "bg-danger-400",
  success: "bg-signal-400",
  info: "bg-brand-400",
};

export function PrSimulator() {
  const { t, tc } = useI18n();
  const [activeId, setActiveId] = useState("stalled-review");
  const current = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0]!;
  const n = current.n;

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-ink-900/90">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] bg-ink-950/60 p-2.5">
        <span className="px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          {t("marketing:sim_scenarios_label")}
        </span>
        {SCENARIOS.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveId(s.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "border border-brand-400/40 bg-brand-500/20 text-on-brand shadow-sm"
                  : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200"
              }`}
            >
              {t(`marketing:sim_${s.n}_tab`)}
            </button>
          );
        })}
      </div>

      <div className="border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal-500/20 text-signal-400">
              <IconGitPullRequest className="h-3 w-3" />
            </span>
            <span className="font-semibold text-white">feat(billing): idempotent webhook processor</span>
            <span className="font-mono text-xs text-ink-400">#247</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-ink-300">
              main &larr; feature/idempotent-webhooks
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-signal-500" />
            {t("marketing:sim_pr_state_open")}
          </span>
          <span>&middot;</span>
          <span>{t("marketing:sim_opened_line")}</span>
          <span>&middot;</span>
          <span className="font-mono text-[11px] text-signal-400">+142</span>
          <span className="font-mono text-[11px] text-danger-400">-18</span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="rounded-xl border border-brand-500/30 bg-ink-850">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-brand-500/5 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-brand-400/40 bg-brand-600 text-[10px] font-bold text-on-brand">
                B
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">baton</span>
                <span className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.2 text-[9px] font-semibold text-ink-300">
                  {t("marketing:sim_bot_badge")}
                </span>
                <span className="text-[11px] text-ink-400">{t("marketing:sim_pinned_status")}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <code className="rounded border border-white/[0.08] bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-brand-300">
                {current.labelApplied}
              </code>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-medium ${BADGE_TONE_CLASS[current.badgeTone]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT_CLASS[current.badgeTone]}`} />
                  {t(`marketing:matrix_${current.state}_label`)}
                </span>

                <span className="rounded-full border border-white/[0.08] bg-ink-800 px-2.5 py-0.5 font-mono text-[11px] text-ink-300">
                  {t("marketing:turn_prefix")} {t(current.turnKey)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconClock className="h-3.5 w-3.5 text-ink-400" />
                <span>
                  {t("marketing:sim_blocked_prefix")}{" "}
                  <strong className="font-mono text-white">{current.blockedFor}</strong>
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-lg border border-white/[0.06] bg-ink-950/40 p-3 text-xs sm:grid-cols-3">
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">
                  {t("marketing:sim_whose_turn_heading")}
                </span>
                <span className="mt-0.5 font-semibold text-white">{current.whoseTurn}</span>
              </div>
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">
                  {t("marketing:sim_ci_checks_heading")}
                </span>
                <span className="mt-0.5 font-medium text-ink-200">{t(`marketing:sim_${n}_checks`)}</span>
              </div>
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">
                  {t("marketing:sim_threshold_heading")}
                </span>
                <span className="mt-0.5 font-mono text-ink-300">
                  {tc("marketing:sim_threshold_value", REPO_SETTING_DEFAULTS[current.thresholdField])}
                </span>
              </div>
            </div>

            <div className="mt-3.5 flex items-start gap-2.5 rounded-lg border border-signal-500/20 bg-signal-500/5 p-3 text-xs">
              <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
              <div>
                <span className="font-semibold text-signal-300">
                  {t("marketing:sim_unblocking_label")}
                </span>
                <p className="mt-0.5 text-ink-200">{t(`marketing:sim_${n}_next`)}</p>
              </div>
            </div>

            {current.nudgeSent ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs">
                <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                <div>
                  <span className="font-semibold text-brand-200">
                    {t("marketing:sim_nudge_dispatched")}
                  </span>
                  <p className="mt-1 rounded border border-brand-500/20 bg-brand-950/40 p-2 font-mono text-[11px] text-brand-100">
                    &ldquo;{t(`marketing:sim_${n}_nudge`)}&rdquo;
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-ink-950/30 px-4 py-2 text-[11px] text-ink-500">
            <span>{t("marketing:sim_footer_left")}</span>
            <span>{t("marketing:sim_footer_right")}</span>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/[0.06] bg-ink-950/50 p-3 text-xs">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            <span className="font-semibold text-white">{t("marketing:sim_under_hood")}</span>
            <span className="text-ink-400">{t(`marketing:sim_${n}_trigger`)}</span>
          </div>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-400">
            {t(`marketing:sim_${n}_rule`)}
          </p>
        </div>
      </div>
    </div>
  );
}
