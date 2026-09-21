import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { yourMove, myInstallations } from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { Duration, EmptyState, StateBadge, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser();
  const [items, installations] = await Promise.all([yourMove(user!), myInstallations(user!)]);
  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const stalled = items.filter((p) => p.hoursInState >= 24).length;

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-50">Your Move</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {items.length === 0
              ? "Nothing on your queue. Every PR is moving."
              : `${items.length} open PR${items.length === 1 ? "" : "s"} across your repos, ${stalled} stalled 24h+`}
          </p>
        </div>
        <a
          href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
          className="btn btn-ghost btn-sm"
          target="_blank"
          rel="noreferrer"
        >
          Install on another repo
        </a>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Repos tracked", value: repoCount },
          { label: "Open PRs", value: items.length },
          { label: "Stalled 24h+", value: stalled },
          { label: "Waiting on reviewers", value: items.filter((p) => p.whoseTurn === "Reviewers").length },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-ink-800 bg-ink-900/40 px-5 py-4">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-ink-50">{s.value}</p>
            <p className="mt-1 text-xs text-ink-400">{s.label}</p>
          </div>
        ))}
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="All clear"
          hint="When you install Baton on a repository, open PRs will appear here with their state, who is next, and how long they have been waiting."
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-ink-800">
          {items.map((p) => (
            <li key={p.prId} className="border-b border-ink-800/80 bg-ink-900/25 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <div className="flex items-center gap-2">
                  <StateBadge state={p.state} />
                  <Badge tone="neutral">{p.whoseTurn}</Badge>
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium text-ink-50 transition-colors hover:text-brand-300"
                  >
                    {p.title}
                  </a>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {p.owner}/{p.repo} #{p.number} by @{p.authorLogin} · waiting{" "}
                    <span className="font-medium text-ink-200">
                      <Duration hours={p.hoursInState} />
                    </span>
                  </p>
                </div>
                <Link href={`/dashboard/repos/${p.owner}/${p.repo}`} className="btn btn-ghost btn-sm">
                  Repo board
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}