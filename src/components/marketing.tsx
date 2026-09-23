import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { currentUser } from "@/lib/auth/session";
import { IconMenu, IconGitHub, IconArrowRight } from "@/components/icons";
import { BatonLogo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#states", label: "State engine" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/faq", label: "FAQ" },
];

const FOOTER_COLS = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#states", label: "State machine" },
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing & tiers" },
      { href: "/dashboard", label: "Your Move dashboard" },
    ],
  },
  {
    title: "Architecture & Security",
    links: [
      { href: "/security", label: "Security & privacy" },
      { href: "/docs#architecture", label: "Deterministic pipeline" },
      { href: "/docs#thresholds", label: "Threshold engine" },
      { href: "/docs#self-host", label: "Self-hosting guide" },
    ],
  },
  {
    title: "Resources & Open Source",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/faq", label: "FAQ" },
      { href: "https://github.com/baton-pr/baton", label: "GitHub repository", external: true },
      { href: "/auth/login?next=/dashboard", label: "Sign in with GitHub" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/terms", label: "Terms of service" },
      { href: "https://www.gnu.org/licenses/agpl-3.0.html", label: "AGPL-3.0 License", external: true },
    ],
  },
];

export function Logo({ className = "" }: { className?: string }) {
  return <BatonLogo className={className} />;
}

export async function MarketingHeader() {
  const user = await currentUser();
  const accountHref = user ? "/dashboard" : "/auth/login?next=/dashboard";
  const accountLabel = user ? "Dashboard" : "Sign in";

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <BatonLogo />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <a
            href="https://github.com/baton-pr/baton"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-ink-900/60 px-2.5 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:border-white/[0.16] hover:text-white"
          >
            <IconGitHub className="h-3.5 w-3.5" />
            <span>AGPL-3.0</span>
          </a>
          <Link href={accountHref} className="btn btn-ghost btn-sm">
            {accountLabel}
          </Link>
          {user ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Your Move Queue
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Link href="/install" className="btn btn-primary btn-sm">
              Install Baton
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Mobile menu */}
        <details className="group relative md:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white [&::-webkit-details-marker]:hidden">
            <IconMenu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </summary>
          <div className="absolute right-0 z-50 mt-3 w-64 rounded-xl border border-white/[0.12] bg-ink-900 p-3">
            <div className="flex items-center justify-end pb-2">
              <ThemeToggle className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-xs font-medium text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.08] pt-3">
              <Link href={accountHref} className="btn btn-ghost w-full">
                {accountLabel}
              </Link>
              <Link
                href={user ? "/dashboard" : "/install"}
                className="btn btn-primary w-full"
              >
                {user ? "Your Move Queue" : "Install Baton"}
              </Link>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

export async function MarketingFooter() {
  const user = await currentUser();
  const year = new Date().getFullYear();
  const accountLink = {
    href: user ? "/dashboard" : "/auth/login?next=/dashboard",
    label: user ? "Dashboard" : "Sign in with GitHub",
  };
  const footerCols = FOOTER_COLS.map((col) => ({
    ...col,
    links: col.links.map((l) => (l.label === "Sign in with GitHub" ? { ...l, ...accountLink } : l)),
  }));

  return (
    <footer className="border-t border-white/[0.07] bg-ink-950/60">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <BatonLogo />
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-400">
              Deterministic workflow automation for GitHub pull requests. Eliminates review stalls,
              pins the answer in the thread, and keeps code moving without AI hallucinations.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-ink-400">
              <span className="flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 font-mono text-[11px] text-signal-400">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500" />
                Least-privilege metadata
              </span>
              <span className="rounded-full border border-white/[0.08] bg-ink-900 px-2.5 py-1 font-mono text-[11px] text-ink-400">
                AGPL-3.0 Open Source
              </span>
            </div>

            <p className="mt-8 font-mono text-[11px] text-ink-500">
              © {year} {SITE_NAME} Software Inc. All rights reserved.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {footerCols.map((col) => (
              <div key={col.title}>
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                  {col.title}
                </h3>
                <ul className="mt-3.5 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-ink-400 transition-colors hover:text-white"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-xs text-ink-400 transition-colors hover:text-white"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-8 text-xs text-ink-500">
          <p>Engineered for high-performing engineering teams shipping daily.</p>
          <div className="flex items-center gap-4 text-ink-400 font-mono text-[11px]">
            <span>Status: Operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}