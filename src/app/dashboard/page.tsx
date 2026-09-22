import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import {
  yourMove,
  myInstallations,
  recentActivity,
  type ActivityItem,
} from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { Duration, EmptyState, StateBadge, Badge } from "@/components/ui";
import {
  IconArrowRight,
  IconGitPullRequest,
  IconCheckCircle,
  IconBranch,
  IconActivity,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex items-start gap-3 px-6 py-3.5 transition-colors hover:bg-white/[0.02]">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-brand-300">
        {item.type === "nudge" ? <IconActivity className="h-3.5 w-3.5" /> : <IconGitPullRequest className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-200">{item.description}</p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-400">
          {item.owner}/{item.repo}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-ink-500">
        <Duration hours={(Date.now() - item.createdAt.getTime()) / 3_600_000} />
        {" "}ago
      </span>
    </li>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ installed?: string; plan?: string; billing?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const user = await currentUser();
  if (!user) return null;
  const [items, installations, recent] = await Promise.all([
    yourMove(user),
    myInstallations(user),
    recentActivity(user, 4),
  ]);
  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const stalled = items.filter((p) => p.hoursInState >= 24).length;

  const plan = resolvedParams?.plan === "team" ? "team" : null;
  const billing = resolvedParams?.billing === "annual" ? "annual" : "monthly";
  const displayName = user.name?.trim() || user.login;

  return (
    <div className="space-y-8">
      {resolvedParams?.installed ? (
        <div className="flex items-center gap-3 rounded-xl border border-signal-500/30 bg-signal-500/10 p-4 text-xs text-signal-300" role="status">
          <IconCheckCircle className="h-5 w-5 shrink-0 text-signal-400" />
          <span>
            Baton GitHub App was successfully installed! Your tracked repositories and open pull
            requests are listed below.
          </span>
        </div>
      ) : null}
      {plan ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 text-xs text-brand-200">
          <span>
            Team plan selected: 14-day free trial, billed{" "}
            {billing === "annual" ? "annually at $8/user/month" : "monthly at $10/user/month"}. Invoicing
            is handled after your install completes.
          </span>
          <Link href="/pricing" className="btn btn-ghost btn-sm">
            Change selection
          </Link>
        </div>
      ) : null}

      {/* Page header */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{greeting()}, {displayName}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Your Move Queue
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            {installations.length === 0
              ? "Connect a GitHub repository to start tracking pull requests."
              : items.length === 0
                ? "All clear. Every PR across your tracked repositories is moving."
                : `${items.length} open PR${items.length === 1 ? "" : "s"} across ${repoCount} repos · ${stalled} stalled past 24h`}
          </p>
        </div>
        <a
          href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
          className="btn btn-ghost btn-sm"
          target="_blank"
          rel="noreferrer"
        >
          + Track Another Repo
        </a>
      </section>

      {/* Getting started: no installations yet */}
      {installations.length === 0 ? (
        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              Get Baton running on your repositories
            </span>
          </div>
          <div className="grid gap-6 p-6 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-300">
                <IconBranch className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-white">1. Install the GitHub App</h2>
              <p className="text-xs leading-relaxed text-ink-400">
                Signing in with GitHub only creates your Baton account. To see repositories and PR
                state, install the Baton GitHub App on the repositories you want to track. Baton
                reads PR metadata only — never your code.
              </p>
              <a
                href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary btn-sm"
              >
                Install on GitHub
                <IconArrowRight className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-3 border-t border-white/[0.06] pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-ink-900 text-ink-300">
                <IconActivity className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-white">2. Watch the state flow in</h2>
              <p className="text-xs leading-relaxed text-ink-400">
                As Baton processes PR events, open pull requests appear in your queue grouped by
                who needs to act, and recent workload shows up under Activity. Repos and their nudge
                thresholds are configurable under Repositories.
              </p>
              <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
                Repositories
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Metrics Row (only meaningful once repos are connected) */}
      {installations.length > 0 ? (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Repos Tracked", value: repoCount, tone: "text-white" },
            { label: "Open Pull Requests", value: items.length, tone: "text-white" },
            {
              label: "Stalled 24h+",
              value: stalled,
              tone: stalled > 0 ? "text-warn-300" : "text-signal-400",
            },
            {
              label: "Waiting on Reviewers",
              value: items.filter((p) => p.whoseTurn === "Reviewers").length,
              tone: "text-brand-300",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
              <p className={`text-3xl font-extrabold tabular-nums tracking-tight font-mono ${s.tone}`}>
                {s.value}
              </p>
              <p className="mt-1.5 text-xs font-medium text-ink-400">{s.label}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* PR Queue */}
      {installations.length === 0 ? (
        <EmptyState
          title="Nothing blocked, nothing to show yet"
          hint="Once Baton is installed on a repository, open PRs requiring review or author action will appear here ordered by wait time."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="All clear, nothing blocked on you"
          hint="When open PRs require review or author action they will appear here ordered by how long they have been waiting."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-3 text-[11px] font-mono uppercase text-ink-400">
            Open PR Queue (Sorted by Wait Time)
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {items.map((p) => (
              <li key={p.prId} className="transition-colors hover:bg-white/[0.02]">
                <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-brand-300">
                      <IconGitPullRequest className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                        >
                          {p.title}
                        </a>
                        <span className="font-mono text-xs text-ink-400">#{p.number}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-400">
                        <span className="font-mono text-ink-300">
                          {p.owner}/{p.repo}
                        </span>{" "}
                        by @{p.authorLogin} · waiting{" "}
                        <span className="font-mono font-bold text-white">
                          <Duration hours={p.hoursInState} />
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <StateBadge state={p.state} />
                    <Badge tone="neutral">Turn: {p.whoseTurn}</Badge>
                    <Link href={`/dashboard/repos/${p.owner}/${p.repo}`} className="btn btn-ghost btn-sm">
                      Repo Board
                      <IconArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent activity preview */}
      {recent.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-6 py-3">
            <span className="text-[11px] font-mono uppercase text-ink-400">Recent Baton activity</span>
            <Link href="/dashboard/activity" className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200">
              View all
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