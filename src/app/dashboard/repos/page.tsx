import Link from "next/link";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { currentUser } from "@/lib/auth/session";
import { myInstallations } from "@/lib/queries/dashboard";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { config } from "@/lib/env-boot";
import { REPO_SETTING_DEFAULTS } from "@/lib/engine/thresholds";

function hours(n: number): string {
  return `${n}h`;
}
import { setRepoEnabled, updateRepoSettings, rescanRepo } from "../actions";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { RepoSyncButton } from "@/components/dashboard/repo-sync-button";
import {
  IconBranch,
  IconRefresh,
  IconPlay,
  IconPause,
  IconChevronRight,
  IconChevronDown,
  IconGitHub,
  IconExternalLink,
  IconSliders,
  IconShield,
  IconLock,
} from "@/components/icons";

export const dynamic = "force-dynamic";

/**
 * Threshold rows carry only their key and the `workspace:policy_*` id.
 *
 * The same six states appear here, in the organization policy editor, and in
 * the engine defaults, so the label and hint live in one place rather than
 * being restated per surface. `id` doubles as the `policy_<id>` key suffix.
 */
const THRESHOLDS: { key: keyof typeof REPO_SETTING_DEFAULTS; id: string }[] = [
  { key: "firstResponseHours", id: "first_response" },
  { key: "reviewFollowUpHours", id: "rereview" },
  { key: "changesRequiredHours", id: "changes_required" },
  { key: "ciFailHours", id: "ci_fail" },
  { key: "conflictHours", id: "conflict" },
  { key: "readyToMergeHours", id: "ready_to_merge" },
];

export default async function ReposPage() {
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) return null;

  const [installations, entitlement] = await Promise.all([
    myInstallations(user),
    getEntitlement(user.id),
  ]);
  const repos = installations.flatMap((i) =>
    i.repos.map((r) => ({ ...r, account: i.accountLogin })),
  );

  const activeCount = repos.filter((r) => r.enabled).length;
  const pausedCount = repos.length - activeCount;
  const maxRepos = entitlement.maxRepos;
  const limitReached = maxRepos !== null && activeCount >= maxRepos;
  const canCustomThresholds = hasFeature(entitlement, FEATURE_KEYS.customThresholds);
  const installUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`;

  if (repos.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={t("repos:tracked_repositories")}
          description={t("repos:repos_description")}
        />

        <EmptyState
          icon={IconBranch}
          title={t("repos:no_repos_connected")}
          hint={t("repos:no_repos_connected_hint")}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <RepoSyncButton />
              <a
                href={installUrl}
                className="btn btn-primary btn-sm"
                target="_blank"
                rel="noreferrer"
              >
                <IconGitHub className="h-3.5 w-3.5" />
                <span>{t("repos:install_baton_on_github")}</span>
              </a>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        title={t("repos:list_title")}
        description={t("repos:list_description", {
          count: repos.length,
          accounts: installations.length,
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RepoSyncButton />
            <a
              href={installUrl}
              className="btn btn-primary btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              <span>+ Add Repositories</span>
            </a>
          </div>
        }
      />

      {/* Free Plan Quota Callout */}
      {!entitlement.hasPaidAccess && maxRepos !== null && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-4 text-xs text-ink-300">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 font-mono font-bold text-brand-300 text-xs">
              {activeCount}/{maxRepos}
            </span>
            <div>
              <p className="font-semibold text-white">
                {t("repos:list_free_plan", { active: activeCount, max: maxRepos })}
              </p>
              <p className="text-[11px] text-ink-400">{t("repos:list_free_plan_hint")}</p>
            </div>
          </div>
          <Link href="/dashboard/billing" className="btn btn-secondary btn-sm shrink-0">
            {t("repos:list_upgrade")}
          </Link>
        </div>
      )}

      {/* Summary KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={t("repos:list_stat_total")}
          value={repos.length}
          detail={t("repos:list_stat_total_detail", { count: installations.length })}
          icon={IconBranch}
        />
        <StatCard
          label={t("repos:list_stat_active")}
          value={activeCount}
          detail={t("repos:list_stat_active_detail")}
          tone="signal"
          icon={IconPlay}
        />
        <StatCard
          label={t("repos:list_stat_paused")}
          value={pausedCount}
          detail={pausedCount > 0 ? t("repos:list_stat_paused_warn") : t("repos:list_stat_paused_clear")}
          tone={pausedCount > 0 ? "warn" : "default"}
          icon={IconPause}
        />
        <StatCard
          label={t("repos:list_stat_protection")}
          value={t("repos:list_stat_protection_value")}
          detail={t("repos:list_stat_protection_detail")}
          tone="brand"
          icon={IconShield}
        />
      </section>

      {/* Repository Cards List */}
      <ul className="space-y-5">
        {repos
          .sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
          .map((r) => {
            const githubRepoUrl = `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

            return (
              <li
                key={r.id}
                className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm transition-all duration-200 hover:border-white/[0.14]"
              >
                {/* Repo Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] bg-ink-950/60 p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/dashboard/repos/${r.owner}/${r.name}`}
                        className="font-mono text-base font-bold text-white transition-colors hover:text-brand-300"
                      >
                        {r.owner}/{r.name}
                      </Link>
                      <Badge tone={r.enabled ? "success" : "neutral"}>
                        {t(r.enabled ? "repos:list_tracking" : "repos:list_paused")}
                      </Badge>
                      <span className="rounded border border-white/[0.08] bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                        {t(r.isPrivate ? "repos:list_private" : "repos:list_public")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-400">
                      <span>{t("repos:list_account", { account: r.account })}</span>
                      <span className="text-ink-600">&middot;</span>
                      <span>{t("repos:list_default_branch", { branch: r.defaultBranch })}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={githubRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      title={t("repos:view_repo_on_github")}
                    >
                      <IconGitHub className="h-3.5 w-3.5" />
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                    <Link
                      href={`/dashboard/repos/${r.owner}/${r.name}`}
                      className="btn btn-ghost btn-sm"
                    >
                      <span>{t("repos:repo_board")}</span>
                      <IconChevronRight className="h-3 w-3" />
                    </Link>
                    <form
                      action={async () => {
                        "use server";
                        await setRepoEnabled(r.id, !r.enabled);
                      }}
                    >
                      <button
                        type="submit"
                        disabled={!r.enabled && !entitlement.hasPaidAccess && limitReached}
                        className={`btn btn-ghost btn-sm ${
                          !r.enabled && !entitlement.hasPaidAccess && limitReached
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        title={
                          r.enabled
                            ? "Pause Baton tracking on this repo"
                            : !entitlement.hasPaidAccess && limitReached
                            ? maxRepos !== null
                              ? `Free plan limit reached (${maxRepos} active repos). Upgrade to enable.`
                              : "Upgrade to enable"
                            : "Resume Baton tracking"
                        }
                      >
                        {r.enabled ? (
                          <>
                            <IconPause className="h-3 w-3 text-warn-400" />
                            <span>{t("repos:pause")}</span>
                          </>
                        ) : (
                          <>
                            <IconPlay className="h-3 w-3 text-signal-400" />
                            <span>{t("repos:resume")}</span>
                          </>
                        )}
                      </button>
                    </form>
                    <form
                      action={async () => {
                        "use server";
                        await rescanRepo(`${r.owner}/${r.name}`);
                      }}
                    >
                      <button
                        type="submit"
                        className="btn btn-ghost btn-sm"
                        title={t("repos:sweep_now")}
                      >
                        <IconRefresh className="h-3 w-3" />
                        <span>{t("repos:list_rescan")}</span>
                      </button>
                    </form>
                  </div>
                </div>

                {/* Threshold Summary & Accordion Settings */}
                <div className="p-5">
                  {/* Current Active Threshold Summary Pills */}
                  {r.setting ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] uppercase font-semibold text-ink-500 mr-1">
                        {t("repos:active_thresholds")}
                      </span>
                      {THRESHOLDS.map((field) => (
                        <span
                          key={field.key}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ink-950/60 px-2 py-0.5 font-mono text-[11px] text-ink-300"
                        >
                          <span className="text-ink-400">{t(`workspace:policy_${field.id}`)}:</span>
                          <span className="font-bold text-white">
                            {r.setting?.[field.key] ?? 24}h
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* Collapsible Threshold Tuning Panel */}
                  {r.setting ? (
                    <details className="group mt-4 border-t border-white/[0.06] pt-3">
                      <summary className="flex cursor-pointer items-center justify-between py-1 text-xs font-semibold text-ink-300 transition-colors hover:text-white outline-none select-none">
                        <span className="flex items-center gap-2">
                          <IconSliders className="h-3.5 w-3.5 text-brand-400" />
                          <span>{t("repos:customize_thresholds")}</span>
                          {!canCustomThresholds && (
                            <span className="rounded border border-brand-400/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-mono text-brand-300">
                              {t("repos:team_org_badge")}
                            </span>
                          )}
                        </span>
                        <IconChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" />
                      </summary>

                      <div className="pt-3">
                        {!canCustomThresholds ? (
                          <div className="rounded-lg border border-brand-500/20 bg-brand-500/[0.04] p-4 text-xs">
                            <div className="flex items-center gap-2 font-semibold text-white">
                              <IconLock className="h-3.5 w-3.5 text-brand-400" />
                              <span>{t("repos:thresholds_require_plan")}</span>
                            </div>
                            <p className="mt-1.5 text-xs text-ink-400 leading-relaxed">
                              {t("repos:thresholds_defaults_before")} (
                              {hours(REPO_SETTING_DEFAULTS.firstResponseHours)}{" "}
                              {t("workspace:policy_first_response")},{" "}
                              {hours(REPO_SETTING_DEFAULTS.reviewFollowUpHours)}{" "}
                              {t("workspace:policy_rereview")},{" "}
                              {hours(REPO_SETTING_DEFAULTS.changesRequiredHours)}{" "}
                              {t("workspace:policy_changes_required")}
                              ). {t("repos:thresholds_defaults_after")}
                            </p>
                            <div className="mt-3">
                              <Link href="/dashboard/billing" className="btn btn-secondary btn-sm">
                                {t("repos:list_upgrade")}
                              </Link>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-ink-400 mb-3">
                              {t("repos:thresholds_intro")}
                            </p>

                            <div className="grid gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
                              {THRESHOLDS.map((field) => (
                                <div
                                  key={field.key}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-ink-900/60 px-3 py-2.5"
                                >
                                  <div className="min-w-0 flex-1">
                                    <label
                                      htmlFor={`${r.id}-${field.key}`}
                                      className="block cursor-pointer text-xs font-semibold text-ink-200"
                                    >
                                      {t(`workspace:policy_${field.id}`)}
                                    </label>
                                    <span className="block truncate text-[10px] text-ink-500">
                                      {t(`workspace:policy_${field.id}_hint`)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      id={`${r.id}-${field.key}`}
                                      name={field.key}
                                      form={`settings-${r.id}`}
                                      defaultValue={r.setting?.[field.key] ?? 24}
                                      type="number"
                                      min={1}
                                      max={720}
                                      className="input h-8 w-16 text-right font-mono text-xs"
                                    />
                                    <span className="font-mono text-xs text-ink-500">h</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Form Submit Footer */}
                            <form
                              id={`settings-${r.id}`}
                              action={async (formData) => {
                                "use server";
                                // An empty number input submits "", and `Number("")`
                                // is 0, which fails validation. Fall back to the
                                // built-in default instead of erroring.
                                const int = (k: string) => {
                                  const raw = formData.get(k);
                                  const n = Number(raw);
                                  return raw === null || raw === "" || Number.isNaN(n)
                                    ? REPO_SETTING_DEFAULTS[k as keyof typeof REPO_SETTING_DEFAULTS]
                                    : n;
                                };
                                await updateRepoSettings({
                                  repoId: r.id,
                                  firstResponseHours: int("firstResponseHours"),
                                  reviewFollowUpHours: int("reviewFollowUpHours"),
                                  changesRequiredHours: int("changesRequiredHours"),
                                  ciFailHours: int("ciFailHours"),
                                  conflictHours: int("conflictHours"),
                                  readyToMergeHours: int("readyToMergeHours"),
                                });
                              }}
                              className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3"
                            >
                              <span className="font-mono text-[11px] text-ink-500">
                                Max 1 polite nudge per state transition
                              </span>
                              <button type="submit" className="btn btn-primary btn-sm">
                                Save Thresholds
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}