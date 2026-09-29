import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconGitHub, IconArrowRight } from "@/components/icons";
import { GITHUB_ISSUES_URL } from "@/lib/site";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    alternates: { canonical: "/faq" },
    title: t("faq:meta_title"),
    description: t("faq:meta_description"),
  };
}

/**
 * The questions, in the order they are rendered.
 *
 * Only the category and the question ids live here. The prose is a resource
 * string so the page, the JSON-LD, and every translation all read from one
 * source; the same `faq:` key resolves all three.
 */
const FAQ_GROUPS = [
  { ns: "core", categoryKey: "faq:cat_core", items: ["q1", "q2", "q3"] },
  {
    ns: "security",
    categoryKey: "faq:cat_security",
    items: ["q1", "q2", "q3"],
  },
  { ns: "nudges", categoryKey: "faq:cat_nudges", items: ["q1", "q2"] },
  { ns: "billing", categoryKey: "faq:cat_billing", items: ["q1", "q2"] },
] as const;

export default async function FaqPage() {
  const { t } = await getTranslatorForRequest();

  /**
   * Built per request so the structured data a crawler reads is in the same
   * language as the visible page, rather than always English.
   */
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_GROUPS.flatMap((group) =>
      group.items.map((id) => ({
        "@type": "Question",
        name: t(`faq:${group.ns}_${id}_q`),
        acceptedAnswer: {
          "@type": "Answer",
          text: t(`faq:${group.ns}_${id}_a`),
        },
      })),
    ),
  };

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            {t("faq:h1")}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300 sm:text-base">
            {t("faq:intro")}
          </p>
        </div>

        <div className="mt-14 space-y-12">
          {FAQ_GROUPS.map((group) => {
            return (
              <div key={group.categoryKey} className="space-y-4">
                <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-brand-300">
                  {t(group.categoryKey)}
                </h2>
                <div className="space-y-3">
                  {group.items.map((id) => (
                    <details
                      key={id}
                      className="group rounded-xl border border-white/[0.08] bg-ink-900/60 transition-all hover:border-white/[0.14] open:border-brand-500/40 open:bg-ink-850"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-semibold text-white transition-colors group-hover:text-brand-200 [&::-webkit-details-marker]:hidden">
                        <span>{t(`faq:${group.ns}_${id}_q`)}</span>
                        <span
                          aria-hidden="true"
                          className="ml-4 font-mono text-lg text-ink-500 transition-transform duration-200 group-open:rotate-45 group-open:text-brand-400"
                        >
                          +
                        </span>
                      </summary>
                      <div className="border-t border-white/[0.06] px-6 pb-5 pt-3.5 text-xs leading-relaxed text-ink-300 sm:text-sm">
                        {t(`faq:${group.ns}_${id}_a`)}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/[0.08] bg-ink-900/40 p-8 text-center sm:text-left">
          <div>
            <h2 className="text-base font-bold text-white">
              {t("faq:help_title")}
            </h2>
            <p className="mt-1 text-xs text-ink-400">{t("faq:help_body")}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 sm:mt-0">
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              {t("faq:help_action")}
            </a>
            <Link href="/docs" className="btn btn-primary btn-sm">
              {t("faq:help_docs")}
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
