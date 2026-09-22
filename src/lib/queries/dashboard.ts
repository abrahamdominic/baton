import { prisma } from "../db";
import type { SessionUser } from "../auth/session";
import { STATE_META, ORDERED_STATES } from "../engine/types";

/**
 * Installations visible to the signed-in user (user-linked or same login).
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
      OR: [{ userId: user.id }, { accountLogin: user.login }],
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
 * "Your move": every open, non-draft PR on the user's repos that is stalled,
 * ordered by how actionable/oldest it is.
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

  const actionableOrder = (state: string) => {
    const idx = ORDERED_STATES.indexOf(state as (typeof ORDERED_STATES)[number]);
    return idx === -1 ? 99 : idx;
  };

  return prs
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
      hoursInState: (now - pr.stateEnteredAt.getTime()) / 3_600_000,
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
 */
export async function recentActivity(user: SessionUser, limit = 50): Promise<ActivityItem[]> {
  const installations = await myInstallations(user, { allRepos: true });
  const repoIds = installations.flatMap((i) => i.repos.map((r) => r.id));
  if (repoIds.length === 0) return [];

  const rows = await prisma.action.findMany({
    where: { repoId: { in: repoIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      targetJson: true,
      createdAt: true,
      repo: { select: { owner: true, name: true } },
      pr: { select: { number: true, title: true } },
    },
  });

  const items: ActivityItem[] = [];
  for (const row of rows) {
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

  return items.slice(0, limit);
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