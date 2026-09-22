import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { repoBoard } from "@/lib/queries/dashboard";
import { STATE_META, ORDERED_STATES } from "@/lib/engine/types";
import { Duration, EmptyState, Badge, PageHeader } from "@/components/ui";
import {
  IconArrowLeft,
  IconGitPullRequest,
  IconExternalLink,
  IconClock,
  IconCheckCircle,
  IconGitHub,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const user = await currentUser();
  if (!user) return null;

  const board = await repoBoard(user, owner, repo);
  if (!board.repo) notFound();

  const byState = new Map<string, typeof board.prs>();
  for (const pr of board.prs) {
    const list = byState.get(pr.state) ?? [];
    list.push(pr);
    byState.set(pr.state, list);
  }

  const openStates = ORDERED_STATES.filter((s) => byState.has(s));
  const githubRepoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-ink-400">
          <Link
            href="/dashboard/repos"
            className="flex items-center gap-1 text-ink-400 transition-colors hover:text-white"
          >
            <IconArrowLeft className="h-3 w-3" />
            <span>Repositories</span>
          </Link>
          <span className="text-ink-600">/</span>
          <span className="text-ink-400">{owner}</span>
          <span className="text-ink-600">/</span>
          <span className="font-semibold text-white">{repo}</span>
        </div>

        <PageHeader
          title={`${owner}/${repo}`}
          description={`${board.prs.length} open pull request${board.prs.length === 1 ? "" : "s"} tracked across review lifecycle states.`}
          actions={
            <div className="flex items-center gap-2">
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <IconGitHub className="h-3.5 w-3.5" />
                <span>GitHub Repository</span>
                <IconExternalLink className="h-3 w-3" />
              </a>
            </div>
          }
        />
      </div>

      {/* State distribution summary tags */}
      {board.prs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-ink-900/40 p-3 sm:p-4">
          <span className="font-mono text-[10px] uppercase font-semibold text-ink-500 mr-1">
            Distribution:
          </span>
          {openStates.map((st) => {
            const count = byState.get(st)?.length ?? 0;
            const meta = STATE_META[st];
            return (
              <span
                key={st}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-ink-300"
              >
                <span className="text-white font-bold font-mono">{count}</span>
                <span>{meta?.label ?? st}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Board Content */}
      {board.prs.length === 0 ? (
        <EmptyState
          icon={IconCheckCircle}
          title="Zero open pull requests"
          hint="All pull requests on this repository are merged or closed. When new pull requests are opened, they will be classified here in real time."
          action={
            <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
              &larr; Back to all repositories
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {openStates.map((state) => {
            const meta = STATE_META[state];
            const prs = byState.get(state)!;

            return (
              <section
                key={state}
                className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm"
              >
                {/* State Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="font-mono text-xs font-bold text-ink-300">
                      ({prs.length})
                    </span>
                  </div>
                  <code className="rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-ink-500">
                    baton:{state.toLowerCase().replace(/_/g, "-")}
                  </code>
                </div>

                {/* PR Cards */}
                <ul className="divide-y divide-white/[0.05]">
                  {prs.map((pr) => {
                    const hours = (Date.now() - pr.stateEnteredAt.getTime()) / 3_600_000;
                    const isStalled = hours >= 24;

                    return (
                      <li
                        key={pr.id}
                        className="transition-colors hover:bg-white/[0.02]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                          <div className="flex min-w-0 flex-1 items-start gap-3.5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-brand-300">
                              <IconGitPullRequest className="h-4 w-4" />
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                                >
                                  {pr.title}
                                </a>
                                <span className="font-mono text-xs text-ink-500">
                                  #{pr.number}
                                </span>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-ink-400">
                                <span>by @{pr.authorLogin}</span>
                                <span className="text-ink-600">&middot;</span>
                                <span className="flex items-center gap-1 text-[11px]">
                                  <IconClock className="h-3 w-3 text-ink-500" />
                                  <span>waiting</span>
                                  <span className={isStalled ? "font-bold text-warn-300" : "text-white"}>
                                    <Duration hours={hours} />
                                  </span>
                                  {isStalled ? (
                                    <span className="text-warn-400 font-semibold">(stalled)</span>
                                  ) : null}
                                </span>
                                {pr.reviewDecision?.startsWith("APPROVED") ? (
                                  <>
                                    <span className="text-ink-600">&middot;</span>
                                    <span className="font-sans font-semibold text-signal-400">
                                      &check; Approved
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                          >
                            <span>Open on GitHub</span>
                            <IconExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}