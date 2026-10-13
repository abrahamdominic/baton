import Link from "next/link";
import { GITHUB_ISSUES_URL, GITHUB_URL, SITE_NAME } from "@/lib/site";
import { currentUser } from "@/lib/auth/session";
import { IconGitHub } from "@/components/icons";
import { BatonLogo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LinkArrow } from "@/components/marketing/arrow";
import { Button } from "@/components/marketing/section";
import { MobileMenu } from "@/components/marketing/mobile-menu";
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
  const navLabel = t("marketing:nav_product");

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-ink-950/85 backdrop-blur-md">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50 focus:rounded-control focus:bg-brand-500 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-on-brand"
      >
        {t("marketing:skip_to_content")}
      </a>
      <div className="container-content flex h-16 items-center justify-between gap-4">
        <BatonLogo />

        <nav className="hidden items-center gap-1 md:flex" aria-label={navLabel}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-control px-3 py-1.5 text-sm font-medium text-ink-300 transition-colors duration-fast hover:bg-ink-850 hover:text-ink-50"
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
            className="flex items-center gap-1.5 rounded-control border border-hairline-strong bg-ink-900/60 px-2.5 py-1.5 text-xs font-medium text-ink-300 transition-colors duration-fast hover:text-ink-50"
          >
            <IconGitHub className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("marketing:hero_badge_license")}</span>
          </a>
          <Link
            href={accountHref}
            className="rounded-control px-3 py-1.5 text-sm font-medium text-ink-300 transition-colors duration-fast hover:text-ink-50"
          >
            {accountLabel}
          </Link>
          <Button href={user ? "/dashboard" : "/install"} size="sm" arrow>
            {primaryLabel}
          </Button>
        </div>

        <MobileMenu
          items={NAV.map((item) => ({ href: item.href, label: t(item.labelKey) }))}
          accountHref={accountHref}
          accountLabel={accountLabel}
          primaryHref={user ? "/dashboard" : "/install"}
          primaryLabel={primaryLabel}
          openLabel={t("marketing:open_menu")}
          closeLabel={t("marketing:close_menu")}
          navLabel={navLabel}
        />
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
    <footer className="border-t border-hairline bg-ink-950/60">
      <div className="container-content py-16">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <BatonLogo />
            <p className="mt-4 max-w-sm text-sm leading-reading text-ink-400">
              {t("marketing:footer_blurb")}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-ink-400">
              <span className="flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 font-mono text-[11px] text-signal-400">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
                {t("marketing:footer_evidence_badge")}
              </span>
              <span className="rounded-full border border-hairline bg-ink-900 px-2.5 py-1 font-mono text-[11px] text-ink-400">
                {t("marketing:footer_license_badge")}
              </span>
            </div>

            <p className="mt-8 font-mono text-[11px] text-ink-500">
              {year} {SITE_NAME}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER_COLS.map((col) => (
              <div key={col.titleKey}>
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                  {t(col.titleKey)}
                </h2>
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
                            className="text-sm text-ink-400 transition-colors duration-fast hover:text-ink-50"
                          >
                            {label}
                          </a>
                        ) : (
                          <Link
                            href={href}
                            className="text-sm text-ink-400 transition-colors duration-fast hover:text-ink-50"
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

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-8 text-xs text-ink-500">
          <p>{t("marketing:footer_bottom_line")}</p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-ink-400 transition-colors duration-fast hover:text-ink-50"
          >
            {t("marketing:footer_link_repo")}
            <LinkArrow className="h-3 w-3" />
          </a>
        </div>
      </div>
    </footer>
  );
}
