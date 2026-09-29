import Link from "next/link";
import { GITHUB_ISSUES_URL, GITHUB_URL, SITE_NAME } from "@/lib/site";
import { currentUser } from "@/lib/auth/session";
import { IconMenu, IconGitHub, IconArrowRight } from "@/components/icons";
import { BatonLogo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

/**
 * Public header and footer.
 *
 * Labels are translation keys rather than strings so the same component serves
 * every locale. The hrefs are the stable part of each entry; `labelKey` is what
 * changes per language.
 */
const NAV: ReadonlyArray<{ href: string; labelKey: string }> = [
  { href: "/#how-it-works", labelKey: "marketing:nav_how_it_works" },
  { href: "/#states", labelKey: "marketing:nav_state_engine" },
  { href: "/#features", labelKey: "marketing:nav_features" },
  { href: "/pricing", labelKey: "marketing:nav_pricing" },
  { href: "/docs", labelKey: "marketing:nav_docs" },
  { href: "/faq", labelKey: "marketing:nav_faq" },
];

const FOOTER_COLS: ReadonlyArray<{
  titleKey: string;
  links: ReadonlyArray<{ href: string; labelKey: string; external?: boolean; account?: boolean }>;
}> = [
  {
    titleKey: "marketing:footer_col_product",
    links: [
      { href: "/#how-it-works", labelKey: "marketing:footer_link_how_it_works" },
      { href: "/#states", labelKey: "marketing:footer_link_state_machine" },
      { href: "/#features", labelKey: "marketing:footer_link_features" },
      { href: "/pricing", labelKey: "marketing:footer_link_pricing_tiers" },
      { href: "/dashboard", labelKey: "marketing:footer_link_dashboard" },
    ],
  },
  {
    titleKey: "marketing:footer_col_architecture",
    links: [
      { href: "/security", labelKey: "marketing:footer_link_security_privacy" },
      { href: "/docs#architecture", labelKey: "marketing:footer_link_pipeline" },
      { href: "/docs#thresholds", labelKey: "marketing:footer_link_thresholds" },
      { href: "/docs#self-host", labelKey: "marketing:footer_link_selfhost" },
    ],
  },
  {
    titleKey: "marketing:footer_col_resources",
    links: [
      { href: "/docs", labelKey: "marketing:footer_docs" },
      { href: "/faq", labelKey: "marketing:footer_faq" },
      { href: GITHUB_URL, labelKey: "marketing:footer_link_repo", external: true },
      { href: GITHUB_ISSUES_URL, labelKey: "marketing:footer_link_issue", external: true },
      { href: "/auth/login?next=/dashboard", labelKey: "marketing:footer_link_signin_github", account: true },
    ],
  },
  {
    titleKey: "marketing:footer_col_legal",
    links: [
      { href: "/legal/privacy", labelKey: "marketing:footer_link_privacy_policy" },
      { href: "/legal/terms", labelKey: "marketing:footer_link_terms_of_service" },
      {
        href: "https://www.gnu.org/licenses/agpl-3.0.html",
        labelKey: "marketing:footer_link_license",
        external: true,
      },
    ],
  },
];

export function Logo({ className = "" }: { className?: string }) {
  return <BatonLogo className={className} />;
}

export async function MarketingHeader() {
  const [user, { t }] = await Promise.all([currentUser(), getTranslatorForRequest()]);
  const accountHref = user ? "/dashboard" : "/auth/login?next=/dashboard";
  const accountLabel = t(user ? "navigation:dashboard" : "marketing:sign_in");
  const primaryLabel = t(user ? "marketing:header_move_queue" : "marketing:header_install");

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <BatonLogo />

        <nav className="hidden items-center gap-1 md:flex" aria-label={t("marketing:nav_product")}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <a
            href={GITHUB_URL}
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
          <Link href={user ? "/dashboard" : "/install"} className="btn btn-primary btn-sm">
            {primaryLabel}
            <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Mobile menu */}
        <details className="group relative md:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white [&::-webkit-details-marker]:hidden">
            <IconMenu className="h-5 w-5" />
            <span className="sr-only">{t("marketing:open_menu")}</span>
          </summary>
          <div className="absolute end-0 z-50 mt-3 w-64 rounded-xl border border-white/[0.12] bg-ink-900 p-3">
            <div className="flex items-center justify-end pb-2">
              <ThemeToggle className="h-8" />
            </div>
            <nav className="space-y-1" aria-label={t("marketing:nav_product")}>
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-xs font-medium text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {t(item.labelKey)}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.08] pt-3">
              <Link href={accountHref} className="btn btn-ghost w-full">
                {accountLabel}
              </Link>
              <Link href={user ? "/dashboard" : "/install"} className="btn btn-primary w-full">
                {primaryLabel}
              </Link>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

export async function MarketingFooter() {
  const [user, { t, formatNumber }] = await Promise.all([
    currentUser(),
    getTranslatorForRequest(),
  ]);
  const year = formatNumber(new Date().getFullYear(), { useGrouping: false });
  const accountHref = user ? "/dashboard" : "/auth/login?next=/dashboard";
  const accountLabel = t(user ? "navigation:dashboard" : "marketing:footer_link_signin_github");

  return (
    <footer className="border-t border-white/[0.07] bg-ink-950/60">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <BatonLogo />
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-400">
              {t("marketing:footer_blurb")}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-ink-400">
              <span className="flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 font-mono text-[11px] text-signal-400">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500" />
                {t("marketing:footer_evidence_badge")}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-ink-900 px-2.5 py-1 font-mono text-[11px] text-ink-400">
                {t("marketing:footer_license_badge")}
              </span>
            </div>

            <p className="mt-8 font-mono text-[11px] text-ink-500">
              © {year} {SITE_NAME}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER_COLS.map((col) => (
              <div key={col.titleKey}>
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                  {t(col.titleKey)}
                </h3>
                <ul className="mt-3.5 space-y-2.5">
                  {col.links.map((l) => {
                    const href = l.account ? accountHref : l.href;
                    const label = l.account ? accountLabel : t(l.labelKey);
                    return (
                      <li key={l.labelKey}>
                        {l.external ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-ink-400 transition-colors hover:text-white"
                          >
                            {label}
                          </a>
                        ) : (
                          <Link
                            href={href}
                            className="text-xs text-ink-400 transition-colors hover:text-white"
                          >
                            {label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-8 text-xs text-ink-500">
          <p>{t("marketing:footer_bottom_line")}</p>
        </div>
      </div>
    </footer>
  );
}
