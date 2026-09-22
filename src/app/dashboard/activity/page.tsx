import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { recentActivity, type ActivityItem } from "@/lib/queries/dashboard";
import { Duration, EmptyState, PageHeader, StatCard } from "@/components/ui";
import {
  IconActivity,
  IconGitPullRequest,
  IconBranch,
  IconClock,
  IconArrowRight,
} from "@/components/icons";

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
  const isNudge = item.type === "nudge";
  const hoursAgo = (Date.now() - item.createdAt.getTime()) / 3_600_000;

  return (
    <li className="flex items-start gap-3.5 px-5 py-4 transition-colors hover:bg-white/[0.02]">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs ${
          isNudge
            ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
            : "border-white/[0.08] bg-ink-850 text-ink-300"
        }`}
      >
        {isNudge ? <IconActivity className="h-4 w-4" /> : <IconGitPullRequest className="h-4 w-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-xs font-semibold text-ink-100">{item.description}</p>
          <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
            {isNudge ? "targeted-nudge" : "state-transition"}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-400">
          <Link
            href={`/dashboard/repos/${item.owner}/${item.repo}`}
            className="text-brand-300 transition-colors hover:text-brand-200"
          >
            {item.owner}/{item.repo}
          </Link>
          <span className="text-ink-600">&middot;</span>
          <span className="text-ink-400">PR #{item.prNumber}</span>
        </div>
      </div>

      <time
        dateTime={item.createdAt.toISOString()}
        className="shrink-0 pt-0.5 font-mono text-[11px] text-ink-500"
        title={item.createdAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "medium" })}
      >
        <Duration hours={hoursAgo} /> ago
      </time>
    </li>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const user = await currentUser();
  if (!user) return null;

  const activity = await recentActivity(user, 60);
  const activeFilter = resolvedParams?.filter ?? "all";

  const nudgeCount = activity.filter((a) => a.type === "nudge").length;
  const stateChangeCount = activity.filter((a) => a.type === "state_change").length;

  const filteredActivity =
    activeFilter === "nudges"
      ? activity.filter((a) => a.type === "nudge")
      : activeFilter === "states"
      ? activity.filter((a) => a.type === "state_change")
      : activity;

  const grouped = new Map<string, ActivityItem[]>();
  const now = Date.now();
  for (const item of filteredActivity) {
    const day = relativeDay(item.createdAt, now);
    const list = grouped.get(day) ?? [];
    list.push(item);
    grouped.set(day, list);
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        eyebrow="Audit &amp; Event Ledger"
        title="Activity Ledger"
        description="Chronological audit of what Baton executed across your repositories: targeted stall nudges and pull request state transitions."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
              <IconBranch className="h-3.5 w-3.5" />
              <span>Tracked Repositories</span>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Activity Items"
          value={activity.length}
          detail="Recent ledger events"
          icon={IconClock}
        />
        <StatCard
          label="Targeted Nudges"
          value={nudgeCount}
          detail="Polite @mentions sent"
          tone="brand"
          icon={IconActivity}
        />
        <StatCard
          label="State Transitions"
          value={stateChangeCount}
          detail="PR status updates"
          tone="signal"
          icon={IconGitPullRequest}
        />
        <StatCard
          label="Ledger Health"
          value="Healthy"
          detail="Deterministic engine"
          tone="signal"
          icon={IconClock}
        />
      </section>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/dashboard/activity"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFilter === "all"
                ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            All Activity ({activity.length})
          </Link>
          <Link
            href="/dashboard/activity?filter=nudges"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFilter === "nudges"
                ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            Targeted Nudges ({nudgeCount})
          </Link>
          <Link
            href="/dashboard/activity?filter=states"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFilter === "states"
                ? "bg-brand-500/15 text-brand-200 font-semibold shadow-sm"
                : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            State Transitions ({stateChangeCount})
          </Link>
        </div>

        <span className="font-mono text-[11px] text-ink-500">
          Showing newest events first
        </span>
      </div>

      {/* Activity Timeline */}
      {filteredActivity.length === 0 ? (
        <EmptyState
          icon={IconActivity}
          title={
            activeFilter === "nudges"
              ? "No targeted nudges recorded yet"
              : activeFilter === "states"
              ? "No state transitions recorded yet"
              : "No activity recorded yet"
          }
          hint={
            activity.length === 0
              ? "Activity appears here once Baton processes events from your connected repositories. Baton issues targeted nudges when review thresholds expire."
              : "Try switching filters to view all activity."
          }
          action={
            activity.length > 0 ? (
              <Link href="/dashboard/activity" className="btn btn-ghost btn-sm">
                <span>View all activity</span>
                <IconArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <Link href="/dashboard/repos" className="btn btn-primary btn-sm">
                <span>View Tracked Repos</span>
                <IconArrowRight className="h-3 w-3" />
              </Link>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="divide-y divide-white/[0.06]">
            {[...grouped.entries()].map(([day, items]) => (
              <section key={day}>
                <div className="border-b border-white/[0.05] bg-ink-950/70 px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  {day} &middot; <span className="font-normal text-ink-500">{items.length} event{items.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="divide-y divide-white/[0.04]">
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