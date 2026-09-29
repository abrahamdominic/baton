import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconLock, IconShield, IconCheckCircle, IconArrowRight } from "@/components/icons";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    alternates: { canonical: "/security" },
    title: t("security:meta_title"),
    description: t("security:meta_description"),
  };
}

/**
 * The GitHub App manifest's scopes, row for row.
 *
 * `denied` is an explicit flag rather than a test on the status text: the
 * original code called `status.includes("Denied")`, which silently inverted the
 * styling the moment the string was translated.
 */
const PERMISSIONS_MATRIX = [
  { key: "row_1", denied: false },
  { key: "row_2", denied: false },
  { key: "row_3", denied: false },
  { key: "row_4", denied: false },
  { key: "row_5", denied: true },
  { key: "row_6", denied: true },
  { key: "row_7", denied: true },
] as const;

const PRINCIPLES = [
  {
    icon: IconShield,
    titleKey: "security:principle_webhook_title",
    bodyKey: "security:principle_webhook_body",
    code: ["x-hub-signature-256"],
  },
  {
    icon: IconCheckCircle,
    titleKey: "security:principle_retention_title",
    bodyKey: "security:principle_retention_body",
    code: [],
  },
  {
    icon: IconLock,
    titleKey: "security:principle_tenant_title",
    bodyKey: "security:principle_tenant_body",
    code: ["httpOnly", "SameSite=Lax"],
  },
  {
    icon: IconShield,
    titleKey: "security:principle_disclosure_title",
    bodyKey: "security:principle_disclosure_body",
    code: [],
  },
] as const;

const DISCLOSURE_EMAIL = "security@baton.dev";

export default async function SecurityPage() {
  const { t } = await getTranslatorForRequest();

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            {t("security:h1")}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300 sm:text-base">
            {t("security:intro")}
          </p>
        </div>

        <section className="mt-14">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-brand-300">
            <IconLock className="h-4 w-4" />
            <span>{t("security:matrix_heading")}</span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/70">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                  <th scope="col" className="py-3.5 ps-6 pe-4 font-semibold">
                    {t("security:th_scope")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 font-semibold">
                    {t("security:th_access")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 font-semibold">
                    {t("security:th_status")}
                  </th>
                  <th scope="col" className="py-3.5 pe-6 ps-4 font-semibold">
                    {t("security:th_purpose")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {PERMISSIONS_MATRIX.map((p) => (
                  <tr key={p.key} className="hover:bg-white/[0.02]">
                    <th scope="row" className="py-3.5 ps-6 pe-4 text-start font-semibold text-white">
                      {t(`security:${p.key}_scope`)}
                    </th>
                    <td className="py-3.5 px-4 font-mono text-ink-300">
                      {t(`security:${p.key}_access`)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                          p.denied
                            ? "border border-signal-500/30 bg-signal-500/10 text-signal-400"
                            : "border border-brand-400/30 bg-brand-500/10 text-brand-300"
                        }`}
                      >
                        {t(`security:${p.key}_status`)}
                      </span>
                    </td>
                    <td className="py-3.5 pe-6 ps-4 text-ink-400">
                      {t(`security:${p.key}_purpose`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-16 grid gap-6 md:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.titleKey} className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-300">
                <p.icon className="h-4 w-4" />
                <span>{t(p.titleKey)}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-300">
                {t(p.bodyKey)}
              </p>
              {p.code.length > 0 ? (
                // The literals are API identifiers (headers, cookie attributes),
                // not prose, so they stay untranslated and are listed for
                // reference only.
                <p className="mt-2 font-mono text-[10px] text-ink-500">{p.code.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </section>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/[0.08] bg-ink-900/40 p-8">
          <div>
            <h2 className="text-base font-bold text-white">{t("security:cta_title")}</h2>
            <p className="mt-1 text-xs text-ink-400">{t("security:cta_body")}</p>
            <a
              href={`mailto:${DISCLOSURE_EMAIL}`}
              className="mt-2 inline-block font-mono text-xs text-brand-300 underline underline-offset-4 hover:text-brand-200"
            >
              {DISCLOSURE_EMAIL}
            </a>
          </div>
          <Link href="/pricing" className="btn btn-primary btn-sm">
            {t("security:cta_action")}
            <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
