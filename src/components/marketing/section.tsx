import type { ReactNode } from "react";
import Link from "next/link";
import { LinkArrow } from "@/components/marketing/arrow";

/** Join class names, dropping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * A section of the marketing page.
 *
 * Two pacing modes exist. The default is a contained column on the 12 column
 * grid. `bleed` paints a full-width band with an inner container, which is how
 * the page alternates volume. Every section is separated by a hairline border
 * rather than a divider character.
 */
export function Section({
  id,
  children,
  bleed = false,
  tone = "canvas",
  className,
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  bleed?: boolean;
  tone?: "canvas" | "panel";
  className?: string;
  labelledBy?: string;
}) {
  const inner = bleed ? "container-content" : "container-content";
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cx(
        "border-t border-hairline",
        tone === "panel" && "bg-ink-900/40",
        className,
      )}
    >
      <div className={cx(inner, "py-section-sm md:py-section")}>{children}</div>
    </section>
  );
}

/**
 * Section header: a short plain label, a display headline and a short lede,
 * all left aligned. The label uses the text face in sentence case rather than a
 * monospace caps eyebrow, which is a template tell and reads as decoration; the
 * label and headline are tied together with aria so a screen reader announces
 * the visual grouping.
 */
export function SectionHeader({
  label,
  title,
  lede,
  id,
  className,
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cx("max-w-measure", className)}>
      <p className="text-sm font-medium text-brand-300">{label}</p>
      <h2 id={id} className="mt-3 text-display-3 text-ink-50">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-base text-ink-300">{lede}</p> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border border-brand-400/40 bg-brand-500 text-on-brand hover:bg-brand-400 focus-visible:ring-brand-400",
  secondary:
    "border border-hairline-strong bg-ink-900/70 text-ink-100 hover:bg-ink-850 hover:border-hairline-strong focus-visible:ring-brand-400",
  ghost:
    "border border-transparent text-ink-200 hover:bg-ink-900/70 hover:text-ink-50 focus-visible:ring-brand-400",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

/**
 * Button: renders a `next/link` for internal targets, an anchor for external
 * ones, or a real `<button>` when no href is given. The arrow is opt-in and
 * rendered at most once.
 */
export function Button({
  href,
  external,
  onClick,
  variant = "primary",
  size = "md",
  arrow = false,
  className,
  type = "button",
  children,
  "aria-label": ariaLabel,
}: {
  href?: string;
  external?: boolean;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  className?: string;
  type?: "button" | "submit";
  children: ReactNode;
  "aria-label"?: string;
}) {
  const content = (
    <>
      {children}
      {arrow ? <LinkArrow /> : null}
    </>
  );
  if (href && external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass(variant, size, className)}
        aria-label={ariaLabel}
      >
        {content}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={buttonClass(variant, size, className)} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={buttonClass(variant, size, className)} aria-label={ariaLabel}>
      {content}
    </button>
  );
}

/**
 * A text link with the single system arrow. External links get a small
 * open-in-new-window glyph instead, so the arrow always means "go forward".
 */
export function LinkWithArrow({
  href,
  external,
  className,
  children,
}: {
  href: string;
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = cx(
    "inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 transition-colors duration-fast hover:text-brand-200",
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
        <LinkArrow />
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
      <LinkArrow />
    </Link>
  );
}
