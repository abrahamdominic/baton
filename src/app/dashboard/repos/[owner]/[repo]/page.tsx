import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { repoBoard } from "@/lib/queries/dashboard";
import { STATE_META, ORDERED_STATES } from "@/lib/engine/types";
import { Duration, EmptyState, Badge } from "@/components/ui";
import { IconArrowRight, IconGitPullRequest } from "@/components/icons";

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

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-400 font-mono">
            <Link href="/dashboard/repos" className="hover:text-white transition-colors">
              Repositories
            </Link>
            <span>/</span>
            <span className="text-white">{owner}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white font-mono sm:text-3xl">
            {owner}/{repo}
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            {board.prs.length} open pull request{board.prs.length === 1 ? "" : "s"} tracked by Baton
          </p>
        </div>

        <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
          &larr; All Repositories
        </Link>
      </section>

      {board.prs.length === 0 ? (
        <EmptyState title="Zero open pull requests" hint="All pull requests on this repository are merged or closed." />
      ) : (
        <div className="space-y-8">
          {openStates.map((state) => {
            const meta = STATE_META[state];
            const prs = byState.get(state)!;
            return (
              <section key={state} className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
                <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-6 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="font-mono text-xs text-ink-400">({prs.length})</span>
                  </div>
                  <code className="text-[11px] font-mono text-ink-500">baton:{state.toLowerCase().replace(/_/g, "-")}</code>
                </div>

                <ul className="divide-y divide-white/[0.05]">
                  {prs.map((pr) => {
                    const hours = (Date.now() - pr.stateEnteredAt.getTime()) / 3_600_000;
                    return (
                      <li key={pr.id} className="transition-colors hover:bg-white/[0.02]">
                        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-brand-300">
                              <IconGitPullRequest className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                                >
                                  {pr.title}
                                </a>
                                <span className="font-mono text-xs text-ink-400">#{pr.number}</span>
                              </div>
                              <p className="mt-1 text-xs text-ink-400 font-mono">
                                Author: @{pr.authorLogin} · in state for{" "}
                                <span className="font-bold text-white">
                                  <Duration hours={hours} />
                                </span>
                                {pr.reviewDecision?.startsWith("APPROVED") ? (
                                  <span className="text-signal-400 ml-1.5 font-sans font-semibold">· Approved</span>
                                ) : null}
                              </p>
                            </div>
                          </div>

                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                          >
                            Open on GitHub
                            <IconArrowRight className="h-3 w-3" />
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