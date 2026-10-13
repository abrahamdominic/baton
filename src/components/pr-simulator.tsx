"use client";

import { useState } from "react";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";
import { useI18n } from "@/lib/i18n/provider";
import type { BatonState } from "@/lib/engine/types";
import { StatusCard, type StatusCardModel } from "@/components/marketing/status-card";
import type { BatonTone } from "@/components/marketing/state-badge";

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
  tone: BatonTone;
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
    tone: "info",
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
    tone: "warn",
    whoseTurn: "@dev-alex (author)",
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
    tone: "info",
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
    tone: "danger",
    whoseTurn: "@dev-alex (author)",
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
    tone: "success",
    whoseTurn: "@dev-alex or maintainer",
    blockedFor: "18h 30m",
    labelApplied: "baton:ready-to-merge",
    nudgeSent: false,
    n: 5,
  },
];

/** Demo data: a stable example pull request the scenarios all refer to. */
const DEMO_PR = {
  repo: "baton/core",
  number: "247",
  title: "feat(billing): idempotent webhook processor",
  branchLine: "feature/idempotent-webhooks into main",
};

export function PrSimulator() {
  const { t, tc } = useI18n();
  const [activeId, setActiveId] = useState("stalled-review");
  const current = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0]!;
  const n = current.n;

  const model: StatusCardModel = {
    repo: DEMO_PR.repo,
    prNumber: DEMO_PR.number,
    title: DEMO_PR.title,
    branchLine: DEMO_PR.branchLine,
    openedLine: t("marketing:sim_opened_line"),
    stateLabel: t(`marketing:matrix_${current.state}_label`),
    tone: current.tone,
    ownerLabel: t(current.turnKey),
    owner: current.whoseTurn,
    blockedFor: current.blockedFor,
    threshold: tc("marketing:sim_threshold_value", REPO_SETTING_DEFAULTS[current.thresholdField]),
    checks: t(`marketing:sim_${n}_checks`),
    nextAction: t(`marketing:sim_${n}_next`),
    labelName: current.labelApplied,
    nudge: current.nudgeSent ? t(`marketing:sim_${n}_nudge`) : undefined,
    nextHeading: t("marketing:sim_unblocking_label"),
    nudgeHeading: t("marketing:sim_nudge_dispatched"),
    turnPrefix: t("marketing:turn_prefix"),
    botBadge: t("marketing:sim_bot_badge"),
    pinnedLabel: t("marketing:sim_pinned_status"),
    whoseTurnHeading: t("marketing:sim_whose_turn_heading"),
    checksHeading: t("marketing:sim_ci_checks_heading"),
    thresholdHeading: t("marketing:sim_threshold_heading"),
    footerLeft: t("marketing:sim_footer_left"),
    footerRight: t("marketing:sim_footer_right"),
  };

  return (
    <div className="rounded-panel border border-hairline-strong bg-ink-900/90">
      <div
        role="tablist"
        aria-label={t("marketing:sim_scenarios_label")}
        className="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-ink-950/60 p-2.5"
      >
        <span className="px-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          {t("marketing:sim_scenarios_label")}
        </span>
        {SCENARIOS.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`sim-tab-${s.id}`}
              aria-selected={isActive}
              aria-controls="sim-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(s.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const index = SCENARIOS.findIndex((x) => x.id === s.id);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % SCENARIOS.length
                    : (index - 1 + SCENARIOS.length) % SCENARIOS.length;
                setActiveId(SCENARIOS[next]!.id);
                document.getElementById(`sim-tab-${SCENARIOS[next]!.id}`)?.focus();
              }}
              className={`rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                isActive
                  ? "border border-brand-400/40 bg-brand-500/20 text-on-brand"
                  : "border border-transparent text-ink-400 hover:bg-ink-850 hover:text-ink-200"
              }`}
            >
              {t(`marketing:sim_${s.n}_tab`)}
            </button>
          );
        })}
      </div>

      <div
        id="sim-panel"
        role="tabpanel"
        aria-labelledby={`sim-tab-${current.id}`}
        aria-live="polite"
        className="p-4 sm:p-5"
      >
        <StatusCard model={model} />

        <div className="mt-3 rounded-panel border border-hairline bg-ink-950/60 p-4">
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            {t("marketing:sim_under_hood")} {t("marketing:sim_rule_heading")}
          </h3>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                {t("marketing:sim_rule_conditions_label")}
              </dt>
              <dd className="mt-1.5">
                <ul className="space-y-1.5 text-xs text-ink-200">
                  {[1, 2, 3].map((c) => (
                    <li key={c} className="flex items-start gap-2">
                      <span className="mt-0.5 font-mono text-[10px] text-brand-400">{`0${c}`}</span>
                      <span>{t(`marketing:sim_${n}_cond_${c}`)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="space-y-3">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                  {t("marketing:sim_rule_outcome_label")}
                </dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-mono text-[11px] text-brand-300">
                    {current.state}
                  </code>
                  <span className="text-xs text-ink-200">
                    {t(`marketing:matrix_${current.state}_label`)}
                  </span>
                </dd>
                <dd className="mt-1.5 text-xs leading-reading text-ink-300">
                  {t(`marketing:sim_${n}_rule`)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
                  {t("marketing:sim_rule_nudge_label")}
                </dt>
                <dd className="mt-1 text-xs leading-reading text-ink-300">
                  {t(`marketing:matrix_${current.state}_nudge`)}
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
