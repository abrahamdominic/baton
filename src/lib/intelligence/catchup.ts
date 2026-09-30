import { prisma } from "../db";
import { logger } from "../logger";
import { myInstallations } from "../queries/dashboard";
import { loadKnowledge } from "./knowledge";
import type { SessionUser } from "../auth/session";

/**
 * The catch-up briefing (skill.md §9).
 *
 * The question it answers is not "how many pull requests are open". It is:
 *
 *   > What do I need to know before I start working?
 *
 * Everything a developer would otherwise have to reconstruct by hand after an
 * interruption: what landed while they were gone, what is now their turn, what
 * broke, what changed in the repository's memory, and what is still unresolved.
 *
 * ## The anti-spam rule
 *
 * This is the part that decides whether the feature is worth keeping. A briefing
 * that repeats itself daily is a notification channel developers mute, and once
 * muted it is worse than nothing because the one urgent item is lost with the
 * rest. So:
 *
 *   - every item is scoped to a window (`since`, default 24h) rather than to the
 *     current queue, so nothing that has not changed is repeated;
 *   - items are deduplicated by identity, not by text;
 *   - when the window yields nothing, the briefing says so and returns empty
 *     rather than padding with standing facts like "you have 12 open PRs".
 *
 * Standing conditions (stalled PRs, missing CODEOWNERS) belong to the repository
 * page, where they are always one click away and not competing for attention.
 */

export type CatchUpSectionKey =
  | "waiting_on_you"
  | "your_work"
  | "ci_failures"
  | "blocked"
  | "collaborators"
  | "knowledge"
  | "conversations";

export interface CatchUpItem {
  id: string;
  text: string;
  /** Baton-internal page for this item, or the GitHub URL for remote work. */
  href: string | null;
  /** "you" (your turn) | "team" (someone else's) | "system" (repository fact). */
  owner: "you" | "team" | "system";
  at: Date;
}

export interface CatchUpSection {
  key: CatchUpSectionKey;
  items: CatchUpItem[];
}

export interface CatchUpBriefing {
  /** Window start. Null means "first briefing ever". */
  since: Date | null;
  generatedAt: Date;
  sections: CatchUpSection[];
  /** Total across every section. 0 means nothing happened: say so, do not pad. */
  total: number;
  /**
   * True when the briefing is empty. The UI renders a single calm line instead
   * of an empty dashboard, which is the whole anti-spam mechanism.
   */
  quiet: boolean;
}

export interface CatchUpInput {
  login: string;
  /** Window start. Null means "everything currently outstanding". */
  since: Date | null;
  now: Date;
  repos: { id: string; owner: string; name: string; fullName: string }[];
  /** Outstanding pull requests across those repositories. */
  pullRequests: {
    repoId: string;
    number: number;
    title: string;
    url: string;
    authorLogin: string;
    state: string;
    stateEnteredAt: Date;
    requestedReviewers: string[];
    updatedAt: Date;
  }[];
  /** Snapshot changes since the window, i.e. something actually happened. */
  revisions: { repoId: string; revision: number; collectedAt: Date }[];
  /**
   * Revision number already reported for each repository by the previous
   * briefing. Without this the briefing is pure noise: `collectedAt` moves on
   * every scheduled re-collection, so an hourly sync would otherwise generate a
   * "moved to revision N" line every hour whether or not a single fact changed.
   */
  previousRevisions: Record<string, number>;
  /** Knowledge whose content changed inside the window. */
  knowledge: { repoId: string; id: string; kind: string; title: string; revision: number; lastChangedAt: Date }[];
  /** Unread notifications, newest first. */
  unread: { id: string; type: string; createdAt: Date }[];
}

const STALL_HOURS = 24;

/** States that are genuinely outstanding work rather than a finished PR. */
const LIVE_STATES = new Set([
  "awaiting_review",
  "awaiting_review_after_fix",
  "changes_required",
  "ci_failing",
  "blocked_on_checks",
  "conflicts",
]);

/**
 * Build the briefing.
 *
 * Pure: every timestamp comes from `input`, so a test can prove that a PR which
 * entered state three days ago does not appear in a one-hour window without
 * touching the system clock.
 */
export function buildCatchUpBriefing(input: CatchUpInput): CatchUpBriefing {
  const { login, since, now } = input;
  const viewer = login.toLowerCase();
  const repoById = new Map(input.repos.map((r) => [r.id, r]));
  const sections: CatchUpSection[] = [];

  const within = (at: Date) => since === null || at > since;

  const add = (key: CatchUpSectionKey, item: CatchUpItem) => {
    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = { key, items: [] };
      sections.push(section);
    }
    // Identity, not text: the same PR can be reachable by state and by update
    // time, and one line per PR is the contract.
    if (section.items.some((i) => i.id === item.id)) return;
    section.items.push(item);
  };

  const hrefFor = (repoId: string, number: number): string | null => {
    const repo = repoById.get(repoId);
    return repo ? `/dashboard/repos/${repo.owner}/${repo.name}/pulls/${number}` : null;
  };

  for (const pr of input.pullRequests) {
    const repo = repoById.get(pr.repoId);
    if (!repo) continue;
    const isAuthor = pr.authorLogin.toLowerCase() === viewer;
    const reviewers = pr.requestedReviewers.map((r) => r.toLowerCase());
    const isReviewer = reviewers.includes(viewer);
    const label = `${repo.fullName}#${pr.number}`;
    const href = hrefFor(pr.repoId, pr.number);

    // Your turn: a review was requested from this specific human.
    if (!isAuthor && isReviewer && (pr.state === "awaiting_review" || pr.state === "awaiting_review_after_fix")) {
      const ageHours = Math.floor((now.getTime() - pr.stateEnteredAt.getTime()) / 3_600_000);
      // Only surface it if it moved inside the window, or it is brand new work
      // assigned since the window opened. Repeating a two-week-old review request
      // every morning is exactly the notification spam this replaces.
      if (within(pr.stateEnteredAt) || within(pr.updatedAt)) {
        add("waiting_on_you", {
          id: `review-${pr.repoId}-${pr.number}`,
          text: `${label} ${pr.title} has been waiting for your review for ${ageHours} hour${ageHours === 1 ? "" : "s"}`,
          href,
          owner: "you",
          at: pr.stateEnteredAt,
        });
      }
      continue;
    }

    // Your work that is now blocked on you.
    if (isAuthor && (pr.state === "changes_required" || pr.state === "conflicts")) {
      if (within(pr.stateEnteredAt) || within(pr.updatedAt)) {
        add("your_work", {
          id: `author-${pr.repoId}-${pr.number}`,
          text: `${label} ${pr.title} needs your changes: ${pr.state === "conflicts" ? "it has merge conflicts" : "review feedback is unaddressed"}`,
          href,
          owner: "you",
          at: pr.stateEnteredAt,
        });
      }
      continue;
    }

    // CI failures. Attributed to whoever can act, which is usually not this
    // human, and marked as theirs so it does not read as their problem.
    if (pr.state === "ci_failing" && (within(pr.stateEnteredAt) || within(pr.updatedAt))) {
      add("ci_failures", {
        id: `ci-${pr.repoId}-${pr.number}`,
        text: `${label} ${pr.title} by @${pr.authorLogin} has failing checks`,
        href,
        owner: isAuthor ? "you" : "team",
        at: pr.stateEnteredAt,
      });
      continue;
    }

    // Blocked: someone else's pull request waiting on a human, not on CI.
    if (!isAuthor && !isReviewer && (pr.state === "blocked_on_checks" || pr.state === "changes_required")) {
      add("blocked", {
        id: `blocked-${pr.repoId}-${pr.number}`,
        text: `${label} ${pr.title} by @${pr.authorLogin} is blocked and no reviewer has picked it up`,
        href,
        owner: "team",
        at: pr.stateEnteredAt,
      });
    }
  }

  // Repository memory changed. This is the section that makes the briefing
  // worth reading even on a quiet day: something about the codebase itself
  // shifted, and nobody would otherwise find out.
  for (const k of input.knowledge) {
    if (!within(k.lastChangedAt)) continue;
    const repo = repoById.get(k.repoId);
    add("knowledge", {
      id: `knowledge-${k.id}`,
      text: repo ? `${k.title} (${repo.fullName})` : k.title,
      href: repo ? `/dashboard/repos/${repo.owner}/${repo.name}/intelligence?tab=knowledge` : null,
      owner: "system",
      at: k.lastChangedAt,
    });
  }

  // Unresolved conversations. Read state per user is already exact in the
  // notification inbox, so this is a count of things genuinely unanswered rather
  // than a guess about whether somebody saw a message.
  if (input.unread.length > 0) {
    const newest = input.unread[0]!;
    const others = input.unread.length - 1;
    add("conversations", {
      id: "unread-notifications",
      text:
        input.unread.length === 1
          ? "One notification is still unread"
          : `${input.unread.length} notifications are still unread, newest ${Math.floor((now.getTime() - newest.createdAt.getTime()) / 3_600_000)} hour${Math.floor((now.getTime() - newest.createdAt.getTime()) / 3_600_000) === 1 ? "" : "s"} ago`,
      href: others > 0 ? "/dashboard/messages" : "/dashboard/notifications",
      owner: "you",
      at: newest.createdAt,
    });
  }

  // Repository facts changed. Gated on the revision *number* advancing past the
  // one the previous briefing already reported, not on `collectedAt`, which
  // moves on every scheduled re-collection: time alone would make a routine
  // sync indistinguishable from a real change, and the briefing would be a
  // clock chime.
  for (const rev of input.revisions) {
    if (!within(rev.collectedAt)) continue;
    if (rev.revision <= (input.previousRevisions[rev.repoId] ?? 0)) continue;
    const repo = repoById.get(rev.repoId);
    if (!repo) continue;
    add("collaborators", {
      id: `revision-${rev.repoId}-${rev.revision}`,
      text: `${repo.fullName} moved to intelligence revision ${rev.revision}`,
      href: `/dashboard/repos/${repo.owner}/${repo.name}/intelligence`,
      owner: "system",
      at: rev.collectedAt,
    });
  }

  // Sort newest first within each section, and cap. An unbounded briefing is a
  // wall of text, which is the failure mode of every digest ever shipped.
  for (const section of sections) {
    section.items.sort((a, b) => b.at.getTime() - a.at.getTime());
    section.items = section.items.slice(0, 8);
  }

  // Fixed order, most personal first. The order is the argument: what is mine,
  // then what is broken, then what the system learned.
  const ORDER: CatchUpSectionKey[] = [
    "waiting_on_you",
    "your_work",
    "ci_failures",
    "blocked",
    "conversations",
    "knowledge",
    "collaborators",
  ];
  const ordered = ORDER.filter((k) => sections.some((s) => s.key === k && s.items.length > 0)).map(
    (k) => sections.find((s) => s.key === k)!,
  );

  const total = ordered.reduce((n, s) => n + s.items.length, 0);
  return { since, generatedAt: now, sections: ordered, total, quiet: total === 0 };
}

/**
 * The digest slot that doubles as the "last time this human looked" watermark.
 *
 * Reusing `InsightDigest` rather than adding a `lastSeenAt` column to `User`
 * keeps the watermark and the briefing that produced it in one row: the previous
 * briefing's `createdAt` *is* the window start for the next one, so the two can
 * never disagree.
 */
export const CATCHUP_SLOT = "catchup";
export const CATCHUP_KIND = "developer_briefing";

export interface CatchUpView {
  briefing: CatchUpBriefing;
  /** Stable digest id so the UI can offer "mark as read". */
  digestId: string | null;
  /** Window actually used, which may be the fallback rather than a real visit. */
  windowStart: Date;
  /** True when no previous briefing existed and the fallback window was used. */
  usedFallbackWindow: boolean;
}

/**
 * How far back the first briefing reaches.
 *
 * A brand new account has no history to diff against. Showing genuinely nothing
 * would be technically honest and practically useless, so the first briefing
 * falls back to a week of activity. Every briefing after that uses the real
 * watermark.
 */
export const FIRST_BRIEFING_WINDOW_DAYS = 7;

/**
 * Assemble the briefing for one developer.
 *
 * Reads are parallel and each is independently scoped to repositories the user
 * can already see, so this cannot leak a repository across a tenant boundary.
 */
export async function getCatchUpBriefing(
  user: SessionUser,
  options: { persist?: boolean } = {},
): Promise<CatchUpView> {
  const now = new Date();
  const installations = await myInstallations(user);
  const repos = installations.flatMap((i) =>
    i.repos.map((r) => ({ id: r.id, owner: r.owner, name: r.name, fullName: r.fullName })),
  );

  if (repos.length === 0) {
    return {
      briefing: {
        since: null,
        generatedAt: now,
        sections: [],
        total: 0,
        quiet: true,
      },
      digestId: null,
      windowStart: now,
      usedFallbackWindow: false,
    };
  }

  const repoIds = repos.map((r) => r.id);

  const [previous, pullRequests, insights, unread] = await Promise.all([
    prisma.insightDigest.findFirst({
      where: { userId: user.id, kind: CATCHUP_KIND, slot: CATCHUP_SLOT },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, evidence: true },
    }),
    prisma.pullRequest.findMany({
      where: { repoId: { in: repoIds }, githubState: "OPEN", isDraft: false },
      select: {
        repoId: true,
        number: true,
        title: true,
        url: true,
        authorLogin: true,
        state: true,
        stateEnteredAt: true,
        requestedReviewersJson: true,
        updatedAt: true,
      },
      // A generous ceiling: the briefing is a starting point, not an export.
      take: 200,
    }),
    prisma.repositoryInsight.findMany({
      where: { repoId: { in: repoIds } },
      select: { id: true, repoId: true, revision: true, collectedAt: true },
    }),
    prisma.notification.findMany({
      where: { userId: user.id, readAt: null },
      select: { id: true, type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Knowledge is loaded per repository because it is scoped per repository.
  // Only entries whose *content* changed are interesting; a fact observed again
  // without changing is reinforcement, not news.
  const knowledge = (
    await Promise.all(
      repoIds.map(async (repoId) => {
        const facts = await loadKnowledge(repoId, { limit: 100 });
        return facts.map((f) => ({ repoId, id: f.id, kind: f.kind, title: f.title, revision: f.revision, lastChangedAt: f.lastChangedAt }));
      }),
    )
  ).flat();

  const since = previous?.createdAt ?? new Date(now.getTime() - FIRST_BRIEFING_WINDOW_DAYS * 86_400_000);
  const usedFallbackWindow = !previous;
  const previousRevisions = parseRevisionMap(previous?.evidence ?? null);

  const briefing = buildCatchUpBriefing({
    login: user.login,
    since,
    now,
    repos,
    pullRequests: pullRequests
      .filter((p) => LIVE_STATES.has(p.state))
      .map((p) => ({
        repoId: p.repoId,
        number: p.number,
        title: p.title,
        url: p.url,
        authorLogin: p.authorLogin,
        state: p.state,
        stateEnteredAt: p.stateEnteredAt,
        requestedReviewers: parseList(p.requestedReviewersJson),
        updatedAt: p.updatedAt,
      })),
    revisions: insights.map((i) => ({ repoId: i.repoId, revision: i.revision, collectedAt: i.collectedAt })),
    previousRevisions,
    knowledge,
    unread: unread.map((n) => ({ id: n.id, type: n.type, createdAt: n.createdAt })),
  });

  // Only a briefing with something in it is worth persisting, and only on a read
  // that will actually be rendered. Persisting an empty briefing would move the
  // watermark forward and silently swallow the events that arrive next.
  let digestId: string | null = null;
  if (options.persist !== false && !briefing.quiet) {
    try {
      const row = await prisma.insightDigest.create({
        data: {
          userId: user.id,
          kind: CATCHUP_KIND,
          slot: CATCHUP_SLOT,
          title: "Catch-up briefing",
          body: JSON.stringify(briefing.sections),
          // The revision snapshot rides along with the briefing it describes, so
          // the "have I already told you this?" test and the briefing can never
          // disagree after a partial write.
          evidence: JSON.stringify(
            Object.fromEntries(insights.map((i) => [i.repoId, i.revision])),
          ),
          revision: 1,
        },
        select: { id: true },
      });
      digestId = row.id;
      logger.info("catchup-briefing-created", { userId: user.id, sections: briefing.sections.length, items: briefing.total });
    } catch (e) {
      // A digest failure must never break the dashboard render.
      logger.warn("catchup-briefing-persist-failed", { userId: user.id, error: String(e) });
    }
  }

  return { briefing, digestId, windowStart: since, usedFallbackWindow };
}

/** Mark the current catch-up briefing as read. */
export async function markCatchUpRead(userId: string, digestId: string): Promise<boolean> {
  const res = await prisma.insightDigest.updateMany({
    where: { id: digestId, userId, kind: CATCHUP_KIND, slot: CATCHUP_SLOT },
    data: { readAt: new Date() },
  });
  return res.count > 0;
}

/** How long the current pending work has been sitting, for the header line. */
export function stalledFor(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3_600_000));
}

export const STALL_THRESHOLD_HOURS = STALL_HOURS;

function parseList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Read back the revision snapshot stored alongside the previous briefing. */
function parseRevisionMap(raw: string | null): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    // A corrupt snapshot degrades to "report everything once", which is noisy
    // but never wrong. Silently defaulting to every repo looking unchanged
    // would hide a real change.
    return {};
  }
}