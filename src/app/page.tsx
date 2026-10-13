import Link from "next/link";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { jsonLdScriptContent } from "@/lib/json-ld";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { config } from "@/lib/env-boot";
import { IconAlertCircle } from "@/components/icons";
import { PrSimulator } from "@/components/pr-simulator";
import { StatusCard, type StatusCardModel } from "@/components/marketing/status-card";
import { Section, SectionHeader, Button, LinkWithArrow } from "@/components/marketing/section";
import { Table, Th, Td } from "@/components/marketing/table";
import { Metric } from "@/components/marketing/metric";
import { Tile } from "@/components/marketing/tile";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";

/**
 * The state explorer and the calculator sit well below the fold and are the two
 * heaviest interactive islands, so they are split into their own chunks. Server
 * rendering is kept, so the first paint and the layout are identical and there
 * is no shift when the chunk arrives.
 */
const StateMatrix = dynamic(() => import("@/components/state-matrix").then((m) => m.StateMatrix));
const RoiCalculator = dynamic(() =>
  import("@/components/roi-calculator").then((m) => m.RoiCalculator),
);

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    alternates: { canonical: "/" },
    title: t("marketing:meta_title"),
    description: t("marketing:meta_description"),
  };
}

/**
 * Structured data.
 *
 * The descriptions come from the resource files rather than a hardcoded literal
 * so a crawler reading the JSON-LD sees the same language as the page. It is
 * built per request for that reason and never hoisted to a module constant.
 */
function siteJsonLd(t: (key: string) => string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Baton",
        url: config.SITE_URL,
        description: t("marketing:jsonld_site_description"),
      },
      {
        "@type": "SoftwareApplication",
        name: "Baton",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: config.SITE_URL,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: t("marketing:jsonld_offer_description"),
        },
      },
    ],
  };
}

/**
 * The proof strip. Each figure ships with the place it came from, so no number
 * appears without a source or an explicit "directional" framing.
 */
const STATS: ReadonlyArray<{
  value: string;
  labelKey: string;
  detailKey: string;
  sourceKey: string;
}> = [
  {
    value: "89%",
    labelKey: "marketing:stat_waiting_label",
    detailKey: "marketing:stat_waiting_detail",
    sourceKey: "marketing:stat_waiting_source",
  },
  {
    value: "2 to 6 days",
    labelKey: "marketing:stat_first_review_label",
    detailKey: "marketing:stat_first_review_detail",
    sourceKey: "marketing:stat_first_review_source",
  },
  {
    value: "0",
    labelKey: "marketing:stat_stored_label",
    detailKey: "marketing:stat_stored_detail",
    sourceKey: "marketing:stat_stored_source",
  },
  {
    value: "8 states",
    labelKey: "marketing:stat_engine_label",
    detailKey: "marketing:stat_engine_detail",
    sourceKey: "marketing:stat_engine_source",
  },
];

/** `marketing:feature_*` pairs, in the order the grid renders them. */
const FEATURES: ReadonlyArray<{ titleKey: string; bodyKey: string; span: "default" | "wide" }> = [
  { titleKey: "marketing:feature_status_card_title", bodyKey: "marketing:feature_status_card_body", span: "wide" },
  { titleKey: "marketing:feature_labels_title", bodyKey: "marketing:feature_labels_body", span: "default" },
  { titleKey: "marketing:feature_nudges_title", bodyKey: "marketing:feature_nudges_body", span: "default" },
  { titleKey: "marketing:feature_engine_title", bodyKey: "marketing:feature_engine_body", span: "default" },
  { titleKey: "marketing:feature_move_title", bodyKey: "marketing:feature_move_body", span: "default" },
  { titleKey: "marketing:feature_intelligence_title", bodyKey: "marketing:feature_intelligence_body", span: "wide" },
  { titleKey: "marketing:feature_permissions_title", bodyKey: "marketing:feature_permissions_body", span: "default" },
];

/** Comparison rows: a dimension plus one cell per competing approach. */
const COMPARISONS = [1, 2, 3, 4, 5].map((n) => ({
  dimensionKey: `marketing:compare_row_${n}`,
  batonKey: `marketing:compare_row_${n}_baton`,
  botsKey: `marketing:compare_row_${n}_bots`,
  slackKey: `marketing:compare_row_${n}_slack`,
}));

const STEPS = [
  { step: "01", titleKey: "marketing:how_step_1_title", descKey: "marketing:how_step_1_body", badgeKey: "marketing:how_step_1_badge" },
  { step: "02", titleKey: "marketing:how_step_2_title", descKey: "marketing:how_step_2_body", badgeKey: "marketing:how_step_2_badge" },
  { step: "03", titleKey: "marketing:how_step_3_title", descKey: "marketing:how_step_3_body", badgeKey: "marketing:how_step_3_badge" },
];

const PROBLEM_ROWS = [1, 2, 3, 4].map((n) => ({
  titleKey: `marketing:without_item_${n}_title`,
  bodyKey: `marketing:without_item_${n}_body`,
}));

const RELAY_ROWS = [1, 2, 3, 4].map((n) => ({
  titleKey: `marketing:with_item_${n}_title`,
  bodyKey: `marketing:with_item_${n}_body`,
}));

const SECURITY_ROWS = [1, 2, 3, 4, 5, 6].map((n) => ({
  key: `row_${n}`,
  denied: n === 6,
}));

/**
 * The reasons `/auth/callback` can set, each with its own copy.
 *
 * Listed as full keys rather than a prefix plus a suffix: `t()` on an unknown
 * key degrades to a humanised label, which for an auth failure would read as
 * confident nonsense instead of an honest "something went wrong". Unknown
 * values therefore fall through to the generic banner.
 */
const OAUTH_REASONS = [
  "marketing:oauth_error_exchange_failed",
  "marketing:oauth_error_github_api",
  "marketing:oauth_error_state_mismatch",
  "marketing:oauth_error_iss_mismatch",
  "marketing:oauth_error_server_error",
  "marketing:oauth_error_db_misconfigured",
  "marketing:oauth_error_db_unreachable",
] as const;

/** Demo data for the hero proof card, matching the simulator's first scenario. */
const HERO_PR = {
  repo: "baton/core",
  number: "247",
  title: "feat(billing): idempotent webhook processor",
  branchLine: "feature/idempotent-webhooks into main",
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{
    oauth_config?: string;
    oauth_error?: string;
    oauth_denied?: string;
    reason?: string;
  }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const { t, tc } = await getTranslatorForRequest();

  // The `reason` value is an enum produced by the auth callback, mapped onto a
  // stable `marketing:oauth_error_*` key. An unknown reason degrades to the
  // generic failure banner instead of rendering a raw identifier.
  const requestedReason = sp?.reason ? `marketing:oauth_error_${sp.reason}` : null;
  const knownReason = (OAUTH_REASONS as readonly string[]).find((k) => k === requestedReason);
  const reasonMessage = knownReason ? t(knownReason) : null;

  const oauthBanner = sp?.oauth_config
    ? t("marketing:oauth_banner_unconfigured")
    : sp?.oauth_error
      ? reasonMessage ?? t("marketing:oauth_banner_failed")
      : sp?.oauth_denied
        ? t("marketing:oauth_banner_denied")
        : null;

  const heroModel: StatusCardModel = {
    repo: HERO_PR.repo,
    prNumber: HERO_PR.number,
    title: HERO_PR.title,
    branchLine: HERO_PR.branchLine,
    openedLine: t("marketing:sim_opened_line"),
    stateLabel: t("marketing:matrix_awaiting_review_label"),
    tone: "info",
    ownerLabel: t("marketing:states_owner_reviewers"),
    owner: "@sarah-chen",
    blockedFor: "48h 12m",
    threshold: tc("marketing:sim_threshold_value", REPO_SETTING_DEFAULTS.firstResponseHours),
    checks: t("marketing:sim_1_checks"),
    nextAction: t("marketing:sim_1_next"),
    labelName: "baton:awaiting-review",
    nextHeading: t("marketing:sim_unblocking_label"),
    turnPrefix: t("marketing:turn_prefix"),
    botBadge: t("marketing:sim_bot_badge"),
    pinnedLabel: t("marketing:sim_pinned_status"),
    whoseTurnHeading: t("marketing:sim_whose_turn_heading"),
    checksHeading: t("marketing:sim_ci_checks_heading"),
    thresholdHeading: t("marketing:sim_threshold_heading"),
    footerLeft: t("marketing:sim_footer_left"),
    footerRight: t("marketing:sim_footer_right"),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(siteJsonLd(t)) }}
      />
      <MarketingHeader />

      {oauthBanner ? (
        <div
          role="alert"
          className="container-content flex items-start justify-between gap-4 border-b border-warn-500/30 bg-warn-500/10 px-4 py-3 text-sm text-warn-200"
        >
          <span>{oauthBanner}</span>
          <IconAlertCircle className="h-4 w-4 shrink-0 text-warn-300" aria-hidden="true" />
        </div>
      ) : null}

      <main id="main">
        {/* Hero */}
        <section className="container-content pt-14 pb-section-sm md:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-ink-900/60 px-3 py-1 font-mono text-xs text-ink-300">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
                {t("marketing:hero_badge_app")}
              </p>
              <h1 className="mt-6 text-display-1 text-ink-50">
                {t("marketing:hero_title_lead")}{" "}
                <span className="text-brand-300">{t("marketing:hero_title_accent")}</span>
              </h1>
              <p className="mt-6 max-w-measure text-base leading-reading text-ink-300 sm:text-lg">
                {t("marketing:hero_subtitle")}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button href="/install" size="lg" arrow>
                  {t("marketing:hero_cta_install")}
                </Button>
                <Button href="#simulator" variant="secondary" size="lg">
                  {t("marketing:hero_cta_simulator")}
                </Button>
              </div>

              <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-400">
                {["marketing:hero_trust_no_code", "marketing:hero_trust_install", "marketing:hero_trust_free"].map(
                  (key) => (
                    <li key={key} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
                      {t(key)}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-500">
                {t("marketing:hero_proof_label")}
              </p>
              <StatusCard model={heroModel} className="animate-rise-in" />
            </div>
          </div>
        </section>

        {/* Simulator */}
        <Section id="simulator">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeader label={t("marketing:simulator_label")} title={t("marketing:sim_section_title")} />
            <p className="max-w-measure text-sm text-ink-400">{t("marketing:simulator_hint")}</p>
          </div>
          <div className="mt-8">
            <PrSimulator />
          </div>
        </Section>

        {/* Proof strip */}
        <Section tone="panel">
          <dl className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
            {STATS.map((s) => (
              <Metric
                key={s.labelKey}
                value={s.value}
                label={t(s.labelKey)}
                source={`${t(s.detailKey)} ${t(s.sourceKey)}`}
              />
            ))}
          </dl>
        </Section>

        {/* The problem */}
        <Section>
          <SectionHeader label={t("marketing:problem_eyebrow")} title={t("marketing:problem_title")} lede={t("marketing:problem_subtitle")} />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-feature border border-danger-500/20 bg-danger-500/[0.03] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3 border-b border-danger-500/20 pb-4">
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-danger-400">
                  {t("marketing:without_title")}
                </h3>
                <span className="rounded bg-danger-500/10 px-2 py-0.5 font-mono text-xs text-danger-300">
                  {t("marketing:without_cycle")}
                </span>
              </div>
              <ul className="mt-6 space-y-4 text-sm text-ink-300">
                {PROBLEM_ROWS.map((row) => (
                  <li key={row.titleKey}>
                    <p className="font-medium text-ink-50">{t(row.titleKey)}</p>
                    <p className="mt-0.5">{t(row.bodyKey)}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-feature border border-signal-500/30 bg-signal-500/[0.03] p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3 border-b border-signal-500/20 pb-4">
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-signal-400">
                  {t("marketing:with_title")}
                </h3>
                <span className="rounded bg-signal-500/15 px-2 py-0.5 font-mono text-xs text-signal-300">
                  {t("marketing:with_cycle")}
                </span>
              </div>
              <ul className="mt-6 space-y-4 text-sm text-ink-200">
                {RELAY_ROWS.map((row) => (
                  <li key={row.titleKey}>
                    <p className="font-medium text-ink-50">{t(row.titleKey)}</p>
                    <p className="mt-0.5">{t(row.bodyKey)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* How it works */}
        <Section id="how-it-works">
          <SectionHeader label={t("marketing:nav_how_it_works")} title={t("marketing:how_title")} lede={t("marketing:how_subtitle")} />
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((item) => (
              <li key={item.step} className="rounded-feature border border-hairline bg-ink-900/60 p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="tabular font-mono text-xs font-semibold text-brand-400">{item.step}</span>
                  <span className="rounded border border-hairline bg-ink-950 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                    {t(item.badgeKey)}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-ink-50">{t(item.titleKey)}</h3>
                <p className="mt-2 text-sm leading-reading text-ink-300">{t(item.descKey)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-control border border-hairline bg-ink-900/40 p-4 font-mono text-xs leading-reading text-ink-400">
            {t("marketing:how_note")}
          </p>
        </Section>

        {/* States */}
        <Section id="states">
          <SectionHeader label={t("marketing:nav_state_engine")} title={t("marketing:states_title")} lede={t("marketing:states_subtitle")} />
          <div className="mt-10">
            <StateMatrix />
          </div>
        </Section>

        {/* Features */}
        <Section id="features">
          <SectionHeader label={t("marketing:nav_product")} title={t("marketing:features_title")} lede={t("marketing:features_subtitle")} />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Tile
                key={f.titleKey}
                title={t(f.titleKey)}
                body={t(f.bodyKey)}
                span={f.span}
              />
            ))}
          </div>
        </Section>

        {/* Calculator */}
        <Section>
          <SectionHeader label={t("marketing:roi_inputs_heading")} title={t("marketing:roi_title")} lede={t("marketing:roi_subtitle")} />
          <div className="mt-10">
            <RoiCalculator />
          </div>
        </Section>

        {/* Comparison */}
        <Section>
          <SectionHeader label={t("marketing:compare_eyebrow")} title={t("marketing:compare_title")} lede={t("marketing:compare_subtitle")} />
          <div className="mt-10">
            <Table
              caption={t("marketing:compare_title")}
              head={
                <tr>
                  <Th>{t("marketing:compare_capability")}</Th>
                  <Th className="text-brand-300">{t("marketing:compare_baton")}</Th>
                  <Th>{t("marketing:compare_bots")}</Th>
                  <Th>{t("marketing:compare_slack")}</Th>
                </tr>
              }
            >
              {COMPARISONS.map((row) => (
                <tr key={row.dimensionKey} className="transition-colors duration-fast hover:bg-ink-900/60">
                  <Th scope="row">{t(row.dimensionKey)}</Th>
                  <Td highlight>{t(row.batonKey)}</Td>
                  <Td>{t(row.botsKey)}</Td>
                  <Td>{t(row.slackKey)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Section>

        {/* Security */}
        <Section>
          <SectionHeader label={t("marketing:security_eyebrow")} title={t("marketing:security_title")} lede={t("marketing:security_body")} />
          <div className="mt-10">
            <Table
              caption={t("marketing:security_matrix_caption")}
              head={
                <tr>
                  <Th>{t("marketing:security_col_scope")}</Th>
                  <Th>{t("marketing:security_col_access")}</Th>
                  <Th>{t("marketing:security_col_why")}</Th>
                  <Th>{t("marketing:security_col_stored")}</Th>
                </tr>
              }
            >
              {SECURITY_ROWS.map((row) => (
                <tr key={row.key} className="transition-colors duration-fast hover:bg-ink-900/60">
                  <Th scope="row">{t(`marketing:security_${row.key}_scope`)}</Th>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                        row.denied
                          ? "border-signal-500/30 bg-signal-500/10 text-signal-400"
                          : "border-brand-400/30 bg-brand-500/10 text-brand-300"
                      }`}
                    >
                      {t(`marketing:security_${row.key}_access`)}
                    </span>
                  </Td>
                  <Td>{t(`marketing:security_${row.key}_why`)}</Td>
                  <Td>{t(`marketing:security_${row.key}_stored`)}</Td>
                </tr>
              ))}
            </Table>
            <div className="mt-6">
              <LinkWithArrow href="/security">{t("marketing:security_cta")}</LinkWithArrow>
            </div>
          </div>
        </Section>

        {/* Final CTA */}
        <Section tone="panel">
          <div className="mx-auto max-w-measure text-center">
            <h2 className="text-display-2 text-ink-50">{t("marketing:final_title")}</h2>
            <p className="mx-auto mt-4 max-w-measure text-base leading-reading text-ink-300">
              {t("marketing:final_subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button href="/install" size="lg" arrow>
                {t("marketing:hero_cta_install")}
              </Button>
              <Link href="/pricing" className="inline-flex h-11 items-center justify-center rounded-control px-5 text-sm font-medium text-ink-200 transition-colors duration-fast hover:bg-ink-900/70 hover:text-ink-50">
                {t("marketing:final_cta_pricing")}
              </Link>
            </div>
            <p className="mt-4 font-mono text-[11px] text-ink-500">{t("marketing:final_fine_print")}</p>
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
