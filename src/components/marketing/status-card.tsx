import type { ReactNode } from "react";
import { cx } from "@/components/marketing/section";
import { StateBadge, type BatonTone } from "@/components/marketing/state-badge";
import { IconClock, IconBell, IconCheckCircle, IconGitPullRequest } from "@/components/marketing/icons";

export interface StatusCardModel {
  /** Repository and pull request identity. */
  repo: string;
  prNumber: string;
  title: string;
  branchLine: string;
  openedLine: string;
  /** The engine's decision. */
  stateLabel: string;
  tone: BatonTone;
  ownerLabel: string;
  owner: string;
  blockedFor: string;
  threshold: string;
  checks: string;
  nextAction: string;
  /** The GitHub label Baton writes. */
  labelName: string;
  /** Optional dispatched nudge, quoted verbatim. */
  nudge?: string;
  /** Heading for the "next" line, localised by the caller. */
  nextHeading: string;
  nudgeHeading?: string;
  /** Whose-turn pill prefix, localised by the caller. */
  turnPrefix: string;
  botBadge: string;
  pinnedLabel: string;
  whoseTurnHeading: string;
  checksHeading: string;
  thresholdHeading: string;
  footerLeft: string;
  footerRight: string;
  /** Optional slot rendered under the card, used for the under-the-hood rule. */
  footer?: ReactNode;
  className?: string;
}

/**
 * The pinned status comment, rendered as real HTML rather than a screenshot.
 *
 * This is the product's central artifact and the strongest proof on the page, so
 * it is the same component in the hero, the simulator and the state explorer.
 * Every semantic state color is paired with a text label.
 */
export function StatusCard({
  model,
  compact = false,
  className,
}: {
  model: StatusCardModel;
  compact?: boolean;
  className?: string;
}) {
  return (
    <article
      className={cx(
        "overflow-hidden rounded-panel border border-hairline-strong bg-ink-900",
        className,
      )}
      aria-label={model.pinnedLabel}
    >
      {/* Comment header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-ink-950/40 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 font-display text-[11px] font-semibold text-on-brand"
            aria-hidden="true"
          >
            B
          </span>
          <span className="text-xs font-semibold text-ink-50">baton</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-400">
            {model.botBadge}
          </span>
          <span className="hidden text-[11px] text-ink-500 sm:inline">{model.pinnedLabel}</span>
        </div>
        <code className="rounded border border-hairline bg-ink-950 px-2 py-0.5 font-mono text-[10px] text-brand-300">
          {model.labelName}
        </code>
      </header>

      {/* Pull request identity */}
      <div className="border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <IconGitPullRequest className="h-3.5 w-3.5 shrink-0 text-signal-400" />
            <span className="truncate text-sm font-medium text-ink-50">{model.title}</span>
            <span className="shrink-0 font-mono text-xs text-ink-500">#{model.prNumber}</span>
          </div>
          <span className="shrink-0 rounded bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-ink-300">
            {model.branchLine}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
            open
          </span>
          <span>{model.openedLine}</span>
        </div>
      </div>

      {/* Decision */}
      <div className={cx("px-4", compact ? "py-3.5" : "py-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge tone={model.tone} label={model.stateLabel} />
            <span className="rounded-full border border-hairline bg-ink-850 px-2.5 py-0.5 font-mono text-[11px] text-ink-300">
              {model.turnPrefix} {model.ownerLabel}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-ink-400">
            <IconClock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {model.blockedFor}
            </span>
          </span>
        </div>

        <dl className="mt-3.5 grid gap-3 rounded-control border border-hairline bg-ink-950/40 p-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
              {model.whoseTurnHeading}
            </dt>
            <dd className="mt-0.5 font-medium text-ink-50">{model.owner}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
              {model.checksHeading}
            </dt>
            <dd className="mt-0.5 font-medium text-ink-200">{model.checks}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
              {model.thresholdHeading}
            </dt>
            <dd className="tabular mt-0.5 font-mono text-ink-300">{model.threshold}</dd>
          </div>
        </dl>

        <div className="mt-3 flex items-start gap-2.5 rounded-control border border-signal-500/25 bg-signal-500/5 p-3 text-xs">
          <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" aria-hidden="true" />
          <div>
            <span className="font-medium text-signal-300">{model.nextHeading}</span>
            <p className="mt-0.5 text-ink-200">{model.nextAction}</p>
          </div>
        </div>

        {model.nudge ? (
          <div className="mt-3 flex items-start gap-2.5 rounded-control border border-brand-500/30 bg-brand-500/10 p-3 text-xs">
            <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
            <div className="min-w-0">
              <span className="font-medium text-brand-200">{model.nudgeHeading}</span>
              <p className="mt-1 rounded border border-brand-500/20 bg-ink-950/50 p-2 font-mono text-[11px] leading-relaxed text-brand-100">
                {model.nudge}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-hairline bg-ink-950/30 px-4 py-2 font-mono text-[11px] text-ink-500">
        <span>{model.footerLeft}</span>
        <span>{model.footerRight}</span>
      </footer>

      {model.footer}
    </article>
  );
}
