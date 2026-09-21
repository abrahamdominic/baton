import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

interface LogoProps {
  className?: string;
  showBadge?: boolean;
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
      <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="#0D0F18" stroke="#1E2333" strokeWidth="1.2" />
      <rect x="2.5" y="2.5" width="27" height="27" rx="6.5" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1" fill="none" />
      <path d="M8.5 23.5L23.5 8.5" stroke="#2A3044" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 20L20 12" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M13.5 18.5L18.5 13.5" stroke="#6366F1" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="23.5" r="3.2" fill="#10B981" />
      <circle cx="8.5" cy="23.5" r="1.3" fill="#0D0F18" />
      <circle cx="23.5" cy="8.5" r="3.2" fill="#818CF8" />
      <circle cx="23.5" cy="8.5" r="1.3" fill="#0D0F18" />
    </svg>
  );
}

export function BatonLogo({
  className = "",
  showBadge = true,
  size = "md",
  href = "/",
}: LogoProps) {
  const iconSize = size === "sm" ? 22 : size === "lg" ? 32 : 26;
  const textSize = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-[15px]";

  const content = (
    <div className={`group flex items-center gap-2.5 font-mono ${textSize} font-bold tracking-tight text-white ${className}`}>
      <div className="relative transition-transform duration-200 group-hover:scale-105">
        <BatonIcon size={iconSize} />
      </div>
      <span className="flex items-center gap-1.5 font-bold tracking-tight text-white">
        {SITE_NAME.toLowerCase()}
        {showBadge ? (
          <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.2 font-mono text-[10px] font-medium text-ink-300">
            v0.1
          </span>
        ) : null}
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
