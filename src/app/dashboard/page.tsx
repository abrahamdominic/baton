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
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Move</h1>
          <p className="mt-1 text-sm text-ink-300">
            {items.length === 0
              ? "Nothing on your queue — every PR is moving."
              : `${items.length} open PR${items.length === 1 ? "" : "s"} across your repos · ${stalled} stalled 24h+`}
          </p>
        </div>
        <a
          href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
          className="btn-ghost"
          target="_blank"
          rel="noreferrer"
        >
          Install on another repo
        </a>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Repos tracked", value: repoCount },
          { label: "Open PRs", value: items.length },
          { label: "Stalled 24h+", value: stalled },
          { label: "Waiting on reviewers", value: items.filter((p) => p.whoseTurn === "Reviewers").length },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="mt-0.5 text-xs uppercase tracking-wide text-ink-400">{s.label}</p>
          </div>
        ))}
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="All clear"
          hint="When you install Baton on a repository, open PRs will appear here with their state, who's next, and how long it's been waiting."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.prId}>
              <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
                <StateBadge state={p.state} />
                <Badge tone="neutral">{p.whoseTurn}</Badge>
                <div className="min-w-0 flex-1">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium text-ink-50 hover:text-brand-300"
                  >
                    {p.owner}/{p.repo} · #{p.number} — {p.title}
                  </a>
                  <p className="truncate text-xs text-ink-400">
                    by @{p.authorLogin} · waiting{" "}
                    <span className="font-medium text-ink-200">
                      <Duration hours={p.hoursInState} />
                    </span>
                  </p>
                </div>
                <Link href={`/dashboard/repos/${p.owner}/${p.repo}`} className="btn-ghost text-xs">
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