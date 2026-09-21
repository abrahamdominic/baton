import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { yourMove, myInstallations } from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { Duration, EmptyState, StateBadge, Badge } from "@/components/ui";
import { IconArrowRight, IconGitPullRequest, IconCheckCircle } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ installed?: string; plan?: string; billing?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const user = await currentUser();
  if (!user) return null;
  const [items, installations] = await Promise.all([yourMove(user), myInstallations(user)]);
  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const stalled = items.filter((p) => p.hoursInState >= 24).length;

  const plan = resolvedParams?.plan === "team" ? "team" : null;
  const billing = resolvedParams?.billing === "annual" ? "annual" : "monthly";

  return (
    <div className="space-y-10">
      {resolvedParams?.installed ? (
        <div className="flex items-center gap-3 rounded-xl border border-signal-500/30 bg-signal-500/10 p-4 text-xs text-signal-300">
          <IconCheckCircle className="h-5 w-5 text-signal-400 shrink-0" />
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
            {billing === "annual"
              ? "annually at $8/user/month"
              : "monthly at $10/user/month"}
            . Invoicing is handled after your install completes.
          </span>
          <Link href="/pricing" className="btn btn-ghost btn-sm">
            Change selection
          </Link>
        </div>
      ) : null}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Personal Command Center</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Your Move Queue
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            {items.length === 0
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

      {/* Metrics Row */}
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
          <div
            key={s.label}
            className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5"
          >
            <p className={`text-3xl font-extrabold tabular-nums tracking-tight font-mono ${s.tone}`}>
              {s.value}
            </p>
            <p className="mt-1.5 text-xs text-ink-400 font-medium">{s.label}</p>
          </div>
        ))}
      </section>

      {/* PR Queue */}
      {items.length === 0 ? (
        <EmptyState
          title="All clear, nothing blocked on you"
          hint="When you install Baton on repositories, open PRs requiring review or author action will appear here ordered by wait time."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-3 text-[11px] font-mono uppercase text-ink-400">
            Open PR Queue (Sorted by Wait Time)
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {items.map((p) => (
              <li
                key={p.prId}
                className="transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
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
                        <span className="font-mono text-ink-300">{p.owner}/{p.repo}</span> by @{p.authorLogin} · waiting{" "}
                        <span className="font-bold text-white font-mono">
                          <Duration hours={p.hoursInState} />
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <StateBadge state={p.state} />
                    <Badge tone="neutral">Turn: {p.whoseTurn}</Badge>
                    <Link
                      href={`/dashboard/repos/${p.owner}/${p.repo}`}
                      className="btn btn-ghost btn-sm"
                    >
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
    </div>
  );
}