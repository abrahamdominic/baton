import { prisma } from "../db";
import type { SessionUser } from "../auth/session";
import { STATE_META, ORDERED_STATES } from "../engine/types";

/**
 * Installations visible to the signed-in user.
 *
 * Three legitimate visibility paths, all server-side:
 *  - personally claimed  (`userId`): a personal-account GitHub install. The
 *    claim is conditional on the installation being unowned, so this is
 *    exclusive and cannot be stolen by a second sign-in.
 *  - same login          (`accountLogin`): GitHub's own account identity for a
 *    personal account, so an install is visible even before it is claimed.
 *  - organization member (`organizationLinks`): an Organization installation is
 *    owned by the organization, never by an individual admin, so every member
 *    sees it. This branch is what replaces personal ownership of org installs —
 *    without it, stopping the ownership flip would hide an org's repositories
 *    from everyone but the last admin who signed in.
 *
 * By default only enabled repos are returned; pass `allRepos: true` for admin
 * surfaces that should show every connected repository (including paused).
 */
export async function myInstallations(
  user: SessionUser,
  opts: { allRepos?: boolean } = {},
) {
  return prisma.appInstallation.findMany({
    where: {
      uninstalledAt: null,
      OR: [
        { userId: user.id },
        { accountLogin: user.login },
        {
          organizationLinks: {
            some: { organization: { members: { some: { userId: user.id } } } },
          },
        },
        { teamLinks: { some: { team: { members: { some: { userId: user.id } } } } } },
      ],
    },
    include: {
      repos: opts.allRepos
        ? { include: { setting: true }, orderBy: [{ owner: "asc" }, { name: "asc" }] }
        : { where: { enabled: true }, include: { setting: true } },
    },
    orderBy: { accountLogin: "asc" },
  });
}

export function whoseTurnLabel(state: string): string {
  switch (state) {
    case "awaiting_review":
    case "awaiting_review_after_fix":
      return "Reviewers";
    case "changes_required":
    case "ci_failing":
    case "conflicts":
      return "Author";
    case "ready_to_merge":
      return "Author or maintainer";
    default:
      return "No one";
  }
}

export interface YourMoveItem {
  prId: string;
  number: number;
  title: string;
  url: string;
  owner: string;
  repo: string;
  state: string;
  stateLabel: string;
  stateTone: string;
  whoseTurn: string;
  hoursInState: number;
  authorLogin: string;
  lastActivity: Date;
}

/**
 * Classified states in which the PR author is the one who has to act next.
 * Mirrors `whoseTurnLabel` so the two can never disagree about who owns the
 * turn.
 */
const AUTHOR_ACT_STATES = new Set(["changes_required", "ci_failing", "conflicts"]);
/** States whose turn belongs to reviewers, kept in step with `whoseTurnLabel`. */
const REVIEWER_ACT_STATES = new Set(["awaiting_review", "awaiting_review_after_fix"]);

/**
 * "Your move": the open, non-draft PRs that are actually waiting on *this*
 * user, most actionable first.
 *
 * This previously returned every open, non-draft PR on the user's repositories
 * — including PRs authored by other people that are not waiting on the user at
 * all — while the surrounding copy called it "Your move" and claimed it was
 * "stalled". It filtered on nothing that connects a PR to the viewer, so the
 * primary dashboard queue was a mislabelled list of someone else's work.
 *
 * Two real cases earn a place here:
 *  1. The user is a requested reviewer and the PR is awaiting review.
 *  2. The user authored the PR and the classified state says the author must
 *     act (changes requested, CI failing, or conflicting).
 *
 * `ready_to_merge` is deliberately excluded: with no approval/review-count
 * signal on the row, a merge-ready PR is a team decision, not this user's
 * personal obligation, and guessing here is what made the old list wrong.
 */
export async function yourMove(user: SessionUser): Promise<YourMoveItem[]> {
  const installations = await myInstallations(user);
  const repoIds = installations.flatMap((i) => i.repos.map((r) => r.id));
  if (repoIds.length === 0) return [];

  const now = Date.now();
  const prs = await prisma.pullRequest.findMany({
    where: {
      repoId: { in: repoIds },
      githubState: "OPEN",
      isDraft: false,
      state: { notIn: ["merged", "closed"] },
    },
    include: { repo: true },
  });

  const login = user.login.toLowerCase();

  const actionableOrder = (state: string) => {
    const idx = ORDERED_STATES.indexOf(state as (typeof ORDERED_STATES)[number]);
    return idx === -1 ? 99 : idx;
  };

  const requestedBy: (pr: (typeof prs)[number]) => boolean = (pr) => {
    try {
      const list = JSON.parse(pr.requestedReviewersJson || "[]") as unknown;
      return Array.isArray(list) && list.some((r) => {
        if (typeof r === "string") return r.toLowerCase() === login;
        if (r && typeof r === "object") {
          const l = (r as { login?: unknown }).login;
          return typeof l === "string" && l.toLowerCase() === login;
        }
        return false;
      });
    } catch {
      return false;
    }
  };

  return prs
    .filter((pr) => {
      if (pr.authorLogin.toLowerCase() === login) return AUTHOR_ACT_STATES.has(pr.state);
      return REVIEWER_ACT_STATES.has(pr.state) && requestedBy(pr);
    })
    .map((pr) => ({
      prId: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      owner: pr.repo.owner,
      repo: pr.repo.name,
      state: pr.state,
      stateLabel: STATE_META[pr.state as keyof typeof STATE_META]?.label ?? "Unknown",
      stateTone: STATE_META[pr.state as keyof typeof STATE_META]?.tone ?? "neutral",
      whoseTurn: whoseTurnLabel(pr.state),
      // Whole hours, not a fractional float: this is rendered as "3h" and
      // previously leaked values like 3.48372.
      hoursInState: Math.floor((now - pr.stateEnteredAt.getTime()) / 3_600_000),
      authorLogin: pr.authorLogin,
      lastActivity: pr.githubUpdatedAt,
    }))
    .sort((a, b) => {
      const da = actionableOrder(a.state) - actionableOrder(b.state);
      if (da !== 0) return da;
      return b.hoursInState - a.hoursInState;
    });
}

/** Per-repo board: open PRs for one repo (page groups by state). */
export async function repoBoard(user: SessionUser, owner: string, repo: string) {
  const installations = await myInstallations(user);
  const matches = installations.flatMap((i) =>
    i.repos
      .filter((r) => r.owner === owner && r.name === repo)
      .map((r) => ({ ...r, installation: i })),
  );
  const repoRow = matches[0] ?? null;
  if (!repoRow) return { repo: null, prs: [] as Awaited<ReturnType<typeof queryPrs>> };

  const prs = await queryPrs(repoRow.id);
  return { repo: repoRow, prs };
}

async function queryPrs(repoId: string) {
  return prisma.pullRequest.findMany({
    where: { repoId, githubState: "OPEN", isDraft: false },
    orderBy: { stateEnteredAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Activity ledger (read-side)
// ---------------------------------------------------------------------------

export type ActivityType = "nudge" | "state_change";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  createdAt: Date;
  /** Human sentence describing what Baton did. */
  description: string;
  /** Baton state involved (state_change transitions). */
  state?: string;
  previousState?: string;
}

const ACTIVITY_STATE_META = STATE_META as Record<string, { label: string }>;

/**
 * What Baton has done on the user's repos, newest first. Only meaningful rows:
 * targeted nudges, and PR refreshes that actually changed the classified state.
 * `pr_snapshot` rows where the state didn't change are noise and are filtered
 * out here.
 *
 * The filter has to happen while paging, not after a single `take`. The worker
 * writes a `pr_snapshot` row on *every* PR refresh, so the newest N rows are
 * almost entirely snapshots that carry no state change; taking one page and
 * filtering in JavaScript returned an empty or badly under-filled feed even
 * though real activity existed further back. So the query excludes the row
 * types that can never be shown, then walks pages until `limit` meaningful
 * items are collected or a hard scan cap is reached.
 */
const ACTIVITY_SCAN_CAP = 2000;
const ACTIVITY_PAGE = 200;

export async function recentActivity(user: SessionUser, limit = 50): Promise<ActivityItem[]> {
  const installations = await myInstallations(user, { allRepos: true });
  const repoIds = installations.flatMap((i) => i.repos.map((r) => r.id));
  if (repoIds.length === 0) return [];

  const items: ActivityItem[] = [];
  let cursor: string | undefined;
  let scanned = 0;

  while (items.length < limit && scanned < ACTIVITY_SCAN_CAP) {
    const take = Math.min(ACTIVITY_PAGE, ACTIVITY_SCAN_CAP - scanned);
    const rows = await prisma.action.findMany({
      where: {
        repoId: { in: repoIds },
        // Only these two types can ever produce an activity entry. Excluding
        // status_comment/label/comment in SQL stops them from consuming the
        // page budget.
        type: { in: ["nudge", "pr_snapshot"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        targetJson: true,
        createdAt: true,
        repo: { select: { owner: true, name: true } },
        pr: { select: { number: true, title: true } },
      },
    });
    if (rows.length === 0) break;
    scanned += rows.length;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      if (items.length >= limit) break;
      if (!row.repo || !row.pr) continue;
      let target: { state?: string; prevState?: string } = {};
      try {
        target = JSON.parse(row.targetJson || "{}") as { state?: string; prevState?: string };
      } catch {
        target = {};
      }

      if (row.type === "nudge") {
        items.push({
          id: row.id,
          type: "nudge",
          owner: row.repo.owner,
          repo: row.repo.name,
          prNumber: row.pr.number,
          prTitle: row.pr.title,
          createdAt: row.createdAt,
          description: `Sent a targeted @mention nudge on #${row.pr.number}`,
        });
        continue;
      }

      if (row.type === "pr_snapshot" && target.prevState && target.state && target.prevState !== target.state) {
        items.push({
          id: row.id,
          type: "state_change",
          owner: row.repo.owner,
          repo: row.repo.name,
          prNumber: row.pr.number,
          prTitle: row.pr.title,
          createdAt: row.createdAt,
          state: target.state,
          previousState: target.prevState,
          description: `State changed on #${row.pr.number}: ${
            ACTIVITY_STATE_META[target.prevState]?.label ?? target.prevState
          } → ${ACTIVITY_STATE_META[target.state]?.label ?? target.state}`,
        });
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Sessions (account admin)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
}

/**
 * All browser sessions for the signed-in user, newest first, with the current
 * session (identified by its raw token hash) flagged so the UI never lets you
 * revoke the session you're using.
 */
export async function userSessions(user: SessionUser, currentTokenHash: string | null = null): Promise<SessionInfo[]> {
  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      userAgent: true,
      ip: true,
      tokenHash: true,
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    userAgent: s.userAgent,
    ip: s.ip,
    isCurrent: currentTokenHash !== null && s.tokenHash === currentTokenHash,
  }));
}

/** Count of installations + repos for a summary line (admin page). */
export async function accountSummary(user: SessionUser) {
  const installations = await myInstallations(user, { allRepos: true });
  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const prCount = await prisma.pullRequest.count({
    where: { repoId: { in: installations.flatMap((i) => i.repos.map((r) => r.id)) } },
  });
  return { installations: installations.length, repos: repoCount, openPRs: prCount };
}