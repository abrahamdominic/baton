import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { repoBoard } from "@/lib/queries/dashboard";
import { STATE_META, ORDERED_STATES } from "@/lib/engine/types";
import { Duration, EmptyState, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const user = await currentUser();
  const board = await repoBoard(user!, owner, repo);
  if (!board.repo) notFound();

  const byState = new Map<string, typeof board.prs>();
  for (const pr of board.prs) {
    const list = byState.get(pr.state) ?? [];
    list.push(pr);
    byState.set(pr.state, list);
  }

  const openStates = ORDERED_STATES.filter((s) => byState.has(s));

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs uppercase tracking-wide text-ink-400">Repo board</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {owner}/{repo}
        </h1>
        <p className="mt-1 text-sm text-ink-300">{board.prs.length} open PRs</p>
      </section>

      {board.prs.length === 0 ? (
        <EmptyState title="Nothing open" hint="All caught up on this repository." />
      ) : (
        <div className="space-y-6">
          {openStates.map((state) => {
            const meta = STATE_META[state];
            const prs = byState.get(state)!;
            return (
              <section key={state}>
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="text-xs text-ink-400">{prs.length}</span>
                </div>
                <ul className="space-y-2">
                  {prs.map((pr) => {
                    const hours = (Date.now() - pr.stateEnteredAt.getTime()) / 3_600_000;
                    return (
                      <li key={pr.id}>
                        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-sm font-medium text-ink-50 hover:text-brand-300"
                            >
                              #{pr.number} — {pr.title}
                            </a>
                            <p className="mt-0.5 text-xs text-ink-400">
                              by @{pr.authorLogin} · waiting{" "}
                              <span className="font-medium text-ink-200">
                                <Duration hours={hours} />
                              </span>
                              {pr.reviewDecision?.startsWith("APPROVED") ? " · approved" : ""}
                            </p>
                          </div>
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