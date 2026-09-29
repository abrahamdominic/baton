import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string;
}

export function BatonIcon({
  className = "",
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* The plate and the track are theme tokens so the mark is legible on a
          dark page and on a light one. The baton itself and the two endpoint
          dots stay fixed: white on the dark plate in dark mode, and the plate
          token is always dark, so the mark's contrast never inverts. */}
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="7.5"
        className="fill-ink-950 stroke-ink-700"
        strokeWidth="1.2"
      />
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="6.5"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="1"
        fill="none"
        className="text-ink-50"
      />
      <path d="M8.5 23.5L23.5 8.5" className="stroke-ink-700" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 20L20 12" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M13.5 18.5L18.5 13.5" stroke="#6366F1" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="23.5" r="3.2" fill="#10B981" />
      <circle cx="8.5" cy="23.5" r="1.3" className="fill-ink-950" />
      <circle cx="23.5" cy="8.5" r="3.2" fill="#818CF8" />
      <circle cx="23.5" cy="8.5" r="1.3" className="fill-ink-950" />
    </svg>
  );
}

export function BatonLogo({
  className = "",
  size = "md",
  href = "/",
}: LogoProps) {
  const iconSize = size === "sm" ? 22 : size === "lg" ? 32 : 26;
  const textSize = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-[15px]";

  const content = (
    <div className={`group flex items-center gap-2.5 font-mono ${textSize} font-bold tracking-tight text-ink-50 ${className}`}>
      <div className="relative transition-transform duration-200 group-hover:scale-105">
        <BatonIcon size={iconSize} />
      </div>
      <span className="flex items-center gap-1.5 font-bold tracking-tight text-ink-50">
        {SITE_NAME.toLowerCase()}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex transition-opacity hover:opacity-90">
        {content}
      </Link>
    );
  }

  return content;
}
