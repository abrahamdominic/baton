import type { ReactNode } from "react";
import { cx } from "@/components/marketing/section";

/**
 * Bento tile. Tiles hold a small, real UI fragment rather than an icon. Size is
 * expressed through grid spans at the call site; the tile itself only owns
 * surface and rhythm.
 */
export function Tile({
  title,
  body,
  children,
  className,
  span = "default",
}: {
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
  span?: "default" | "wide" | "tall" | "hero";
}) {
  const spanClass =
    span === "wide"
      ? "sm:col-span-2"
      : span === "tall"
        ? "sm:row-span-2"
        : span === "hero"
          ? "sm:col-span-2 lg:col-span-2 lg:row-span-2"
          : "";
  return (
    <article
      className={cx(
        "flex flex-col rounded-feature border border-hairline bg-ink-900/50 p-5 transition-colors duration-base hover:border-hairline-strong sm:p-6",
        spanClass,
        className,
      )}
    >
      <h3 className="text-base font-semibold text-ink-50">{title}</h3>
      <p className="mt-1.5 max-w-measure text-sm text-ink-300">{body}</p>
      {children ? <div className="mt-4 min-w-0 flex-1">{children}</div> : null}
    </article>
  );
}
