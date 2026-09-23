import Link from "next/link";
import type { WorkspaceBoardItem } from "@/lib/workspaces";
import { Badge, Duration, EmptyState, StateBadge } from "@/components/ui";
import {
  IconBranch,
  IconClock,
  IconExternalLink,
  IconGitPullRequest,
} from "@/components/icons";

export function WorkspaceBoard({
  items,
  installAccounts,
  repos,
}: {
  items: WorkspaceBoardItem[];
  installAccounts: string[];
  repos: { id: string; owner: string; name: string }[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={IconGitPullRequest}
        title="No pull requests await action"
        hint={
          repos.length === 0
            ? "Share at least one GitHub installation with this workspace so members can see its board here."
            : "Every open pull request across the shared repositories is moving. New stalled PRs will appear here automatically."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Repo scope */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Shared scope
        </span>
        {installAccounts.map((account) => (
          <span
            key={account}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-ink-900/70 px-2 py-0.5 font-mono text-[11px] text-ink-300"
          >
            <IconBranch className="h-3 w-3 text-brand-400" />
            @{account}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-ink-500">
          {repos.length} shared repo{repos.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {items.length} Pull Request{items.length === 1 ? "" : "s"} Requiring Action
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            Team-wide queue &middot; shared by members
          </span>
        </div>
        <ul className="divide-y divide-white/[0.05]">
          {items.map((p) => {
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
                        <span className="font-mono font-medium text-brand-300">
                          {p.owner}/{p.repo}
                        </span>
                        <span className="text-ink-600">&middot;</span>
                        <span>by @{p.authorLogin}</span>
                        <span className="text-ink-600">&middot;</span>
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <IconClock className="h-3 w-3 text-ink-500" />
                          <span className={isStalled ? "font-bold text-warn-300" : "text-ink-300"}>
                            <Duration hours={p.hoursInState} />
                          </span>
                          {isStalled ? (
                            <span className="font-semibold text-warn-400">(stalled)</span>
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
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function BoardHeaderLinks({
  repo,
}: {
  repo?: { id: string; owner: string; name: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {repo ? (
        <Link
          href={`/dashboard/repos/${repo.owner}/${repo.name}`}
          className="btn btn-ghost btn-sm"
        >
          <IconBranch className="h-3.5 w-3.5" />
          <span>Repo board</span>
          <IconExternalLink className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}