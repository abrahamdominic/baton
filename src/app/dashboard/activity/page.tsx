import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { recentActivity, type ActivityItem } from "@/lib/queries/dashboard";
import { Duration } from "@/components/ui";
import { IconActivity, IconGitPullRequest } from "@/components/icons";

export const dynamic = "force-dynamic";

function relativeDay(createdAt: Date, now: number): string {
  const day = new Date(createdAt);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (createdAt.getTime() >= start) return "Today";
  if (createdAt.getTime() >= start - dayMs) return "Yesterday";
  return day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          item.type === "nudge"
            ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
            : "border-white/[0.08] bg-ink-850 text-ink-300"
        }`}
      >
        {item.type === "nudge" ? <IconActivity className="h-4 w-4" /> : <IconGitPullRequest className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink-100">{item.description}</p>
        <p className="mt-1 font-mono text-[11px] text-ink-400">
          <Link
            href={`/dashboard/repos/${item.owner}/${item.repo}`}
            className="text-brand-300 transition-colors hover:text-brand-200"
          >
            {item.owner}/{item.repo}
          </Link>
          <span className="text-ink-600"> · PR #{item.prNumber}</span>
        </p>
      </div>
      <time
        dateTime={item.createdAt.toISOString()}
        className="shrink-0 pt-0.5 font-mono text-[11px] text-ink-500"
        title={item.createdAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "medium" })}
      >
        <Duration hours={(Date.now() - item.createdAt.getTime()) / 3_600_000} /> ago
      </time>
    </li>
  );
}

export default async function ActivityPage() {
  const user = await currentUser();
  if (!user) return null;
  const activity = await recentActivity(user, 50);

  const grouped = new Map<string, ActivityItem[]>();
  const now = Date.now();
  for (const item of activity) {
    const day = relativeDay(item.createdAt, now);
    const list = grouped.get(day) ?? [];
    list.push(item);
    grouped.set(day, list);
  }

  const types = { nudge: 0, state_change: 0 } as Record<string, number>;
  for (const item of activity) types[item.type] = (types[item.type] ?? 0) + 1;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Activity Ledger</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Activity</h1>
          <p className="mt-1 text-xs text-ink-400">
            {activity.length === 0
              ? "Baton records what it does on your repositories as events are processed."
              : `${activity.length} recent event${activity.length === 1 ? "" : "s"} · ${types["nudge"] ?? 0} nudges · ${types["state_change"] ?? 0} state changes`}
          </p>
        </div>
        <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
          Manage Repositories
          <IconGitPullRequest className="h-3 w-3" />
        </Link>
      </section>

      {activity.length === 0 ? (
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/[0.08] bg-ink-900/20 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-ink-900 text-signal-400">
              <IconActivity className="h-6 w-6" />
            </div>
            <p className="text-base font-bold text-white">No activity recorded yet</p>
            <p className="max-w-md text-xs leading-relaxed text-ink-400">
              Activity appears here once Baton starts processing your repositories. Baton records
              two kinds of events: <span className="text-ink-200">targeted nudges</span> (@mentions
              sent past your threshold) and <span className="text-ink-200">state changes</span> on
              pull requests (e.g. Waiting for review → Ready to merge).
            </p>
            <Link href="/dashboard/repos" className="btn btn-primary btn-sm">
              View Repositories
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-3 text-[11px] font-mono uppercase text-ink-400">
            Everything Baton did on your repos
          </div>
          <div className="divide-y divide-white/[0.05]">
            {[...grouped.entries()].map(([day, items]) => (
              <section key={day}>
                <div className="border-b border-white/[0.05] bg-ink-950/40 px-6 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  {day}
                </div>
                <ul className="divide-y divide-white/[0.05]">
                  {items.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}