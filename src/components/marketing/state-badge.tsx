import { cx } from "@/components/marketing/section";

export type BatonTone = "info" | "warn" | "danger" | "success" | "neutral";

/**
 * The tone vocabulary for the simulator and state explorer. Color is never the
 * only signal: every badge renders its text label beside the marker dot.
 */
const TONE_PILL: Record<BatonTone, string> = {
  info: "border-brand-400/40 bg-brand-500/10 text-brand-300",
  warn: "border-warn-400/40 bg-warn-500/10 text-warn-300",
  danger: "border-danger-400/40 bg-danger-500/10 text-danger-300",
  success: "border-signal-400/40 bg-signal-500/10 text-signal-300",
  neutral: "border-hairline bg-ink-850 text-ink-300",
};

const TONE_DOT: Record<BatonTone, string> = {
  info: "bg-brand-400",
  warn: "bg-warn-400",
  danger: "bg-danger-400",
  success: "bg-signal-400",
  neutral: "bg-ink-500",
};

export function StateBadge({
  tone,
  label,
  className,
}: {
  tone: BatonTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-medium",
        TONE_PILL[tone],
        className,
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}
