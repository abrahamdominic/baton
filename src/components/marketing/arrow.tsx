import type { SVGProps } from "react";

/**
 * The one arrow in the system.
 *
 * Hand-drawn on a 16 by 16 grid: a horizontal shaft and a chevron head. It is a
 * real SVG path, never a unicode arrow glyph and never an icon-library import.
 * Used at most once inside a button or a link, only where it signals a forward
 * action.
 */
export function LinkArrow({ className = "h-3.5 w-3.5", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M2.5 8h11" />
      <path d="M9 3.5 13.5 8 9 12.5" />
    </svg>
  );
}

/** A small open-in-new-window glyph for external links. */
export function ExternalGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7 9" />
    </svg>
  );
}
