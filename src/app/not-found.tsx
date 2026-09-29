import type { Metadata } from "next";
import Link from "next/link";
import { IconGitPullRequest, IconSearch } from "@/components/icons";
import { BatonIcon } from "@/components/logo";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * Root `not-found` boundary.
 *
 * Next.js calls `notFound()` from a dozen server actions and route handlers -
 * a deleted repo, a conversation the caller cannot see, a stale invite link.
 * Without this file each of those fell through to the framework's bare default,
 * which renders outside the app's font, palette, and shell: a white page in a
 * product that is dark by default.
 */
export default async function NotFound() {
  const { t } = await getTranslatorForRequest();

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-ink-100">
      <header className="border-b border-white/[0.06]">
        <div className="container-page flex h-16 items-center">
          <Link
            href="/"
            aria-label="Baton"
            className="flex items-center gap-2.5 font-mono text-[15px] font-bold tracking-tight"
          >
            <BatonIcon size={26} />
            <span className="text-ink-50">baton</span>
          </Link>
        </div>
      </header>

      <main className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
        <IconGitPullRequest className="h-12 w-12 text-ink-600" />

        <p className="mt-8 font-mono text-sm font-medium text-brand-400">404</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-50 sm:text-4xl">
          {t("errors:not_found")}
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-300">
          {t("common:page_not_found_description")}
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/dashboard" className="btn-primary">
            {t("navigation:dashboard")}
          </Link>
          <Link href="/" className="btn-secondary">
            <IconSearch className="h-4 w-4" />
            {t("navigation:home")}
          </Link>
        </div>
      </main>
    </div>
  );
}
