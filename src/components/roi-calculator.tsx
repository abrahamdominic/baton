"use client";

import { useState } from "react";
import { IconZap, IconCheckCircle } from "@/components/marketing/icons";
import { useI18n } from "@/lib/i18n/provider";

/**
 * How much waiting Baton is modelled to leave behind on a healthy repository,
 * in hours, and the most any single pull request is allowed to contribute.
 * The cap is what keeps the headline conservative: a 3 day wait cannot be
 * claimed as a full 3 day saving.
 */
const BATON_TARGET_WAIT_HOURS = 8;
const HOURS_SAVED_CAP_PER_PR = 48;

/** "Someone went looking for the PR" pings avoided per open pull request. */
const CHASE_PINGS_PER_PR = 2.4;

const WEEKS_PER_MONTH = 4.33;

/** The low end of the directional range, as a fraction of the point estimate. */
const RANGE_FLOOR = 0.6;

export function RoiCalculator() {
  const { t, tc, formatNumber } = useI18n();
  const [teamSize, setTeamSize] = useState(15);
  const [prsPerWeek, setPrsPerWeek] = useState(25);
  const [avgWaitDays, setAvgWaitDays] = useState(3);

  // Transparent, conservative model:
  //   pull requests per month = weekly pull requests x 4.33
  //   hours saved per pull request = min(current wait minus Baton target, cap)
  //   waiting hours removed per month = pull requests per month x hours saved
  const totalPrsMonth = Math.round(prsPerWeek * WEEKS_PER_MONTH);
  const savedPerPr = Math.max(
    0,
    Math.min(Math.round(avgWaitDays * 24) - BATON_TARGET_WAIT_HOURS, HOURS_SAVED_CAP_PER_PR),
  );
  const savedStallHours = Math.round(totalPrsMonth * savedPerPr);
  const rangeLow = Math.round(savedStallHours * RANGE_FLOOR);
  const chaseMessagesAvoided = Math.round(totalPrsMonth * CHASE_PINGS_PER_PR);

  return (
    <div className="rounded-panel border border-hairline-strong bg-ink-900 p-6 sm:p-8">
      <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <h3 className="text-sm font-medium text-ink-300">
            {t("marketing:roi_inputs_heading")}
          </h3>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="team-size" className="text-sm font-medium text-ink-50">
                {t("marketing:roi_team_size")}
              </label>
              <span className="tabular text-sm font-semibold text-brand-300">
                {tc("marketing:roi_team_value", teamSize)}
              </span>
            </div>
            <input
              id="team-size"
              type="range"
              min="3"
              max="150"
              value={teamSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTeamSize(val);
                setPrsPerWeek(Math.round(val * 1.8));
              }}
              className="mt-2 w-full cursor-pointer accent-brand-500"
            />
            {/* Range endpoints are numbers, not copy, so they need no translation. */}
            <div className="mt-1 flex justify-between tabular text-[11px] text-ink-500">
              <span>3</span>
              <span>75</span>
              <span>150+</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="weekly-prs" className="text-sm font-medium text-ink-50">
                {t("marketing:roi_weekly_prs")}
              </label>
              <span className="tabular text-sm font-semibold text-brand-300">
                {tc("marketing:roi_weekly_value", prsPerWeek)}
              </span>
            </div>
            <input
              id="weekly-prs"
              type="range"
              min="5"
              max="250"
              value={prsPerWeek}
              onChange={(e) => setPrsPerWeek(Number(e.target.value))}
              className="mt-2 w-full cursor-pointer accent-brand-500"
            />
            <div className="mt-1 flex justify-between tabular text-[11px] text-ink-500">
              <span>5</span>
              <span>125</span>
              <span>250+</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="avg-wait" className="text-sm font-medium text-ink-50">
                {t("marketing:roi_avg_wait")}
              </label>
              <span className="tabular text-sm font-semibold text-warn-300">
                {tc("marketing:roi_days_value", avgWaitDays, {
                  count: avgWaitDays,
                  hours: formatNumber(avgWaitDays * 24),
                })}
              </span>
            </div>
            <input
              id="avg-wait"
              type="range"
              min="1"
              max="7"
              step="0.5"
              value={avgWaitDays}
              onChange={(e) => setAvgWaitDays(Number(e.target.value))}
              className="mt-2 w-full cursor-pointer accent-brand-500"
            />
            <div className="mt-1 flex justify-between tabular text-[11px] text-ink-500">
              <span>1</span>
              <span>3.5</span>
              <span>7</span>
            </div>
          </div>

          <div className="rounded-control border border-hairline bg-ink-950/60 p-4">
            <h4 className="text-xs font-medium text-ink-400">
              {t("marketing:roi_formula_heading")}
            </h4>
            <p className="mt-1.5 text-xs leading-reading text-ink-300">
              {t("marketing:roi_formula_text")}
            </p>
            <p className="tabular mt-2 text-xs text-brand-300">
              {formatNumber(totalPrsMonth)} x {formatNumber(savedPerPr)} ={" "}
              {formatNumber(savedStallHours)} hours
            </p>
            <p className="mt-1.5 text-[11px] leading-reading text-ink-500">
              {t("marketing:roi_formula_note")}
            </p>
          </div>
        </div>

        <div className="rounded-panel border border-brand-500/30 bg-ink-950/70 p-6 sm:p-7">
          <h3 className="text-sm font-medium text-brand-300">
            {t("marketing:roi_impact_eyebrow")}
          </h3>

          <div className="mt-4 border-b border-hairline pb-5">
            <p className="tabular text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
              {formatNumber(savedStallHours)}{" "}
              <span className="text-xl font-normal text-brand-300">
                {tc("marketing:roi_saved_hours_unit", savedStallHours)}
              </span>
            </p>
            <p className="mt-1.5 text-xs text-ink-400">
              {tc("marketing:roi_saved_hours_caption", totalPrsMonth, {
                count: formatNumber(totalPrsMonth),
              })}
            </p>
            <p className="tabular mt-2 tabular text-[11px] text-ink-500">
              {t("marketing:roi_range_label")}: {formatNumber(rangeLow)} to{" "}
              {formatNumber(savedStallHours)} {tc("marketing:roi_saved_hours_unit", savedStallHours)}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconZap className="h-3.5 w-3.5 text-signal-400" aria-hidden="true" />
                <span>{t("marketing:roi_turnaround")}</span>
              </div>
              <p className="tabular mt-1 text-lg font-semibold text-signal-400">
                {t("marketing:roi_turnaround_value", { hours: formatNumber(BATON_TARGET_WAIT_HOURS) })}
              </p>
              <p className="text-[11px] text-ink-500">
                {tc("marketing:roi_turnaround_from", avgWaitDays, {
                  count: formatNumber(avgWaitDays),
                })}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconCheckCircle className="h-3.5 w-3.5 text-brand-300" aria-hidden="true" />
                <span>{t("marketing:roi_slack_saved")}</span>
              </div>
              <p className="tabular mt-1 text-lg font-semibold text-ink-50">
                {formatNumber(chaseMessagesAvoided)}
              </p>
              <p className="text-[11px] text-ink-500">{t("marketing:roi_slack_quote")}</p>
            </div>
          </div>

          <p className="mt-5 border-t border-hairline pt-4 text-[11px] leading-reading text-ink-500">
            {t("marketing:roi_notice")}
          </p>
        </div>
      </div>
    </div>
  );
}
