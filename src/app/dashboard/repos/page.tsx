import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { myInstallations } from "@/lib/queries/dashboard";
import { getEntitlement } from "@/lib/billing/entitlement";
import { config } from "@/lib/env-boot";
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

const THRESHOLDS = [
  {
    key: "firstResponseHours" as const,
    label: "First Response",
    hint: "Initial reviewer response timeout",
  },
  {
    key: "reviewFollowUpHours" as const,
    label: "Re-review",
    hint: "Author committed changes, waiting on reviewer",
  },
  {
    key: "changesRequiredHours" as const,
    label: "Changes Required",
    hint: "Reviewer requested changes, waiting on author",
  },
  {
    key: "ciFailHours" as const,
    label: "CI Failing",
    hint: "Build or test check suite failing",
  },
  {
    key: "conflictHours" as const,
    label: "Merge Conflicts",
    hint: "Branch has merge conflicts with base",
  },
  {
    key: "readyToMergeHours" as const,
    label: "Ready to Merge",
    hint: "Approved and checks passing, waiting to merge",
  },
];

export default async function ReposPage() {
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
  const installUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`;

  if (repos.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Tracked Repositories"
          description="Configure Baton monitoring and polite review stall nudge thresholds per repository."
        />

        <EmptyState
          icon={IconBranch}
          title="No repositories connected"
          hint="Install the Baton GitHub App on your GitHub accounts or sync existing installations to begin monitoring."
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
                <span>Install Baton on GitHub</span>
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
        title="Tracked Repositories"
        description={`${repos.length} repositor${repos.length === 1 ? "y" : "ies"} monitored across ${installations.length} GitHub account${installations.length === 1 ? "" : "s"}.`}
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
      {!entitlement.hasPaidAccess && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-4 text-xs text-ink-300">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 font-mono font-bold text-brand-300 text-xs">
              {activeCount}/3
            </span>
            <div>
              <p className="font-semibold text-white">Free Plan: {activeCount} of 3 active repositories tracked</p>
              <p className="text-[11px] text-ink-400">
                Upgrade to Team or Organization for unlimited repositories and fully customizable stall thresholds.
              </p>
            </div>
          </div>
          <Link href="/dashboard/billing" className="btn btn-secondary btn-sm shrink-0">
            Upgrade Plan
          </Link>
        </div>
      )}

      {/* Summary KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Repositories"
          value={repos.length}
          detail={`Across ${installations.length} installation${installations.length === 1 ? "" : "s"}`}
          icon={IconBranch}
        />
        <StatCard
          label="Active Tracking"
          value={activeCount}
          detail="Webhooks active & nudges enabled"
          tone="signal"
          icon={IconPlay}
        />
        <StatCard
          label="Paused Repositories"
          value={pausedCount}
          detail={pausedCount > 0 ? "Temporarily halted" : "Zero paused repos"}
          tone={pausedCount > 0 ? "warn" : "default"}
          icon={IconPause}
        />
        <StatCard
          label="Nudge Protection"
          value="Active"
          detail="Targeted @mentions on stall"
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
                        {r.enabled ? "tracking" : "paused"}
                      </Badge>
                      <span className="rounded border border-white/[0.08] bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                        {r.isPrivate ? "private" : "public"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-400">
                      <span>Account: @{r.account}</span>
                      <span className="text-ink-600">&middot;</span>
                      <span>Default branch: {r.defaultBranch}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={githubRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      title="View repository on GitHub"
                    >
                      <IconGitHub className="h-3.5 w-3.5" />
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                    <Link
                      href={`/dashboard/repos/${r.owner}/${r.name}`}
                      className="btn btn-ghost btn-sm"
                    >
                      <span>Repo Board</span>
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
                        disabled={!r.enabled && !entitlement.hasPaidAccess && activeCount >= 3}
                        className={`btn btn-ghost btn-sm ${
                          !r.enabled && !entitlement.hasPaidAccess && activeCount >= 3
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        title={
                          r.enabled
                            ? "Pause Baton tracking on this repo"
                            : !entitlement.hasPaidAccess && activeCount >= 3
                            ? "Free plan limit reached (3 active repos). Upgrade to enable."
                            : "Resume Baton tracking"
                        }
                      >
                        {r.enabled ? (
                          <>
                            <IconPause className="h-3 w-3 text-warn-400" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <IconPlay className="h-3 w-3 text-signal-400" />
                            <span>Resume</span>
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
                        title="Trigger an immediate full sweep of this repo's pull requests"
                      >
                        <IconRefresh className="h-3 w-3" />
                        <span>Re-scan</span>
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
                        Active Thresholds:
                      </span>
                      {THRESHOLDS.map((t) => (
                        <span
                          key={t.key}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ink-950/60 px-2 py-0.5 font-mono text-[11px] text-ink-300"
                        >
                          <span className="text-ink-400">{t.label}:</span>
                          <span className="font-bold text-white">{r.setting?.[t.key] ?? 24}h</span>
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
                          <span>Customize Inactivity Thresholds (Hours)</span>
                          {!entitlement.hasPaidAccess && (
                            <span className="rounded border border-brand-400/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-mono text-brand-300">
                              Team &amp; Org
                            </span>
                          )}
                        </span>
                        <IconChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" />
                      </summary>

                      <div className="pt-3">
                        {!entitlement.hasPaidAccess ? (
                          <div className="rounded-lg border border-brand-500/20 bg-brand-500/[0.04] p-4 text-xs">
                            <div className="flex items-center gap-2 font-semibold text-white">
                              <IconLock className="h-3.5 w-3.5 text-brand-400" />
                              <span>Custom thresholds require a Team or Organization plan</span>
                            </div>
                            <p className="mt-1.5 text-xs text-ink-400 leading-relaxed">
                              This repository currently uses Baton&apos;s standard defaults (24h first response, 48h re-review). Upgrade your plan to adjust hours per state or configure organization-wide review policies.
                            </p>
                            <div className="mt-3">
                              <Link href="/dashboard/billing" className="btn btn-secondary btn-sm">
                                Upgrade Plan
                              </Link>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-ink-400 mb-3">
                              Set the hours of inactivity before Baton automatically leaves a polite @mention
                              nudge in the PR thread.
                            </p>

                            <div className="grid gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
                              {THRESHOLDS.map((t) => (
                                <div
                                  key={t.key}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-ink-900/60 px-3 py-2.5"
                                >
                                  <div className="min-w-0 flex-1">
                                    <label
                                      htmlFor={`${r.id}-${t.key}`}
                                      className="block cursor-pointer text-xs font-semibold text-ink-200"
                                    >
                                      {t.label}
                                    </label>
                                    <span className="block truncate text-[10px] text-ink-500">
                                      {t.hint}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      id={`${r.id}-${t.key}`}
                                      name={t.key}
                                      form={`settings-${r.id}`}
                                      defaultValue={r.setting?.[t.key] ?? 24}
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
                                const int = (k: string) => Number(formData.get(k) ?? 24);
                                await updateRepoSettings({
                                  repoId: r.id,
                                  statusCommentEnabled: true,
                                  labelsEnabled: true,
                                  nudgesEnabled: true,
                                  firstResponseHours: int("firstResponseHours"),
                                  reviewFollowUpHours: int("reviewFollowUpHours"),
                                  changesRequiredHours: int("changesRequiredHours"),
                                  ciFailHours: int("ciFailHours"),
                                  conflictHours: int("conflictHours"),
                                  readyToMergeHours: int("readyToMergeHours"),
                                  maxNudgesPerState: 1,
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