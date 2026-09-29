import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { getEntitlement, hasFeature } from "@/lib/billing/entitlement";
import { FEATURE_KEYS } from "@/lib/billing/types";
import { getCrossRepoIntelligence } from "@/lib/intelligence/cross-repo";
import { getPlanById, getPlanBySlug } from "@/lib/billing/plans";
import {
  yourMove,
  myInstallations,
  recentActivity,
  type ActivityItem,
} from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { recentContexts } from "@/lib/intelligence/context";
import { resumeContextAction } from "./actions";
import { EmptyState, Badge, StatCard, PageHeader } from "@/components/ui";
import { Duration, StateBadge } from "@/components/state-badge";
import {
  IconArrowRight,
  IconGitPullRequest,
  IconCheckCircle,
  IconBranch,
  IconActivity,
  IconClock,
  IconExternalLink,
  IconGitHub,
  IconBookmark,
  IconLayers,
  IconAlertCircle,
} from "@/components/icons";

export const dynamic = "force-dynamic";

async function ActivityRow({ item }: { item: ActivityItem }) {
  const { t, formatRelative } = await getTranslatorForRequest();
  const isNudge = item.type === "nudge";

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
          <span className="text-ink-400">{t("repos:pr_number", { number: item.prNumber })}</span>
        </p>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-ink-500">
        {formatRelative(item.createdAt)}
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

  // Server-rendered copy is translated on the server, so the first paint is
  // already in the user's language instead of flashing English.
  const { t, tc, formatNumber, formatDate, formatRelative } = await getTranslatorForRequest();

  const planParam = resolvedParams?.plan;
  const billing = resolvedParams?.billing === "annual" ? "annual" : "monthly";
  const activeView = resolvedParams?.view ?? "all";

  // Pricing/checkout handoff: resolve the selected plan (by slug or id) and
  // route to its real checkout page. The checkout page handles users who are
  // already on the plan or renewing a live USDC subscription, so every
  // sign-in from the pricing page lands on the correct checkout instead of
  // bouncing back to /pricing.
  if (planParam) {
    const plan =
      (await getPlanBySlug(planParam).catch(() => null)) ??
      (await getPlanById(planParam).catch(() => null));
    if (plan && plan.is_active) {
      redirect(`/dashboard/billing/checkout?plan=${plan.id}&billing=${billing}`);
    }
  }

  const [items, installations, recent, entitlement, savedContexts] = await Promise.all([
    yourMove(user),
    myInstallations(user),
    recentActivity(user, 5),
    getEntitlement(user.id),
    recentContexts(user.id, 4),
  ]);

  // Portfolio-level view across every repository the user can see. Gated on
  // repository intelligence for the same reason the per-repository page is.
  const canSeePortfolio = hasFeature(entitlement, FEATURE_KEYS.repoIntelligence);
  const portfolio = canSeePortfolio ? await getCrossRepoIntelligence(user) : null;

  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const stalled = items.filter((p) => p.hoursInState >= 24).length;
  const waitingReviewers = items.filter((p) => p.whoseTurn === "Reviewers").length;
  const waitingAuthor = items.filter((p) => p.whoseTurn === "Author").length;

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
            <p className="font-semibold text-white">{t("dashboard:github_app_connected")}</p>
            <p className="mt-0.5 text-signal-300/90 leading-relaxed">
              {t("dashboard:github_app_connected_body")}
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
                ({t("dashboard:renews_on", { date: formatDate(entitlement.subscription.current_period_end) })})
              </span>
            ) : null}
          </div>
          <Link
            href="/dashboard/billing"
            className="font-semibold text-brand-300 transition-colors hover:text-brand-200 inline-flex items-center gap-1"
          >
            <span>{t("dashboard:manage_subscription")}</span>
            <IconArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}

      {/* Page Header */}
      <PageHeader
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-signal-400">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
            {t("dashboard:live_sync")}
          </span>
        }
        title={t("dashboard:move_queue")}
        description={
          installations.length === 0
            ? t("dashboard:queue_empty_connect")
            : items.length === 0
            ? t("dashboard:queue_empty_clear")
            // Pluralized through the translator so non-English plural categories
            // are correct. Building the sentence with a `count === 1` ternary
            // would hardcode English grammar into every locale.
            : tc("dashboard:queue_action_needed", items.length, { repos: repoCount })
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
              <IconBranch className="h-3.5 w-3.5" />
              <span>{tc("dashboard:repositories_count", repoCount)}</span>
            </Link>
            <a
              href={installUrl}
              className="btn btn-primary btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              <span>{t("dashboard:track_repository")}</span>
            </a>
          </div>
        }
      />

      {/* Metric Cards (when repositories are connected) */}
      {installations.length > 0 ? (
        <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label={t("dashboard:stat_tracked_repositories")}
            value={formatNumber(repoCount)}
            detail={tc("dashboard:stat_github_accounts", installations.length)}
            icon={IconBranch}
          />
          <StatCard
            label={t("dashboard:stat_waiting_on_you")}
            value={formatNumber(items.length)}
            detail={t("dashboard:stat_needs_action")}
            tone={items.length > 0 ? "brand" : "default"}
            icon={IconGitPullRequest}
          />
          <StatCard
            label={t("dashboard:stat_stalled")}
            value={formatNumber(stalled)}
            detail={stalled > 0 ? t("dashboard:stat_sitting_past_day") : t("dashboard:stat_nothing_sitting")}
            tone={stalled > 0 ? "warn" : "signal"}
            icon={IconClock}
          />
          <StatCard
            label={t("dashboard:stat_your_reviews")}
            value={formatNumber(waitingReviewers)}
            detail={tc("dashboard:stat_need_fixes", waitingAuthor)}
            tone={waitingReviewers > 0 ? "brand" : "default"}
            icon={IconActivity}
          />
        </section>
      ) : null}

      {/* Daily Developer Briefing */}
      {installations.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <IconLayers className="h-4 w-4 text-brand-300" />
              <h2 className="text-sm font-semibold text-white">{t("dashboard:daily_briefing")}</h2>
            </div>
            <span className="font-mono text-[10px] text-ink-500">
              {formatDate(new Date(), { weekday: "long", month: "short", day: "numeric" })}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/[0.05] bg-ink-950/40 p-3">
              <span className="text-[10px] font-mono uppercase text-ink-500">{t("dashboard:briefing_action_needed")}</span>
              <p className="text-base font-bold text-white mt-0.5">{tc("dashboard:pr_count", items.length)}</p>
              <p className="text-[11px] text-ink-400 mt-1 leading-normal">
                {waitingReviewers} pending your review, {waitingAuthor} of your own PRs needing updates.
              </p>
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-ink-950/40 p-3">
              <span className="text-[10px] font-mono uppercase text-ink-500">{t("dashboard:briefing_stalled_blockers")}</span>
              <p className={`text-base font-bold mt-0.5 ${stalled > 0 ? "text-warn-300" : "text-signal-400"}`}>
                {tc("dashboard:pr_count", stalled)}
              </p>
              <p className="text-[11px] text-ink-400 mt-1 leading-normal">
                {stalled > 0 ? "PRs sitting in your court past 24 hours. Baton nudges sent." : "Zero stalled work in your court."}
              </p>
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-ink-950/40 p-3">
              <span className="text-[10px] font-mono uppercase text-ink-500">{t("dashboard:briefing_tracked_repositories")}</span>
              <p className="text-base font-bold text-brand-300 mt-0.5">{tc("dashboard:repo_count", repoCount)}</p>
              <p className="text-[11px] text-ink-400 mt-1 leading-normal">
                Connected repositories actively synchronized via GitHub App webhooks.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Portfolio bottlenecks across every repository */}
      {portfolio && portfolio.bottlenecks.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-signal-500/20 bg-signal-500/[0.03]">
          <div className="flex items-center justify-between border-b border-signal-500/20 bg-signal-500/[0.08] px-5 py-3">
            <div className="flex items-center gap-2">
              <IconAlertCircle className="h-4 w-4 text-signal-300" />
              <h2 className="text-sm font-semibold text-white">{t("dashboard:portfolio_bottlenecks")}</h2>
            </div>
            <span className="font-mono text-[10px] text-signal-300">
              {portfolio.totalRepos} repos &middot; {portfolio.totalOpenPrs} open PRs
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {portfolio.bottlenecks.map((b) => (
              <li key={`${b.repo}:${b.issue}`} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">
                    <span className="font-mono text-signal-300">{b.repo}</span>
                    <span className="mx-1.5 text-ink-600">&middot;</span>
                    {b.issue}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{b.recommendation}</p>
                </div>
                <Badge tone={b.severity === "high" ? "danger" : "warn"}>{b.severity}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Preserved Working Contexts */}
      {savedContexts.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-brand-500/20 bg-brand-500/[0.03]">
          <div className="flex items-center justify-between border-b border-brand-500/20 bg-brand-500/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <IconBookmark className="h-4 w-4 text-brand-300" />
              <h2 className="text-sm font-semibold text-white">{t("dashboard:preserved_contexts")}</h2>
            </div>
            <span className="font-mono text-[10px] text-brand-300">
              {savedContexts.length} saved session{savedContexts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {savedContexts.map((ctx) => (
              <div key={ctx.id} className="flex flex-col justify-between rounded-lg border border-white/[0.06] bg-ink-950/60 p-3.5 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <Badge tone="neutral">{ctx.kind.toUpperCase()}</Badge>
                    <span className="font-mono text-[10px] text-ink-500">
                      {formatRelative(ctx.lastUsedAt)}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-white mt-2 truncate">{ctx.label}</p>
                </div>
                <form action={resumeContextAction.bind(null, ctx.id)}>
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm w-full justify-center text-xs text-brand-300 hover:text-white"
                  >
                    <span>{t("dashboard:resume_working")}</span>
                    <IconArrowRight className="h-3 w-3" />
                  </button>
                </form>
              </div>
            ))}
          </div>
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
                  <span>{t("dashboard:install_on_github")}</span>
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
                  <span>{t("dashboard:view_repositories")}</span>
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
                {t("dashboard:all_prs", { count: items.length })}
              </Link>
              <Link
                href="/dashboard?view=stalled"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === "stalled"
                    ? "bg-warn-500/15 text-warn-300 font-semibold shadow-sm"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {t("dashboard:stalled_24h", { count: stalled })}
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
                  : "Queue is clear. Zero blocked pull requests"
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
                  {tc("dashboard:flagged_stalled", stalled)}
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
                            <span>{t("dashboard:repo_board")}</span>
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
              <span>{t("dashboard:view_complete_ledger")}</span>
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