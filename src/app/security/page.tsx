import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconLock, IconShield, IconCheckCircle } from "@/components/icons";
import { Section, SectionHeader, Button } from "@/components/marketing/section";
import { Table, Th, Td } from "@/components/marketing/table";
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
 * `denied` is an explicit flag rather than a test on the status text: inferring
 * it from the string silently inverted the styling the moment it was
 * translated.
 */
const PERMISSIONS_MATRIX = [
  { key: "row_1", denied: false },
  { key: "row_2", denied: false },
  { key: "row_3", denied: false },
  { key: "row_4", denied: false },
  { key: "row_5", denied: false },
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
    <>
      <MarketingHeader />

      <main id="main">
        <Section>
          <SectionHeader
            label={t("security:matrix_heading")}
            title={t("security:h1")}
            lede={t("security:intro")}
          />

          <div className="mt-10">
            <Table
              caption={t("security:matrix_heading")}
              head={
                <tr>
                  <Th>{t("security:th_scope")}</Th>
                  <Th>{t("security:th_access")}</Th>
                  <Th>{t("security:th_status")}</Th>
                  <Th>{t("security:th_purpose")}</Th>
                  <Th>{t("security:th_stored")}</Th>
                </tr>
              }
            >
              {PERMISSIONS_MATRIX.map((p) => (
                <tr key={p.key} className="transition-colors duration-fast hover:bg-ink-900/60">
                  <Th scope="row">{t(`security:${p.key}_scope`)}</Th>
                  <Td className="font-mono text-xs">{t(`security:${p.key}_access`)}</Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                        p.denied
                          ? "border-signal-500/30 bg-signal-500/10 text-signal-400"
                          : "border-brand-400/30 bg-brand-500/10 text-brand-300"
                      }`}
                    >
                      {t(`security:${p.key}_status`)}
                    </span>
                  </Td>
                  <Td>{t(`security:${p.key}_purpose`)}</Td>
                  <Td>{t(`security:${p.key}_stored`)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Section>

        <Section className="border-t border-hairline">
          <div className="grid gap-4 md:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div key={p.titleKey} className="rounded-feature border border-hairline bg-ink-900/50 p-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-brand-300">
                  <p.icon className="h-4 w-4" />
                  <h2 className="text-base font-semibold text-ink-50">{t(p.titleKey)}</h2>
                </div>
                <p className="mt-3 max-w-measure text-sm leading-reading text-ink-300">
                  {t(p.bodyKey)}
                </p>
                {p.code.length > 0 ? (
                  // The literals are API identifiers (headers, cookie attributes),
                  // not prose, so they stay untranslated and are listed for
                  // reference only.
                  <p className="mt-3 font-mono text-[11px] text-ink-500">{p.code.join(", ")}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-6 rounded-panel border border-hairline bg-ink-900/40 p-8">
            <div>
              <h2 className="text-base font-semibold text-ink-50">{t("security:cta_title")}</h2>
              <p className="mt-1 max-w-measure text-sm text-ink-400">{t("security:cta_body")}</p>
              <a
                href={`mailto:${DISCLOSURE_EMAIL}`}
                className="mt-2 inline-block font-mono text-xs text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                {DISCLOSURE_EMAIL}
              </a>
            </div>
            <Button href="/pricing" variant="secondary" arrow>
              {t("security:cta_action")}
            </Button>
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
