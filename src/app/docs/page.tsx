import type { Metadata } from "next";
import { config } from "@/lib/env-boot";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import {
  IconCheckCircle,
  IconShield,
  IconActivity,
  IconTerminal,
  IconGitHub,
  IconBell,
} from "@/components/icons";
import { GITHUB_CLONE_URL } from "@/lib/site";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { STATE_META, type BatonState } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslatorForRequest();
  return {
    alternates: { canonical: "/docs" },
    title: t("docs:meta_title"),
    description: t("docs:meta_description"),
  };
}

const DOC_SECTIONS = [
  {
    id: "installation",
    titleKey: "docs:sec_installation_title",
    badgeKey: "docs:sec_installation_badge",
    descKey: "docs:sec_installation_desc",
  },
  {
    id: "states",
    titleKey: "docs:sec_states_title",
    badgeKey: "docs:sec_states_badge",
    descKey: "docs:sec_states_desc",
  },
  {
    id: "thresholds",
    titleKey: "docs:sec_thresholds_title",
    badgeKey: "docs:sec_thresholds_badge",
    descKey: "docs:sec_thresholds_desc",
  },
  {
    id: "architecture",
    titleKey: "docs:sec_architecture_title",
    badgeKey: "docs:sec_architecture_badge",
    descKey: "docs:sec_architecture_desc",
  },
  {
    id: "self-host",
    titleKey: "docs:sec_self_host_title",
    badgeKey: "docs:sec_self_host_badge",
    descKey: "docs:sec_self_host_desc",
  },
] as const;

const INSTALL_STEPS = [
  { key: "s1_step_1", descKey: "docs:s1_step_1_desc" },
  { key: "s1_step_2", descKey: "docs:s1_step_2_desc" },
  { key: "s1_step_3", descKey: "docs:s1_step_3_desc" },
] as const;

const PIPELINE_STEPS = [
  "docs:s4_step_1",
  "docs:s4_step_2",
  "docs:s4_step_3",
  "docs:s4_step_4",
  "docs:s4_step_5",
] as const;

const POLICY_CARDS = [
  { titleKey: "docs:s3_card_1_title", descKey: "docs:s3_card_1_desc" },
  { titleKey: "docs:s3_card_2_title", descKey: "docs:s3_card_2_desc" },
  { titleKey: "docs:s3_card_3_title", descKey: "docs:s3_card_3_desc" },
  { titleKey: "docs:s3_card_4_title", descKey: "docs:s3_card_4_desc" },
] as const;

/**
 * The eight states Baton classifies an open PR into.
 *
 * The label and the trigger condition are read from `STATE_META` and the
 * `marketing:matrix_*` prose rather than restated here. The previous version
 * duplicated both, and had already drifted: it advertised a
 * `baton:checks-pending` label the engine never creates and called the conflicts
 * state "Conflicts" when the product calls it "Merge conflicts".
 */
const STATES_TABLE: { state: BatonState; turnKey: string }[] = [
  { state: "draft", turnKey: "marketing:states_owner_none" },
  { state: "awaiting_review", turnKey: "marketing:states_owner_reviewers" },
  { state: "awaiting_review_after_fix", turnKey: "marketing:states_owner_reviewers" },
  { state: "changes_required", turnKey: "marketing:states_owner_author" },
  { state: "ci_failing", turnKey: "marketing:states_owner_author" },
  { state: "blocked_on_checks", turnKey: "marketing:states_owner_none" },
  { state: "conflicts", turnKey: "marketing:states_owner_author" },
  { state: "ready_to_merge", turnKey: "docs:s2_turn_author_maintainer" },
];

/**
 * Renders the `**bold**` and `` `code` `` markup used inside the pipeline
 * step strings, so translators can format their own sentences.
 */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="text-brand-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default async function DocsPage() {
  const { t } = await getTranslatorForRequest();
  const appInstallUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`;

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            {t("docs:h1")}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300 sm:text-base">{t("docs:intro")}</p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              className="group rounded-xl border border-white/[0.08] bg-ink-900/60 p-4 transition-all hover:border-brand-500/40 hover:bg-ink-850"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white transition-colors group-hover:text-brand-300">
                  {t(sec.titleKey)}
                </span>
                <span className="shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
                  {t(sec.badgeKey)}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{t(sec.descKey)}</p>
            </a>
          ))}
        </div>

        <section id="installation" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-brand-300">
            <IconTerminal className="h-4 w-4" />
            <span>{t("docs:s1_eyebrow")}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{t("docs:s1_h2")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{t("docs:s1_body")}</p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {INSTALL_STEPS.map((s) => (
              <div key={s.key} className="rounded-xl border border-white/[0.08] bg-ink-900/70 p-5">
                <h3 className="text-sm font-bold text-white">{t(`docs:${s.key}`)}</h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{t(s.descKey)}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-white/[0.08] bg-ink-900/90 p-5 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 text-ink-400">
              <span>{t("docs:s1_link_heading")}</span>
              <span className="text-[11px] text-brand-300">{t("docs:s1_link_host")}</span>
            </div>
            <p className="mt-3 text-ink-200">
              {t("docs:s1_link_label")}{" "}
              <a
                href={appInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                {appInstallUrl}
              </a>
            </p>
          </div>
        </section>

        <section id="states" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-brand-300">
            <IconActivity className="h-4 w-4" />
            <span>{t("docs:s2_eyebrow")}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{t("docs:s2_h2")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{t("docs:s2_body")}</p>

          <div className="mt-8 overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/60">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                  <th scope="col" className="py-3.5 ps-6 pe-4 font-semibold">
                    {t("docs:s2_th_state")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 font-semibold text-white">
                    {t("docs:s2_th_turn")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 font-semibold text-brand-300">
                    {t("docs:s2_th_label")}
                  </th>
                  <th scope="col" className="py-3.5 pe-6 ps-4 font-semibold">
                    {t("docs:s2_th_trigger")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {STATES_TABLE.map(({ state, turnKey }) => {
                  const labelName = STATE_META[state].labelName;
                  return (
                    <tr key={state} className="hover:bg-white/[0.02]">
                      <th
                        scope="row"
                        className="py-3.5 ps-6 pe-4 text-start font-bold text-white"
                      >
                        {t(`marketing:matrix_${state}_label`)}
                      </th>
                      <td className="py-3.5 px-4 font-mono text-ink-300">{t(turnKey)}</td>
                      <td className="py-3.5 px-4">
                        {labelName ? (
                          <code className="rounded border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-mono text-[11px] text-brand-300">
                            {labelName}
                          </code>
                        ) : (
                          <span className="font-mono text-[11px] text-ink-500">
                            {t("docs:s2_no_label")}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 pe-6 ps-4 text-ink-400">
                        {t(`marketing:matrix_${state}_trigger`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section id="thresholds" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-brand-300">
            <IconBell className="h-4 w-4" />
            <span>{t("docs:s3_eyebrow")}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{t("docs:s3_h2")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{t("docs:s3_body")}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {POLICY_CARDS.map((card) => (
              <div key={card.titleKey} className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
                <div className="flex items-center gap-2 text-xs font-bold text-brand-300">
                  <IconCheckCircle className="h-4 w-4" />
                  <span>{t(card.titleKey)}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{t(card.descKey)}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="architecture" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-brand-300">
            <IconShield className="h-4 w-4" />
            <span>{t("docs:s4_eyebrow")}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{t("docs:s4_h2")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{t("docs:s4_body")}</p>

          <div className="mt-8 space-y-3 rounded-xl border border-white/[0.08] bg-ink-950 p-6 font-mono text-xs text-ink-300">
            <p className="font-bold text-brand-300">{t("docs:s4_order_heading")}</p>
            <ol className="list-decimal space-y-2 ps-5 text-ink-400">
              {PIPELINE_STEPS.map((key) => (
                <li key={key}>
                  <RichText text={t(key)} />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="self-host" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-brand-300">
            <IconGitHub className="h-4 w-4" />
            <span>{t("docs:s5_eyebrow")}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{t("docs:s5_h2")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{t("docs:s5_body")}</p>

          <div className="mt-6 rounded-xl border border-white/[0.08] bg-ink-900/90 p-5 font-mono text-xs text-ink-200">
            <div className="pb-2 text-ink-500">{t("docs:s5_command_comment")}</div>
            <pre className="overflow-x-auto text-brand-300">
{`git clone ${GITHUB_CLONE_URL}

cd baton
cp .env.example .env
npm install
npm run db:migrate
npm run build && npm run start`}
            </pre>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
