import { prisma } from "../db";
import { logger } from "../logger";
import type { BatonState } from "../engine/types";

/**
 * Work context: what a developer was in the middle of, persisted so it survives
 * a closed tab, a switched machine, or a Monday.
 *
 * Two hard rules make this feature honest rather than a bookmark list:
 *
 *  1. A context is only stored for a repository the user can actually reach, so
 *     restoring it can never surface a private repository to someone who lost
 *     access. Authorization is re-checked at save and at load.
 *  2. Restoring returns the *live* record. It never replays a cached copy of a
 *     pull request, because a stale PR snapshot presented as current is worse
 *     than no context at all.
 */

export type WorkContextKind = "pr" | "repository" | "digest" | "question";

/**
 * Pull request states that are still live work, i.e. the ones a developer can
 * actually do something about. `merged` and `closed` are terminal, `draft` has
 * not been offered to anyone yet, so neither counts as outstanding work.
 *
 * This mirrors `BatonState` from `../engine/types`. It is deliberately spelled
 * out here rather than imported as a runtime value because `BatonState` is a
 * type-only export: re-deriving the list by hand invites exactly the drift that
 * made an earlier revision of this file filter on a non-existent `"open"` state
 * and silently return no next actions at all.
 */
const LIVE_PR_STATES: BatonState[] = [
  "awaiting_review",
  "awaiting_review_after_fix",
  "changes_required",
  "ci_failing",
  "blocked_on_checks",
  "conflicts",
  "ready_to_merge",
];

const LIVE_PR_STATE_FILTER = { state: { in: LIVE_PR_STATES } };

export interface WorkContextRecord {
  id: string;
  repoId: string;
  insightId: string | null;
  label: string;
  kind: WorkContextKind;
  targetUrl: string;
  payload: Record<string, unknown>;
  restoredFromId: string | null;
  createdAt: Date;
  lastUsedAt: Date;
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Only `/`-rooted, same-origin paths are storable as a target.
 *
 * An absolute URL here would let a stored context redirect a developer to an
 * attacker-controlled host through a link that looks like it came from Baton.
 */
function normalizeTarget(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Explicit code-point scan rather than a control-character regex: the regex
  // form is rejected by the linter and an unescaped newline in a stored URL is a
  // header-injection risk, not a cosmetic one.
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  // Reject anything that a browser would parse as a scheme or a backslash-based
  // off-origin jump once the path is concatenated onto our origin.
  if (/^\/+[\\/]/.test(raw)) return null;
  if (/[\\]/.test(raw)) return null;
  if (raw.includes(":")) return null;
  return raw;
}

export async function rememberContext(input: {
  userId: string;
  repoId: string;
  kind: WorkContextKind;
  label: string;
  targetUrl: string;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  const target = normalizeTarget(input.targetUrl);
  if (!target) {
    logger.warn("work-context-rejected-target", { userId: input.userId, target: input.targetUrl });
    return null;
  }
  if (!input.label.trim()) return null;

  // Authorization gate: the caller must be able to see this repository.
  const visible = await prisma.repo.findFirst({
    where: {
      id: input.repoId,
      OR: [
        { installation: { userId: input.userId } },
        { installation: { organizationLinks: { some: { organization: { members: { some: { userId: input.userId } } } } } } },
        { installation: { teamLinks: { some: { team: { members: { some: { userId: input.userId } } } } } } },
      ],
    },
    select: { id: true, insight: { select: { id: true } } },
  });
  if (!visible) return null;

  const created = await prisma.workContext.create({
    data: {
      userId: input.userId,
      repoId: input.repoId,
      insightId: visible.insight?.id ?? null,
      kind: input.kind,
      label: input.label.slice(0, 200),
      targetUrl: target,
      payload: JSON.stringify(input.payload ?? {}),
    },
  });
  logger.info("work-context-remembered", { userId: input.userId, repoId: input.repoId, kind: input.kind });
  return created.id;
}

/** Most recent contexts across every repository the user can still see. */
export async function recentContexts(userId: string, limit = 12): Promise<WorkContextRecord[]> {
  const rows = await prisma.workContext.findMany({
    where: {
      userId,
      repo: {
        OR: [
          { installation: { userId } },
          { installation: { organizationLinks: { some: { organization: { members: { some: { userId } } } } } } },
          { installation: { teamLinks: { some: { team: { members: { some: { userId } } } } } } },
        ],
      },
    },
    orderBy: { lastUsedAt: "desc" },
    take: Math.min(limit, 50),
    include: { repo: { select: { fullName: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    repoId: r.repoId,
    insightId: r.insightId,
    label: r.label,
    kind: r.kind as WorkContextKind,
    targetUrl: r.targetUrl,
    payload: parseJson(r.payload),
    restoredFromId: r.restoredFromId,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

export interface RestoredContext {
  context: WorkContextRecord;
  repoFullName: string;
  /** What is actually true now, not what was true when the context was saved. */
  live: { kind: "pr"; state: string; updatedAt: Date } | { kind: "repository"; openPrs: number };
}

/**
 * Restore a context and report its current state.
 *
 * `lastUsedAt` is bumped so the ordering reflects what is actually being worked
 * on. The repository's live counts are recomputed rather than replayed, so a
 * developer returning after two weeks sees the current queue.
 */
export async function restoreContext(userId: string, contextId: string): Promise<RestoredContext | null> {
  const row = await prisma.workContext.findFirst({
    where: {
      id: contextId,
      userId,
      repo: {
        OR: [
          { installation: { userId } },
          { installation: { organizationLinks: { some: { organization: { members: { some: { userId } } } } } } },
          { installation: { teamLinks: { some: { team: { members: { some: { userId } } } } } } },
        ],
      },
    },
    include: { repo: { select: { fullName: true } } },
  });
  if (!row) return null;

  let live: RestoredContext["live"];
  if (row.kind === "pr") {
    const payload = parseJson(row.payload);
    // `prNumber` is what the PR page writes today; `number` is accepted so a
    // context saved by an earlier build can still be restored.
    const raw = payload.prNumber ?? payload.number;
    const number = Number(raw ?? 0);
    if (!Number.isInteger(number) || number <= 0) return null;
    const pr = await prisma.pullRequest.findFirst({
      where: { repoId: row.repoId, number },
      select: { state: true, updatedAt: true },
    });
    if (!pr) return null;
    live = { kind: "pr", state: pr.state, updatedAt: pr.updatedAt };
  } else {
    const openPrs = await prisma.pullRequest.count({ where: { repoId: row.repoId, ...LIVE_PR_STATE_FILTER } });
    live = { kind: "repository", openPrs };
  }

  await prisma.workContext.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });

  return {
    context: {
      id: row.id,
      repoId: row.repoId,
      insightId: row.insightId,
      label: row.label,
      kind: row.kind as WorkContextKind,
      targetUrl: row.targetUrl,
      payload: parseJson(row.payload),
      restoredFromId: row.restoredFromId,
      createdAt: row.createdAt,
      lastUsedAt: new Date(),
    },
    repoFullName: row.repo.fullName,
    live,
  };
}

export async function forgetContext(userId: string, contextId: string): Promise<boolean> {
  const res = await prisma.workContext.deleteMany({
    where: { id: contextId, userId },
  });
  return res.count > 0;
}

export interface NextAction {
  id: string;
  label: string;
  href: string;
  reason: string;
  priority: number;
  evidenceIds: string[];
}

/**
 * Next actions for a repository: what is currently waiting on this user.
 *
 * Derived from the same persisted `PullRequest` rows the dashboard uses, so it
 * cannot disagree with the queue. Only actionable states are considered; a pull
 * request that is ready to merge is not the viewer's problem, and listing it
 * would be noise dressed up as a suggestion.
 */
export async function nextActionsFor(
  userId: string,
  repoId: string,
): Promise<NextAction[]> {
  const repo = await prisma.repo.findFirst({
    where: {
      id: repoId,
      OR: [
        { installation: { userId } },
        { installation: { organizationLinks: { some: { organization: { members: { some: { userId } } } } } } },
        { installation: { teamLinks: { some: { team: { members: { some: { userId } } } } } } },
      ],
    },
    select: { id: true, owner: true, name: true },
  });
  if (!repo) return [];

  const prs = await prisma.pullRequest.findMany({
    where: { repoId, ...LIVE_PR_STATE_FILTER },
    select: {
      number: true,
      title: true,
      state: true,
      authorLogin: true,
      stateEnteredAt: true,
      requestedReviewersJson: true,
    },
    orderBy: { stateEnteredAt: "asc" },
    take: 100,
  });

  const login = await prisma.user.findUnique({ where: { id: userId }, select: { login: true } });
  const viewer = (login?.login ?? "").toLowerCase();

  const actions: NextAction[] = [];
  for (const pr of prs) {
    const isAuthor = pr.authorLogin.toLowerCase() === viewer;
    const reviewers = parseJson(pr.requestedReviewersJson);
    const reviewerLogins: string[] = Array.isArray(reviewers) ? reviewers.map((r) => String(r).toLowerCase()) : [];
    const awaitingViewer = reviewerLogins.includes(viewer);

    const ageDays = Math.floor((Date.now() - pr.stateEnteredAt.getTime()) / 86_400_000);

    if (isAuthor && (pr.state === "changes_required" || pr.state === "ci_failing" || pr.state === "conflicts")) {
      actions.push({
        id: `pr-${pr.number}-author`,
        label: `Address feedback on #${pr.number}`,
        href: `/dashboard/repos/${repo.owner}/${repo.name}/pulls/${pr.number}`,
        reason: `Your pull request is in ${pr.state.replace(/_/g, " ")} and has been for ${ageDays} day${ageDays === 1 ? "" : "s"}.`,
        // Older first: the longest-stalled item is the most likely forgotten one.
        priority: 100 - Math.min(ageDays, 99),
        evidenceIds: [],
      });
    }
    if (!isAuthor && awaitingViewer && (pr.state === "awaiting_review" || pr.state === "awaiting_review_after_fix")) {
      actions.push({
        id: `pr-${pr.number}-review`,
        label: `Review #${pr.number}`,
        href: `/dashboard/repos/${repo.owner}/${repo.name}/pulls/${pr.number}`,
        reason: `You were requested on a pull request that has been waiting ${ageDays} day${ageDays === 1 ? "" : "s"}.`,
        priority: 100 - Math.min(ageDays, 99),
        evidenceIds: [],
      });
    }
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 10);
}
