import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { IconMenu } from "@/components/icons";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

const FOOTER_COLS = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Documentation" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/security", label: "Security & privacy" },
      { href: "/auth/login?next=/dashboard", label: "Sign in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/terms", label: "Terms of service" },
    ],
  },
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2 font-mono text-lg font-bold tracking-tight text-ink-50 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#5B5BD6" />
        <g transform="rotate(45 12 12)">
          <rect x="7" y="11" width="10" height="2.4" rx="1.2" fill="#0B0E14" />
          <circle cx="17.2" cy="12.2" r="1.9" fill="#0B0E14" />
        </g>
      </svg>
      {SITE_NAME.toLowerCase()}
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-ink-800/70 hover:text-ink-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/auth/login" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
          <Link href="/auth/login?next=/dashboard" className="btn btn-primary btn-sm">
            Install Baton
          </Link>
        </div>

        <details className="group relative md:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-ink-700 text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-50 [&::-webkit-details-marker]:hidden">
            <IconMenu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-ink-700 bg-ink-900 p-2 shadow-lift">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2.5 text-sm text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-50"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-ink-800 pt-2">
              <Link href="/auth/login" className="btn btn-ghost w-full">
                Sign in
              </Link>
              <Link href="/auth/login?next=/dashboard" className="btn btn-primary w-full">
                Install Baton
              </Link>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-ink-800/80">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.2fr_2fr]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-400">
            A GitHub App that keeps pull requests moving by showing whose turn it is, right where
            the work happens.
          </p>
          <p className="mt-6 text-xs text-ink-500">
            © {year} {SITE_NAME} Software Inc. All rights reserved.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                {col.title}
              </h3>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-300 transition-colors hover:text-ink-50"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}