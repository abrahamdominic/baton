"use client";

import { useState } from "react";
import { IconZap, IconCheckCircle } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";

/** Hours of waiting Baton is modelled to leave behind on a healthy repo. */
const BATON_TARGET_WAIT_HOURS = 8;

/** "Someone went looking for the PR instead of the person" pings per open PR. */
const CHASE_PINGS_PER_PR = 2.4;

const WEEKS_PER_MONTH = 4.33;

export function RoiCalculator() {
  const { t, tc, formatNumber } = useI18n();
  const [teamSize, setTeamSize] = useState(15);
  const [prsPerWeek, setPrsPerWeek] = useState(25);
  const [avgWaitDays, setAvgWaitDays] = useState(3);

  // Math:
  // Total PRs per month = prsPerWeek * 4.33
  // Current total wait hours = total PRs * (avgWaitDays * 24)
  // With Baton: avg wait drops to ~8h (0.33 days)
  // Hours saved = total PRs * ((avgWaitDays - 0.33) * 24)
  const totalPrsMonth = Math.round(prsPerWeek * WEEKS_PER_MONTH);
  const currentStallHours = Math.round(totalPrsMonth * avgWaitDays * 24);
  const batonStallHours = Math.round(totalPrsMonth * BATON_TARGET_WAIT_HOURS);
  const savedStallHours = Math.max(0, currentStallHours - batonStallHours);
  const chaseMessagesAvoided = Math.round(totalPrsMonth * CHASE_PINGS_PER_PR);

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-ink-900 p-6 sm:p-8">
      <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="team-size" className="text-sm font-semibold text-white">
                {t("marketing:roi_team_size")}
              </label>
              <span className="font-mono text-sm font-bold text-brand-300">
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
            <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-500">
              <span>3</span>
              <span>75</span>
              <span>150+</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="weekly-prs" className="text-sm font-semibold text-white">
                {t("marketing:roi_weekly_prs")}
              </label>
              <span className="font-mono text-sm font-bold text-brand-300">
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
            <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-500">
              <span>5</span>
              <span>125</span>
              <span>250+</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="avg-wait" className="text-sm font-semibold text-white">
                {t("marketing:roi_avg_wait")}
              </label>
              <span className="font-mono text-sm font-bold text-warn-300">
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
            <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-500">
              <span>1</span>
              <span>3.5</span>
              <span>7</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-brand-500/30 bg-ink-950/70 p-6 sm:p-7">
          <span className="block font-mono text-[11px] uppercase tracking-wider text-brand-300">
            {t("marketing:roi_impact_eyebrow")}
          </span>

          <div className="mt-4 border-b border-white/[0.08] pb-5">
            <div className="font-mono text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              {formatNumber(savedStallHours)}{" "}
              <span className="text-xl font-normal text-brand-300">
                {tc("marketing:roi_saved_hours_unit", savedStallHours)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              {tc("marketing:roi_saved_hours_caption", totalPrsMonth, { count: formatNumber(totalPrsMonth) })}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconZap className="h-3.5 w-3.5 text-signal-400" />
                <span>{t("marketing:roi_turnaround")}</span>
              </div>
              <p className="mt-1 font-mono text-lg font-bold text-signal-400">
                {t("marketing:roi_turnaround_value", { hours: formatNumber(BATON_TARGET_WAIT_HOURS) })}
              </p>
              <p className="text-[11px] text-ink-500">
                {tc("marketing:roi_turnaround_from", avgWaitDays, { count: formatNumber(avgWaitDays) })}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconCheckCircle className="h-3.5 w-3.5 text-brand-300" />
                <span>{t("marketing:roi_slack_saved")}</span>
              </div>
              <p className="mt-1 font-mono text-lg font-bold text-white">
                ~{formatNumber(chaseMessagesAvoided)}/mo
              </p>
              <p className="text-[11px] text-ink-500">{t("marketing:roi_slack_quote")}</p>
            </div>
          </div>

          <p className="mt-5 border-t border-white/[0.06] pt-4 text-[11px] leading-relaxed text-ink-500">
            {t("marketing:roi_notice")}
          </p>
        </div>
      </div>
    </div>
  );
}
