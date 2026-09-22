import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement } from "@/lib/billing/entitlement";
import {
  yourMove,
  myInstallations,
  recentActivity,
  type ActivityItem,
} from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { Duration, EmptyState, StateBadge, Badge, StatCard, PageHeader } from "@/components/ui";
import {
  IconArrowRight,
  IconGitPullRequest,
  IconCheckCircle,
  IconBranch,
  IconActivity,
  IconClock,
  IconExternalLink,
  IconGitHub,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function ActivityRow({ item }: { item: ActivityItem }) {
  const isNudge = item.type === "nudge";
  const hoursAgo = (Date.now() - item.createdAt.getTime()) / 3_600_000;

  return (
    <li className="flex items-start gap-3.5 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs ${
          isNudge
            ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
            : "border-white/[0.08] bg-ink-850 text-ink-300"
        }`}
      >
        {isNudge ? (
          <IconActivity className="h-3.5 w-3.5" />
        ) : (
          <IconGitPullRequest className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-200">{item.description}</p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-400">
          <Link
            href={`/dashboard/repos/${item.owner}/${item.repo}`}
            className="text-brand-300 transition-colors hover:text-brand-200"
          >
            {item.owner}/{item.repo}
          </Link>
          <span className="text-ink-600"> &middot; </span>
          <span className="text-ink-400">PR #{item.prNumber}</span>
        </p>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-ink-500">
        <Duration hours={hoursAgo} /> ago
      </span>
    </li>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ installed?: string; plan?: string; billing?: string; view?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const user = await currentUser();
  if (!user) return null;

  const [items, installations, recent, entitlement] = await Promise.all([
    yourMove(user),
    myInstallations(user),
    recentActivity(user, 5),
    getEntitlement(user.id),
  ]);

  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const stalled = items.filter((p) => p.hoursInState >= 24).length;
  const waitingReviewers = items.filter((p) => p.whoseTurn === "Reviewers").length;
  const waitingAuthor = items.filter((p) => p.whoseTurn === "Author").length;

  const plan = resolvedParams?.plan === "team" ? "team" : null;
  const billing = resolvedParams?.billing === "annual" ? "annual" : "monthly";
  const activeView = resolvedParams?.view ?? "all";

  // Handle pricing checkout handoff
  if (!entitlement.hasPaidAccess && plan) {
    const teamPlan = entitlement.subscription?.plan;
    redirect(
      teamPlan
        ? `/dashboard/billing/checkout?plan=${teamPlan.id}&billing=${billing}`
        : "/pricing",
    );
  }

  // Filter items based on active view
  let filteredItems = items;
  if (activeView === "stalled") {
    filteredItems = items.filter((p) => p.hoursInState >= 24);
  } else if (activeView === "reviewers") {
    filteredItems = items.filter((p) => p.whoseTurn === "Reviewers");
  } else if (activeView === "author") {
    filteredItems = items.filter((p) => p.whoseTurn === "Author");
  }

  const installUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`;

  return (
    <div className="space-y-8">
      {/* Installation Success Notification */}
      {resolvedParams?.installed ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-signal-500/30 bg-signal-500/10 p-4 text-xs text-signal-300 shadow-sm"
          role="status"
        >
          <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-signal-400" />
          <div className="flex-1">
            <p className="font-semibold text-white">GitHub App connected successfully</p>
            <p className="mt-0.5 text-signal-300/90 leading-relaxed">
              Baton is now listening for pull request lifecycle events and synchronizing repository
              state. Open pull requests will appear in your queue.
            </p>
          </div>
        </div>
      ) : null}

      {/* Plan Status Banner */}
      {entitlement.subscription ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-ink-900/50 px-4 py-3 text-xs text-ink-200">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 rounded-full ${
                entitlement.hasPaidAccess ? "bg-signal-400" : "bg-warn-400"
              }`}
            />
            <span className="font-medium">
              {entitlement.planName} Plan &middot; {entitlement.statusLabel}
            </span>
            {entitlement.subscription.current_period_end ? (
              <span className="font-mono text-[11px] text-ink-500">
                (Renews {new Date(entitlement.subscription.current_period_end).toLocaleDateString()})
              </span>
            ) : null}
          </div>
          <Link
            href="/dashboard/billing"
            className="font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
          >
            <span>Manage subscription</span>
            <IconArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}

      {/* Page Header */}
      <PageHeader
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-signal-400">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
            Live Sync
          </span>
        }
        title="Your Move Queue"
        description={
          installations.length === 0
            ? "Connect your repositories via the Baton GitHub App to begin tracking blockers and stall durations."
            : items.length === 0
            ? "All clear. Every pull request across your tracked repositories is moving with zero blockers."
            : `${items.length} pull request${items.length === 1 ? "" : "s"} awaiting action across ${repoCount} tracked repositor${repoCount === 1 ? "y" : "ies"}.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
              <IconBranch className="h-3.5 w-3.5" />
              <span>Repositories ({repoCount})</span>
            </Link>
            <a
              href={installUrl}
              className="btn btn-primary btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              <span>+ Track Repository</span>
            </a>
          </div>
        }
      />

      {/* Metric Cards (when repositories are connected) */}
      {installations.length > 0 ? (
        <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Tracked Repositories"
            value={repoCount}
            detail={`${installations.length} GitHub account${installations.length === 1 ? "" : "s"}`}
            icon={IconBranch}
          />
          <StatCard
            label="Open PRs in Queue"
            value={items.length}
            detail="Active across all repos"
            tone={items.length > 0 ? "brand" : "default"}
            icon={IconGitPullRequest}
          />
          <StatCard
            label="Stalled (24h+)"
            value={stalled}
            detail={stalled > 0 ? "Exceeds response SLA" : "Zero stalled work"}
            tone={stalled > 0 ? "warn" : "signal"}
            icon={IconClock}
          />
          <StatCard
            label="Waiting on Review"
            value={waitingReviewers}
            detail={`${waitingAuthor} waiting on author fixes`}
            tone={waitingReviewers > 0 ? "brand" : "default"}
            icon={IconActivity}
          />
        </section>
      ) : null}

      {/* Onboarding State: When zero installations exist */}
      {installations.length === 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              Getting Started with Baton
            </span>
          </div>
          <div className="grid gap-6 p-6 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-300">
                <IconBranch className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-white">1. Install the GitHub App</h2>
              <p className="text-xs leading-relaxed text-ink-300">
                To track PR lifecycle events, install the Baton GitHub App on your target repositories.
                Baton requires read-only metadata access to pull requests and never reads or stores your
                source code.
              </p>
              <div className="pt-1">
                <a
                  href={installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  <IconGitHub className="h-3.5 w-3.5" />
                  <span>Install on GitHub</span>
                  <IconArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>

            <div className="space-y-3 border-t border-white/[0.06] pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-ink-900 text-ink-300">
                <IconActivity className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-white">2. Automatic State Classification</h2>
              <p className="text-xs leading-relaxed text-ink-300">
                When pull request events arrive, Baton deterministically evaluates whose turn it is to
                act (Reviewer, Author, or CI), adds a live status card to the PR thread, and orders
                pending items here by wait time.
              </p>
              <div className="pt-1">
                <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
                  <span>View Repositories</span>
                  <IconArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* PR Queue Section */}
      {installations.length > 0 ? (
        <section className="space-y-4">
          {/* Segmented Filter Control */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href="/dashboard?view=all"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === "all"
                    ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                All PRs ({items.length})
              </Link>
              <Link
                href="/dashboard?view=stalled"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === "stalled"
                    ? "bg-warn-500/15 text-warn-300 font-semibold shadow-sm"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                Stalled 24h+ ({stalled})
              </Link>
              <Link
                href="/dashboard?view=reviewers"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === "reviewers"
                    ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                Reviewers ({waitingReviewers})
              </Link>
              <Link
                href="/dashboard?view=author"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === "author"
                    ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                Author ({waitingAuthor})
              </Link>
            </div>

            <span className="font-mono text-[11px] text-ink-500">
              Sorted by wait time &middot; longest first
            </span>
          </div>

          {/* Queue Items */}
          {filteredItems.length === 0 ? (
            <EmptyState
              title={
                activeView === "stalled"
                  ? "No pull requests stalled past 24 hours"
                  : activeView === "reviewers"
                  ? "No PRs currently awaiting reviewer engagement"
                  : activeView === "author"
                  ? "No PRs currently awaiting author updates"
                  : "Queue is clear — zero blocked pull requests"
              }
              hint={
                items.length === 0
                  ? "All tracked pull requests are actively moving without stall conditions."
                  : "No items match your active filter. Select 'All PRs' to view the entire queue."
              }
              action={
                activeView !== "all" ? (
                  <Link href="/dashboard?view=all" className="btn btn-ghost btn-sm">
                    View all pull requests
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
              <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                  {filteredItems.length} Pull Request{filteredItems.length === 1 ? "" : "s"} Requiring Action
                </span>
                <span className="font-mono text-[11px] text-ink-500">
                  {stalled} flagged stalled
                </span>
              </div>
              <ul className="divide-y divide-white/[0.05]">
                {filteredItems.map((p) => {
                  const isStalled = p.hoursInState >= 24;
                  return (
                    <li key={p.prId} className="transition-colors hover:bg-white/[0.02]">
                      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          <span
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs ${
                              isStalled
                                ? "border-warn-400/30 bg-warn-500/10 text-warn-300"
                                : "border-brand-500/30 bg-brand-500/10 text-brand-300"
                            }`}
                          >
                            <IconGitPullRequest className="h-4 w-4" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                              >
                                {p.title}
                              </a>
                              <span className="font-mono text-xs text-ink-500">#{p.number}</span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
                              <Link
                                href={`/dashboard/repos/${p.owner}/${p.repo}`}
                                className="font-mono font-medium text-brand-300 transition-colors hover:text-brand-200"
                              >
                                {p.owner}/{p.repo}
                              </Link>
                              <span className="text-ink-600">&middot;</span>
                              <span>by @{p.authorLogin}</span>
                              <span className="text-ink-600">&middot;</span>
                              <span className="flex items-center gap-1 font-mono text-[11px]">
                                <IconClock className="h-3 w-3 text-ink-500" />
                                <span className={isStalled ? "font-bold text-warn-300" : "text-ink-300"}>
                                  <Duration hours={p.hoursInState} />
                                </span>
                                {isStalled ? (
                                  <span className="text-warn-400 font-semibold">(stalled)</span>
                                ) : null}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                          <StateBadge state={p.state} />
                          <Badge tone={p.whoseTurn === "Reviewers" ? "info" : "warn"}>
                            Turn: {p.whoseTurn}
                          </Badge>
                          <Link
                            href={`/dashboard/repos/${p.owner}/${p.repo}`}
                            className="btn btn-ghost btn-sm"
                            title={`View ${p.owner}/${p.repo} Board`}
                          >
                            <span>Repo Board</span>
                            <IconArrowRight className="h-3 w-3" />
                          </Link>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Open PR #${p.number} on GitHub`}
                          >
                            <IconExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      {/* Recent Activity Ledger Preview */}
      {recent.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Recent Baton Actions
            </span>
            <Link
              href="/dashboard/activity"
              className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
            >
              <span>View complete ledger</span>
              <IconArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {recent.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}