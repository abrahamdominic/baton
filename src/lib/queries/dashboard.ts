import { prisma } from "../db";
import type { SessionUser } from "../auth/session";
import { STATE_META, ORDERED_STATES } from "../engine/types";

/** Installations visible to the signed-in user (user-linked or same login). */
export async function myInstallations(user: SessionUser) {
  return prisma.appInstallation.findMany({
    where: {
      uninstalledAt: null,
      OR: [{ userId: user.id }, { accountLogin: user.login }],
    },
    include: {
      repos: {
        where: { enabled: true },
        include: { setting: true },
      },
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
      return "—";
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
 * "Your move" — every open, non-draft PR on the user's repos that is stalled,
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
      stateLabel: STATE_META[pr.state as keyof typeof STATE_META]?.label ?? "—",
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