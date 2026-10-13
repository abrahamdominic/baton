import type { ReactNode } from "react";
import { cx } from "@/components/marketing/section";

/**
 * Real table semantics with a caption and scoped headers. On narrow screens the
 * table scrolls horizontally rather than collapsing into colour-only cells, and
 * no cell relies on color alone.
 */
export function Table({
  caption,
  head,
  children,
  className,
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-x-auto rounded-panel border border-hairline", className)}>
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ink-950/60 font-mono text-[11px] uppercase tracking-wide text-ink-400">
          {head}
        </thead>
        <tbody className="divide-y divide-hairline">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  scope = "col",
  className,
}: {
  children: ReactNode;
  scope?: "col" | "row";
  className?: string;
}) {
  return (
    <th
      scope={scope}
      className={cx(
        "px-4 py-3.5 font-semibold first:ps-5 last:pe-5",
        scope === "row" ? "text-start text-ink-50" : "text-ink-400",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  highlight = false,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <td
      className={cx(
        "px-4 py-3.5 align-top text-ink-300 first:ps-5 last:pe-5",
        highlight && "bg-brand-500/[0.04] text-ink-100",
        className,
      )}
    >
      {children}
    </td>
  );
}
