"use client";

import { useState } from "react";
import { IconZap, IconCheckCircle } from "@/components/icons";

export function RoiCalculator() {
  const [teamSize, setTeamSize] = useState(15);
  const [prsPerWeek, setPrsPerWeek] = useState(25);
  const [avgWaitDays, setAvgWaitDays] = useState(3);

  // Math:
  // Total PRs per month = prsPerWeek * 4.33
  // Current total wait hours = total PRs * (avgWaitDays * 24)
  // With Baton: avg wait drops to ~8h (0.33 days)
  // Hours saved = total PRs * ((avgWaitDays - 0.33) * 24)
  const totalPrsMonth = Math.round(prsPerWeek * 4.33);
  const currentStallHours = Math.round(totalPrsMonth * avgWaitDays * 24);
  const batonStallHours = Math.round(totalPrsMonth * 8);
  const savedStallHours = Math.max(0, currentStallHours - batonStallHours);
  const slackPingsAvoided = Math.round(totalPrsMonth * 2.4);

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-ink-900 p-6 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] items-center">
        {/* Sliders */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="team-size" className="text-sm font-semibold text-white">
                Team size (engineers)
              </label>
              <span className="font-mono text-sm font-bold text-brand-300">
                {teamSize} devs
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
              className="mt-2 w-full accent-brand-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-ink-500 mt-1">
              <span>3 devs</span>
              <span>75 devs</span>
              <span>150+ devs</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="weekly-prs" className="text-sm font-semibold text-white">
                Weekly open PRs across repos
              </label>
              <span className="font-mono text-sm font-bold text-brand-300">
                {prsPerWeek} PRs/wk
              </span>
            </div>
            <input
              id="weekly-prs"
              type="range"
              min="5"
              max="250"
              value={prsPerWeek}
              onChange={(e) => setPrsPerWeek(Number(e.target.value))}
              className="mt-2 w-full accent-brand-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-ink-500 mt-1">
              <span>5 PRs</span>
              <span>125 PRs</span>
              <span>250+ PRs</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="avg-wait" className="text-sm font-semibold text-white">
                Current average wait before first review
              </label>
              <span className="font-mono text-sm font-bold text-warn-300">
                {avgWaitDays} days ({avgWaitDays * 24}h)
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
              className="mt-2 w-full accent-brand-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-ink-500 mt-1">
              <span>1 day</span>
              <span>3.5 days</span>
              <span>7 days</span>
            </div>
          </div>
        </div>

        {/* Results Card */}
        <div className="rounded-xl border border-brand-500/30 bg-ink-950/70 p-6 sm:p-7">
          <span className="font-mono text-[11px] uppercase tracking-wider text-brand-300 block">
            Impact for your team:
          </span>

          <div className="mt-4 border-b border-white/[0.08] pb-5">
            <div className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
              {savedStallHours.toLocaleString()}{" "}
              <span className="text-xl font-normal text-brand-300">hours</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              PR waiting time eliminated every month across {totalPrsMonth} pull requests.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconZap className="h-3.5 w-3.5 text-signal-400" />
                <span>Turnaround time</span>
              </div>
              <p className="mt-1 font-mono text-lg font-bold text-signal-400">
                ~8h avg
              </p>
              <p className="text-[11px] text-ink-500">Down from {avgWaitDays} days</p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconCheckCircle className="h-3.5 w-3.5 text-brand-300" />
                <span>Slack pings saved</span>
              </div>
              <p className="mt-1 font-mono text-lg font-bold text-white">
                ~{slackPingsAvoided.toLocaleString()}/mo
              </p>
              <p className="text-[11px] text-ink-500">&ldquo;Who&apos;s reviewing this?&rdquo;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
