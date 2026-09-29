import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { config } from "@/lib/env-boot";
import {
  IconActivity,
  IconArrowRight,
  IconBell,
  IconBranch,
  IconCheck,
  IconGauge,
  IconLayers,
  IconShield,
  IconGitHub,
  IconZap,
  IconLock,
  IconAlertCircle,
} from "@/components/icons";
import { PrSimulator } from "@/components/pr-simulator";
import { StateMatrix } from "@/components/state-matrix";
import { RoiCalculator } from "@/components/roi-calculator";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";

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

/** Numeric headline + two lines of copy. The number itself is data, not copy. */
const STATS = [
  { value: "89%", labelKey: "marketing:stat_waiting_label", detailKey: "marketing:stat_waiting_detail" },
  {
    value: "2-6 days",
    labelKey: "marketing:stat_first_review_label",
    detailKey: "marketing:stat_first_review_detail",
  },
  { value: "0", labelKey: "marketing:stat_stored_label", detailKey: "marketing:stat_stored_detail" },
  {
    value: "100%",
    labelKey: "marketing:stat_engine_label",
    detailKey: "marketing:stat_engine_detail",
  },
];

/** `marketing:feature_*` pairs, in the order the grid renders them. */
const FEATURES = [
  { icon: IconBranch, titleKey: "marketing:feature_status_card_title", bodyKey: "marketing:feature_status_card_body" },
  { icon: IconLayers, titleKey: "marketing:feature_labels_title", bodyKey: "marketing:feature_labels_body" },
  { icon: IconBell, titleKey: "marketing:feature_nudges_title", bodyKey: "marketing:feature_nudges_body" },
  { icon: IconActivity, titleKey: "marketing:feature_engine_title", bodyKey: "marketing:feature_engine_body" },
  { icon: IconGauge, titleKey: "marketing:feature_move_title", bodyKey: "marketing:feature_move_body" },
  { icon: IconLayers, titleKey: "marketing:feature_intelligence_title", bodyKey: "marketing:feature_intelligence_body" },
  { icon: IconShield, titleKey: "marketing:feature_permissions_title", bodyKey: "marketing:feature_permissions_body" },
];

/** Comparison rows: a dimension plus one cell per competing approach. */
const COMPARISONS = [
  {
    dimensionKey: "marketing:compare_row_1",
    batonKey: "marketing:compare_row_1_baton",
    botsKey: "marketing:compare_row_1_bots",
    slackKey: "marketing:compare_row_1_slack",
  },
  {
    dimensionKey: "marketing:compare_row_2",
    batonKey: "marketing:compare_row_2_baton",
    botsKey: "marketing:compare_row_2_bots",
    slackKey: "marketing:compare_row_2_slack",
  },
  {
    dimensionKey: "marketing:compare_row_3",
    batonKey: "marketing:compare_row_3_baton",
    botsKey: "marketing:compare_row_3_bots",
    slackKey: "marketing:compare_row_3_slack",
  },
  {
    dimensionKey: "marketing:compare_row_4",
    batonKey: "marketing:compare_row_4_baton",
    botsKey: "marketing:compare_row_4_bots",
    slackKey: "marketing:compare_row_4_slack",
  },
];

const STEPS = [
  { step: "01", titleKey: "marketing:how_step_1_title", descKey: "marketing:how_step_1_body", badgeKey: "marketing:how_step_1_badge" },
  { step: "02", titleKey: "marketing:how_step_2_title", descKey: "marketing:how_step_2_body", badgeKey: "marketing:how_step_2_badge" },
  { step: "03", titleKey: "marketing:how_step_3_title", descKey: "marketing:how_step_3_body", badgeKey: "marketing:how_step_3_badge" },
];

const PERMISSIONS = [
  "marketing:security_perm_1",
  "marketing:security_perm_2",
  "marketing:security_perm_3",
  "marketing:security_perm_4",
  "marketing:security_perm_5",
  "marketing:security_perm_6",
  "marketing:security_perm_7",
];

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
  const { t } = await getTranslatorForRequest();

  // The `reason` value is an enum produced by the auth callback, mapped onto a
  // stable `marketing:oauth_error_*` key. An unknown reason degrades to the
  // generic failure banner instead of rendering a raw identifier.
  const requestedReason = sp?.reason ? `marketing:oauth_error_${sp.reason}` : null;
  const knownReason = (OAUTH_REASONS as readonly string[]).find(
    (k) => k === requestedReason,
  );
  const reasonMessage = knownReason ? t(knownReason) : null;

  const oauthBanner = sp?.oauth_config
    ? t("marketing:oauth_banner_unconfigured")
    : sp?.oauth_error
      ? reasonMessage ?? t("marketing:oauth_banner_failed")
      : sp?.oauth_denied
        ? t("marketing:oauth_banner_denied")
        : null;

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(t)) }}
      />
      <MarketingHeader />

      {oauthBanner ? (
        <div
          role="alert"
          className="container-page flex items-start justify-between gap-4 rounded-b-xl border border-warn-500/30 border-t-0 bg-warn-500/10 px-4 py-3 text-xs text-warn-200"
        >
          <span>{oauthBanner}</span>
          <IconAlertCircle className="h-4 w-4 shrink-0 text-warn-300" aria-hidden="true" />
        </div>
      ) : null}

      {/* Hero Section */}
      <section className="border-b border-white/[0.06] pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="container-wide">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1 text-xs font-medium text-brand-300">
              <span className="flex h-2 w-2 rounded-full bg-signal-500" />
              <span>{t("marketing:hero_badge_app")}</span>
              <span className="text-brand-400/50">·</span>
              <span className="text-ink-300">{t("marketing:hero_badge_license")}</span>
            </div>

            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl sm:leading-[1.1]">
              {t("marketing:hero_title_lead")}{" "}
              <span className="text-brand-300">{t("marketing:hero_title_accent")}</span>
            </h1>

            <p className="mt-6 text-base text-ink-300 sm:text-lg leading-relaxed max-w-2xl mx-auto">
              {t("marketing:hero_subtitle")}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/install" className="btn btn-primary btn-lg">
                <IconGitHub className="h-4 w-4" />
                {t("marketing:hero_cta_install")}
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <a href="#simulator" className="btn btn-ghost btn-lg">
                <IconZap className="h-4 w-4 text-brand-400" />
                {t("marketing:hero_cta_simulator")}
              </a>
              <Link href="/docs" className="btn btn-secondary btn-lg">
                {t("marketing:hero_cta_docs")}
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-400">
              {[
                "marketing:hero_trust_no_code",
                "marketing:hero_trust_install",
                "marketing:hero_trust_free",
              ].map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <IconCheck className="h-3.5 w-3.5 text-signal-400" />
                  {t(key)}
                </span>
              ))}
            </div>
          </div>

          <div id="simulator" className="mt-14 max-w-4xl mx-auto">
            <div className="mb-3 flex items-center justify-between gap-3 px-2 text-xs text-ink-400">
              <span className="font-mono uppercase tracking-wider text-[11px] text-brand-300">
                {t("marketing:simulator_label")}
              </span>
              <span>{t("marketing:simulator_hint")}</span>
            </div>
            <PrSimulator />
          </div>
        </div>
      </section>

      {/* Key Numbers */}
      <section className="border-b border-white/[0.06] bg-ink-900/40">
        <div className="container-page py-12">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.value} className="space-y-1">
                <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-mono">
                  {s.value}
                </div>
                <div className="text-xs font-semibold text-ink-200">{t(s.labelKey)}</div>
                <div className="text-[11px] text-ink-500 leading-snug">{t(s.detailKey)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The PR Problem: The Stalled Loop vs The Baton Relay */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:problem_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{t("marketing:problem_subtitle")}</p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="rounded-xl border border-danger-500/20 bg-danger-500/[0.03] p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-danger-500/20 pb-4">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-danger-400">
                {t("marketing:without_title")}
              </span>
              <span className="rounded bg-danger-500/10 px-2 py-0.5 text-xs text-danger-300 font-mono">
                {t("marketing:without_cycle")}
              </span>
            </div>
            <ul className="mt-6 space-y-4 text-xs text-ink-300">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400 font-mono text-[10px]">
                    &times;
                  </span>
                  <div>
                    <strong className="text-white block font-medium">
                      {t(`marketing:without_item_${n}_title`)}
                    </strong>
                    {t(`marketing:without_item_${n}_body`)}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-signal-500/30 bg-signal-500/[0.03] p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-signal-500/20 pb-4">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-signal-400">
                {t("marketing:with_title")}
              </span>
              <span className="rounded bg-signal-500/15 px-2 py-0.5 text-xs text-signal-300 font-mono">
                {t("marketing:with_cycle")}
              </span>
            </div>
            <ul className="mt-6 space-y-4 text-xs text-ink-200">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="flex items-start gap-3">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                  <div>
                    <strong className="text-white block font-medium">
                      {t(`marketing:with_item_${n}_title`)}
                    </strong>
                    {t(`marketing:with_item_${n}_body`)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* How it Works: 3 Deterministic Steps */}
      <section id="how-it-works" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:how_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{t("marketing:how_subtitle")}</p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((item) => (
            <div
              key={item.step}
              className="relative rounded-xl border border-white/[0.08] bg-ink-900/60 p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-bold text-brand-400">{item.step}</span>
                <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-ink-400">
                  {t(item.badgeKey)}
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-white">{t(item.titleKey)}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{t(item.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* State Engine Interactive Matrix */}
      <section id="states" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:states_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{t("marketing:states_subtitle")}</p>
        </div>

        <StateMatrix />
      </section>

      {/* Feature Grid */}
      <section id="features" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:features_title")}
          </h2>
          <p className="mt-4 text-sm text-ink-300">{t("marketing:features_subtitle")}</p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.titleKey}
              className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6 transition-all hover:border-white/[0.14] hover:bg-ink-850/70"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-white">{t(f.titleKey)}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{t(f.bodyKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Wait Calculator */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:roi_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{t("marketing:roi_subtitle")}</p>
        </div>

        <RoiCalculator />
      </section>

      {/* Comparison Grid */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            {t("marketing:compare_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{t("marketing:compare_subtitle")}</p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-ink-900/80 font-mono uppercase text-[11px] text-ink-400">
                <th scope="col" className="py-4 ps-6 pe-4 font-semibold">
                  {t("marketing:compare_capability")}
                </th>
                <th scope="col" className="py-4 px-4 font-semibold text-brand-300">
                  {t("marketing:compare_baton")}
                </th>
                <th scope="col" className="py-4 px-4 font-semibold">
                  {t("marketing:compare_bots")}
                </th>
                <th scope="col" className="py-4 pe-6 ps-4 font-semibold">
                  {t("marketing:compare_slack")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] bg-ink-950/40">
              {COMPARISONS.map((row) => (
                <tr key={row.dimensionKey}>
                  <th scope="row" className="py-4 ps-6 pe-4 text-start font-semibold text-white">
                    {t(row.dimensionKey)}
                  </th>
                  <td className="py-4 px-4 font-medium text-brand-200 bg-brand-500/[0.03]">
                    {t(row.batonKey)}
                  </td>
                  <td className="py-4 px-4 text-ink-400">{t(row.botsKey)}</td>
                  <td className="py-4 pe-6 ps-4 text-ink-400">{t(row.slackKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security Guarantee Strip */}
      <section className="container-page py-20 md:py-24">
        <div className="rounded-2xl border border-white/[0.1] bg-ink-900 p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.4fr_auto] items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase text-signal-400">
                <IconLock className="h-4 w-4" />
                {t("marketing:security_eyebrow")}
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
                {t("marketing:security_title")}
              </h2>
              <p className="mt-3 text-xs leading-relaxed text-ink-300 max-w-2xl">
                {t("marketing:security_body")}
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {PERMISSIONS.map((key) => (
                  <span
                    key={key}
                    className="rounded-md border border-white/[0.08] bg-ink-950 px-2.5 py-1 font-mono text-[11px] text-ink-300"
                  >
                    {t(key)}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <Link href="/security" className="btn btn-ghost">
                {t("marketing:security_cta")}
                <IconArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final Call to Action */}
      <section className="border-t border-white/[0.06] bg-ink-900 py-24">
        <div className="container-page text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            {t("marketing:final_title")}
          </h2>
          <p className="mt-4 max-w-xl mx-auto text-sm text-ink-300 leading-relaxed">
            {t("marketing:final_subtitle")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/install" className="btn btn-primary btn-lg">
              <IconGitHub className="h-4 w-4" />
              {t("marketing:hero_cta_install")}
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="btn btn-ghost btn-lg">
              {t("marketing:final_cta_pricing")}
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] text-ink-500">{t("marketing:final_fine_print")}</p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
