import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { repoBoard } from "@/lib/queries/dashboard";
import { STATE_META, ORDERED_STATES } from "@/lib/engine/types";
import { EmptyState, Badge, PageHeader } from "@/components/ui";
import { Duration } from "@/components/state-badge";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { stateLabel } from "@/lib/i18n/state-label";
import {
  IconArrowLeft,
  IconGitPullRequest,
  IconExternalLink,
  IconClock,
  IconCheckCircle,
  IconGitHub,
  IconLayers,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const { t } = await getTranslatorForRequest();
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
            <span>{t("repos:board_breadcrumb")}</span>
          </Link>
          <span className="text-ink-600">/</span>
          <span className="text-ink-400">{owner}</span>
          <span className="text-ink-600">/</span>
          <span className="font-semibold text-white">{repo}</span>
        </div>

        <PageHeader
          title={`${owner}/${repo}`}
          description={t("repos:board_description", { count: board.prs.length })}
          actions={
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/repos/${owner}/${repo}/intelligence?tab=onboarding`}
                className="btn btn-ghost btn-sm"
              >
                <span>{t("repos:board_onboarding")}</span>
              </Link>
              <Link
                href={`/dashboard/repos/${owner}/${repo}/intelligence`}
                className="btn btn-ghost btn-sm"
              >
                <IconLayers className="h-3.5 w-3.5" />
                <span>{t("repos:board_intelligence")}</span>
              </Link>
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <IconGitHub className="h-3.5 w-3.5" />
                <span>GitHub</span>
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
            {t("repos:board_distribution")}
          </span>
          {openStates.map((st) => {
            const count = byState.get(st)?.length ?? 0;
            return (
              <span
                key={st}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-ink-300"
              >
                <span className="text-white font-bold font-mono">{count}</span>
                <span>{stateLabel(st, t)}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Board Content */}
      {board.prs.length === 0 ? (
        <EmptyState
          icon={IconCheckCircle}
          title={t("repos:board_empty_title")}
          hint={t("repos:board_empty_hint")}
          action={
            <Link href="/dashboard/repos" className="btn btn-ghost btn-sm">
              &larr; {t("repos:board_empty_back")}
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
                    <Badge tone={meta.tone}>{stateLabel(state, t)}</Badge>
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
                                <Link
                                  href={`/dashboard/repos/${owner}/${repo}/pulls/${pr.number}`}
                                  className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                                >
                                  {pr.title}
                                </Link>
                                <span className="font-mono text-xs text-ink-500">
                                  #{pr.number}
                                </span>
                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-ink-500 hover:text-white transition-colors"
                                  title={t("repos:board_open_on_github")}
                                >
                                  <IconExternalLink className="h-3 w-3" />
                                </a>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-ink-400">
                                <span>{t("repos:board_by_author", { login: pr.authorLogin })}</span>
                                <span className="text-ink-600">&middot;</span>
                                <span className="flex items-center gap-1 text-[11px]">
                                  <IconClock className="h-3 w-3 text-ink-500" />
                                  <span>{t("repos:board_waiting")}</span>
                                  <span className={isStalled ? "font-bold text-warn-300" : "text-white"}>
                                    <Duration hours={hours} />
                                  </span>
                                  {isStalled ? (
                                    <span className="text-warn-400 font-semibold">
                                      {t("repos:board_stalled")}
                                    </span>
                                  ) : null}
                                </span>
                                {pr.reviewDecision?.startsWith("APPROVED") ? (
                                  <>
                                    <span className="text-ink-600">&middot;</span>
                                    <span className="font-sans font-semibold text-signal-400">
                                      {t("repos:board_approved")}
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
                            <span>{t("repos:board_open_on_github")}</span>
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