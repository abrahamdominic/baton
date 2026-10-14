import type { ReactNode } from "react";
import { cx } from "@/components/marketing/section";

/**
 * A single metric. The value uses the display face with tabular figures so a
 * column of metrics lines up without falling back to monospace, which the type
 * system reserves for code, state names and identifiers. Every metric carries a
 * source or an explicit framing note: Baton does not print a number without
 * saying where it comes from.
 */
export function Metric({
  value,
  label,
  source,
  className,
}: {
  value: ReactNode;
  label: string;
  source?: string;
  className?: string;
}) {
  return (
    <div className={cx("px-5 py-6 first:ps-0 last:pe-0", className)}>
      <p className="tabular text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
        {value}
      </p>
      <p className="mt-2 text-sm font-medium text-ink-200">{label}</p>
      {source ? <p className="mt-1 text-[11px] text-ink-500">{source}</p> : null}
    </div>
  );
}
