"use client";

import { useState } from "react";
import { IconCheckCircle, IconClock, IconGitPullRequest, IconBell } from "@/components/icons";

interface Scenario {
  id: string;
  tabLabel: string;
  stateBadge: string;
  badgeTone: "info" | "warn" | "danger" | "success";
  whoseTurn: string;
  turnRole: "Reviewers" | "Author" | "Maintainer";
  blockedFor: string;
  threshold: string;
  nextAction: string;
  triggerEvent: string;
  labelApplied: string;
  nudgeSent: boolean;
  nudgeText: string;
  ruleExplanation: string;
  checksStatus: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "stalled-review",
    tabLabel: "1. Review Stalled (48h)",
    stateBadge: "Waiting for review",
    badgeTone: "info",
    whoseTurn: "@sarah-chen",
    turnRole: "Reviewers",
    blockedFor: "48h 12m",
    threshold: "24h threshold",
    nextAction: "Review the latest changes (3 commits, +142 -18)",
    triggerEvent: "PR opened 2 days ago; review requested from @sarah-chen; no review submitted yet.",
    labelApplied: "baton:awaiting-review",
    nudgeSent: true,
    nudgeText: "Friendly nudge: PR #247 has been awaiting review for 48h (threshold: 24h). @sarah-chen could you take a look when you have a moment?",
    ruleExplanation: "Deterministic Rule: Open + Non-Draft + Pending Reviewer Request + Checks Green → State = AWAITING_REVIEW. Exceeded 24h threshold, so exactly 1 nudge dispatched.",
    checksStatus: "4/4 passing",
  },
  {
    id: "changes-requested",
    tabLabel: "2. Changes Requested",
    stateBadge: "Changes required",
    badgeTone: "warn",
    whoseTurn: "@dev-alex (Author)",
    turnRole: "Author",
    blockedFor: "6h 40m",
    threshold: "48h threshold",
    nextAction: "Address feedback on auth middleware in src/auth/session.ts",
    triggerEvent: "@sarah-chen submitted review with 'Request changes': 'Please ensure token expiry handles UTC timezone skew'.",
    labelApplied: "baton:changes-required",
    nudgeSent: false,
    nudgeText: "Timer active. 42h remaining before gentle reminder to author.",
    ruleExplanation: "Deterministic Rule: Latest review decision is CHANGES_REQUESTED. The baton immediately passes back to the author. Reviewers will NOT be nudged.",
    checksStatus: "4/4 passing",
  },
  {
    id: "re-review",
    tabLabel: "3. Fix Pushed (Re-review)",
    stateBadge: "Fix pushed, re-review due",
    badgeTone: "info",
    whoseTurn: "@sarah-chen",
    turnRole: "Reviewers",
    blockedFor: "3h 15m",
    threshold: "24h threshold",
    nextAction: "Verify fix commit 4d92fa1 for UTC timezone skew",
    triggerEvent: "@dev-alex pushed new commit 4d92fa1 ('fix: enforce UTC epoch in session verification').",
    labelApplied: "baton:re-review",
    nudgeSent: false,
    nudgeText: "Within grace period (3h elapsed of 24h threshold).",
    ruleExplanation: "Deterministic Rule: Previous review was CHANGES_REQUESTED, but author pushed new commits. State flips to RE_REVIEW. Timer resets to 0.",
    checksStatus: "4/4 passing",
  },
  {
    id: "ci-failing",
    tabLabel: "4. CI Failing (Checks Red)",
    stateBadge: "CI failing",
    badgeTone: "danger",
    whoseTurn: "@dev-alex (Author)",
    turnRole: "Author",
    blockedFor: "1h 05m",
    threshold: "12h threshold",
    nextAction: "Fix failing integration suite: test:integration (exit 1)",
    triggerEvent: "GitHub Actions run failed on 'test:integration'.",
    labelApplied: "baton:ci-failing",
    nudgeSent: false,
    nudgeText: "Reviewers spared. Baton prevents premature review requests while CI is red.",
    ruleExplanation: "Deterministic Rule: Regardless of review requests, if required check suites are failing, the PR is blocked on the author. Never ping reviewers for broken builds.",
    checksStatus: "1 failed, 3 passed",
  },
  {
    id: "ready-to-merge",
    tabLabel: "5. Approved & Ready to Merge",
    stateBadge: "Ready to merge",
    badgeTone: "success",
    whoseTurn: "@dev-alex or Maintainer",
    turnRole: "Maintainer",
    blockedFor: "18h 30m",
    threshold: "24h threshold",
    nextAction: "Squash and merge into main",
    triggerEvent: "@sarah-chen approved the pull request. All 4 CI checks are green, zero merge conflicts.",
    labelApplied: "baton:ready-to-merge",
    nudgeSent: false,
    nudgeText: "PR is green and unblocked. If unmerged past 24h, Baton will remind author/maintainer.",
    ruleExplanation: "Deterministic Rule: Review approved + Checks success + Mergeable. No more review needed, someone just needs to press the green button.",
    checksStatus: "All checks green",
  },
];

export function PrSimulator() {
  const [activeId, setActiveId] = useState("stalled-review");
  const current = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0];

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-ink-900/90">
      {/* Interactive Scenario Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] bg-ink-950/60 p-2.5">
        <span className="px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Scenarios:
        </span>
        {SCENARIOS.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "border border-brand-400/40 bg-brand-500/20 text-white shadow-sm"
                  : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200"
              }`}
            >
              {s.tabLabel}
            </button>
          );
        })}
      </div>

      {/* GitHub PR Header Bar */}
      <div className="border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal-500/20 text-signal-400">
              <IconGitPullRequest className="h-3 w-3" />
            </span>
            <span className="font-semibold text-white">
              feat(billing): idempotent webhook processor
            </span>
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
            Open
          </span>
          <span>·</span>
          <span>Opened 2 days ago by @dev-alex</span>
          <span>·</span>
          <span className="font-mono text-[11px] text-signal-400">+142</span>
          <span className="font-mono text-[11px] text-danger-400">-18</span>
        </div>
      </div>

      {/* PR Timeline: Pinned Baton Card */}
      <div className="p-4 sm:p-5">
        <div className="rounded-xl border border-brand-500/30 bg-ink-850">
          {/* Pinned Baton Status Comment Header */}
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5 bg-brand-500/5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-brand-400/40 bg-brand-600 text-white text-[10px] font-bold">
                B
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">baton</span>
                <span className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.2 text-[9px] font-semibold text-ink-300">
                  BOT
                </span>
                <span className="text-[11px] text-ink-400">pinned status comment</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <code className="rounded border border-white/[0.08] bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-brand-300">
                {current.labelApplied}
              </code>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-4 sm:p-5">
            {/* Status Pill & Turn Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-medium ${
                    current.badgeTone === "warn"
                      ? "border-warn-400/40 bg-warn-500/15 text-warn-300"
                      : current.badgeTone === "danger"
                      ? "border-danger-400/40 bg-danger-500/15 text-danger-300"
                      : current.badgeTone === "success"
                      ? "border-signal-400/40 bg-signal-500/15 text-signal-300"
                      : "border-brand-400/40 bg-brand-500/15 text-brand-300"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      current.badgeTone === "warn"
                        ? "bg-warn-400"
                        : current.badgeTone === "danger"
                        ? "bg-danger-400"
                        : current.badgeTone === "success"
                        ? "bg-signal-400"
                        : "bg-brand-400"
                    }`}
                  />
                  {current.stateBadge}
                </span>

                <span className="rounded-full border border-white/[0.08] bg-ink-800 px-2.5 py-0.5 font-mono text-[11px] text-ink-300">
                  Turn: {current.turnRole}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <IconClock className="h-3.5 w-3.5 text-ink-400" />
                <span>Blocked: <strong className="text-white font-mono">{current.blockedFor}</strong></span>
              </div>
            </div>

            {/* Grid of details */}
            <div className="mt-4 grid gap-3 rounded-lg border border-white/[0.06] bg-ink-950/40 p-3 sm:grid-cols-3 text-xs">
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">Whose Turn</span>
                <span className="mt-0.5 font-semibold text-white">{current.whoseTurn}</span>
              </div>
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">CI Checks</span>
                <span className="mt-0.5 font-medium text-ink-200">{current.checksStatus}</span>
              </div>
              <div>
                <span className="block font-mono text-[10px] uppercase text-ink-500">Threshold Policy</span>
                <span className="mt-0.5 font-mono text-ink-300">{current.threshold}</span>
              </div>
            </div>

            {/* Next Unblocking Action */}
            <div className="mt-3.5 flex items-start gap-2.5 rounded-lg border border-signal-500/20 bg-signal-500/5 p-3 text-xs">
              <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
              <div>
                <span className="font-semibold text-signal-300">Unblocking action:</span>
                <p className="mt-0.5 text-ink-200">{current.nextAction}</p>
              </div>
            </div>

            {/* Automated Nudge Status */}
            {current.nudgeSent ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs">
                <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                <div>
                  <span className="font-semibold text-brand-200">Dispatched Polite Nudge (Threshold Exceeded):</span>
                  <p className="mt-1 font-mono text-[11px] text-brand-100 bg-brand-950/40 p-2 rounded border border-brand-500/20">
                    &ldquo;{current.nudgeText}&rdquo;
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer note */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-ink-500 bg-ink-950/30">
            <span>Deterministic state machine · Updates automatically</span>
            <span>0 code diffs read</span>
          </div>
        </div>

        {/* Technical Explainer Callout */}
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-ink-950/50 p-3 text-xs">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            <span className="text-white font-semibold">Under the hood:</span>
            <span className="text-ink-400">{current.triggerEvent}</span>
          </div>
          <p className="mt-1.5 text-ink-400 leading-relaxed font-mono text-[11px]">
            {current.ruleExplanation}
          </p>
        </div>
      </div>
    </div>
  );
}
