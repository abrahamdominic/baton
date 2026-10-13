import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { metrics } from "@/lib/observability/metrics";
import { readStructure, type StoredStructure } from "@/lib/intelligence/profile";
import {
  WORKFLOW_LABELS,
  docsImplications,
  affectedTests,
  type IssueLike,
  type WorkflowPr,
} from "./automation";

/**
 * Release preparation (§20, "release preparation").
 *
 * What this replaces
 * 
 * Before a release, someone opens the repository, reads the changelog, checks
 * which pull requests merged since the last tag, checks whether CI was green on
 * the default branch, and checks whether anything on the list was flagged
 * "needs docs". That is five to fifteen minutes of mechanical work per release,
 * repeated every release, and it is exactly the kind of work §8 says to automate.
 *
 * Honesty constraints
 * 
 *  - **No changelog is written for the user.** The finding says which merged pull
 *    requests would belong in the notes and what their titles were; composing the
 *    prose is the release manager's call, and auto-generated changelog entries
 *    routinely ship a squashed-branch title that means nothing to a user.
 *  - **CI status is read from what the snapshot recorded**, and the absence of a
 *    recorded check is reported as unknown, never as green. A release brief that
 *    says "CI passing" because no check was captured is worse than no brief.
 *  - **`mergedLast30Days: null` is not "nothing merged".** The collection job
 *    records `null` when GitHub's search API cannot index a private repository,
 *    and the existing `briefing.ts` already treats that as silence rather than
 *    zero. This module does the same.
 */

export interface ReleaseInput {
  prs: WorkflowPr[];
  structure: StoredStructure;
  insight: {
    lastReleaseTag: string | null;
    lastReleaseAt: Date | null;
    mergedLast30Days: number | null;
  };
  now: Date;
}

export interface ReleaseContributor {
  login: string;
  mergedCount: number;
}

export interface ReleaseReadiness {
  /** Ordered sections, each independently reportable. */
  sections: {
    key: string;
    title: string;
    /** Why this section is present, so an empty section is explicable. */
    basis: string;
    items: { label: string; detail: string; href: string | null }[];
  }[];
  /** Blocking problems, worst first. Empty means nothing obviously blocks. */
  blockers: { text: string; basis: string }[];
  /** Merge throughput: `null` means GitHub never told us. */
  mergedSinceLastRelease: number | null;
  contributors: ReleaseContributor[];
  /** Headline for the UI. Never claims the release is "ready" on its own. */
  headline: string;
}

const DAY_MS = 86_400_000;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Merged pull requests since the previous release, from persisted state.
 *
 * The window starts at the last release date. When there is no previous release,
 * the window falls back to 30 days and the caller is told, because "everything
 * ever" is not a useful release scope and silently picking one would be a guess.
 */
export function mergedSince(
  prs: WorkflowPr[],
  lastReleaseAt: Date | null,
  now: Date,
): { prs: WorkflowPr[]; windowDays: number; basedOnRelease: boolean } {
  const since = lastReleaseAt ?? new Date(now.getTime() - 30 * DAY_MS);
  const merged = prs.filter((pr) => {
    if (pr.githubState !== "MERGED") return false;
    return pr.githubUpdatedAt.getTime() >= since.getTime();
  });
  const windowDays = lastReleaseAt
    ? Math.max(1, Math.ceil((now.getTime() - lastReleaseAt.getTime()) / DAY_MS))
    : 30;
  return { prs: merged, windowDays, basedOnRelease: lastReleaseAt !== null };
}

/**
 * Assemble the release brief.
 *
 * Pure, so every threshold and every "unknown" branch is unit-testable.
 */
export function buildReleaseReadiness(input: ReleaseInput): ReleaseReadiness {
  const { prs, structure, insight, now } = input;
  const { prs: merged, windowDays, basedOnRelease } = mergedSince(prs, insight.lastReleaseAt, now);
  const sections: ReleaseReadiness["sections"] = [];
  const blockers: ReleaseReadiness["blockers"] = [];

  //  What would go in the notes 
  const notes = [...merged].sort(
    (a, b) => a.githubUpdatedAt.getTime() - b.githubUpdatedAt.getTime(),
  );
  sections.push({
    key: "changelog_candidates",
    title: "Pull requests merged since the last release",
    basis: basedOnRelease
      ? `${merged.length} merged pull request${merged.length === 1 ? "" : "s"} since ${insight.lastReleaseTag ?? "the previous release"} (${insight.lastReleaseAt?.toISOString().slice(0, 10)}), a ${windowDays}-day window. Baton lists the pull requests and their titles; it does not write release notes.`
      : `No previous release tag was recorded, so the window is the last ${windowDays} days. ${merged.length} merged pull request${merged.length === 1 ? "" : "s"} fall inside it.`,
    items: notes.slice(0, 25).map((pr) => ({
      label: `#${pr.number}`,
      detail: pr.title,
      href: pr.url,
    })),
  });

  //  Throughput, honestly 
  // `mergedLast30Days: null` is GitHub's answer being unavailable (private repos
  // are not indexed by the search API), not a count of zero.
  const throughput: ReleaseReadiness["sections"][number] = {
    key: "throughput",
    title: "Merge throughput",
    basis:
      insight.mergedLast30Days === null
        ? "GitHub's search API does not report merge counts for this repository, so throughput is unknown. It is not zero, and this is not raised as a problem."
        : `${insight.mergedLast30Days} pull request${insight.mergedLast30Days === 1 ? "" : "s"} merged in the 30 days before the last collection.`,
    items: [],
  };
  sections.push(throughput);

  //  Blocking problems 
  const failing = merged.filter((pr) => pr.state === "ci_failing" || pr.state === "blocked_on_checks");
  if (failing.length > 0) {
    for (const pr of failing) {
      blockers.push({
        text: `#${pr.number} was merged with failing checks`,
        basis: `The snapshot recorded state "${pr.state}" for #${pr.number} at ${pr.githubUpdatedAt.toISOString().slice(0, 10)}. Baton does not know whether CI recovered afterwards, so confirm on the pull request before shipping.`,
      });
    }
  }

  const conflicted = prs.filter((pr) => pr.githubState === "OPEN" && pr.state === "conflicts");
  sections.push({
    key: "open_conflicts",
    title: "Open pull requests with merge conflicts",
    basis: `${conflicted.length} open pull request${conflicted.length === 1 ? " has" : "s have"} conflicts against the default branch. These are not release blockers but usually indicate work that should land first.`,
    items: conflicted.slice(0, 10).map((pr) => ({
      label: `#${pr.number}`,
      detail: pr.title,
      href: pr.url,
    })),
  });

  //  Documentation 
  const docPaths = structure.profile?.hasDocsDir ? structure.topLevel.filter((t) => /^docs?$/i.test(t)) : [];
  // Tested per entry, never against the joined string. Joining first and
  // anchoring with `$` means a repository whose root contains CHANGELOG.md *and*
  // anything else, which is every real repository, fails the check, because the
  // match has to survive the entries that follow it. That produced a "no
  // changelog" blocker on the majority of repositories that have one.
  const hasChangelog = structure.topLevel.some((t) =>
    /^(changelog|changes|history|releases)(\.md|\.mdx|\.rst|\.txt)?$/i.test(t),
  );
  sections.push({
    key: "documentation",
    title: "Documentation state",
    basis: hasChangelog
      ? "A changelog file was detected at the repository root, so release notes have somewhere to go."
      : `No changelog file was detected at the repository root. ${docPaths.length > 0 ? `A docs directory (${docPaths.join(", ")}) exists, so documentation is maintained somewhere other than a changelog.` : "No docs directory was detected either, so release notes may have to live outside the repository."}`,
    items: [],
  });
  if (!hasChangelog) {
    blockers.push({
      text: "No changelog file was detected at the repository root",
      basis: "Baton scanned the default branch's top-level entries and found no file named changelog/changes/history/releases. Notes may still be maintained elsewhere, so this is a prompt to check, not a defect.",
    });
  }

  //  Security policy 
  sections.push({
    key: "security",
    title: "Security policy",
    basis: structure.profile?.securityTooling.length
      ? `Security tooling detected: ${structure.profile.securityTooling.join(", ")}.`
      : "No security tooling (SECURITY.md, Dependabot, CodeQL, or similar) was detected during collection.",
    items: [],
  });

  //  Contributors 
  const byLogin = new Map<string, number>();
  for (const pr of merged) {
    byLogin.set(pr.authorLogin, (byLogin.get(pr.authorLogin) ?? 0) + 1);
  }
  const contributors = [...byLogin.entries()]
    .map(([login, mergedCount]) => ({ login, mergedCount }))
    .sort((a, b) => b.mergedCount - a.mergedCount || a.login.localeCompare(b.login));

  sections.push({
    key: "contributors",
    title: "Contributors in this window",
    basis: `Derived from the author of each merged pull request in the window. GitHub's own contributor graph also counts commits and reviews, so this list is narrower than the repository's contributor count.`,
    items: contributors.slice(0, 10).map((c) => ({
      label: `@${c.login}`,
      detail: `${c.mergedCount} merged pull request${c.mergedCount === 1 ? "" : "s"}`,
      href: null,
    })),
  });

  const openUnmerged = prs.filter((pr) => pr.githubState === "OPEN").length;
  sections.push({
    key: "open_work",
    title: "Open work at release time",
    basis: `${openUnmerged} pull request${openUnmerged === 1 ? " is" : "s are"} still open. Baton lists them so the release manager can decide what is deliberately deferred.`,
    items: prs
      .filter((pr) => pr.githubState === "OPEN")
      .slice(0, 10)
      .map((pr) => ({ label: `#${pr.number}`, detail: pr.title, href: pr.url })),
  });

  const headline =
    merged.length === 0
      ? `No merged pull requests recorded in the last ${windowDays} days.`
      : `${merged.length} merged pull request${merged.length === 1 ? "" : "s"} in the last ${windowDays} days${blockers.length > 0 ? `, with ${blockers.length} item${blockers.length === 1 ? "" : "s"} to check before shipping` : ""}.`;

  return {
    sections,
    blockers,
    mergedSinceLastRelease: merged.length,
    contributors,
    headline,
  };
}

/**
 * Docs/tests implications for the release as a whole, derived from the merged
 * pull requests rather than one pull request at a time.
 */
export function releaseImplications(
  prs: WorkflowPr[],
  structure: StoredStructure,
): { findings: ReturnType<typeof docsImplications>; pathCount: number } {
  const changedPaths = new Set<string>();
  for (const pr of prs) {
    const snapshot = parseJson<{ files?: unknown } | null>(pr.snapshotJson ?? "", null);
    if (!snapshot || !Array.isArray(snapshot.files)) continue;
    for (const f of snapshot.files) {
      if (typeof f === "string") changedPaths.add(f);
      else if (typeof f === "object" && f !== null) {
        const p = (f as { path?: unknown }).path;
        if (typeof p === "string") changedPaths.add(p);
      }
    }
  }
  const paths = [...changedPaths];
  return {
    findings: [
      ...docsImplications(paths),
      ...affectedTests(paths, { hasTestsInRepo: structure.profile?.hasTests ?? false }),
    ],
    pathCount: paths.length,
  };
}

export { WORKFLOW_LABELS };
export type { IssueLike };

/**
 * Release readiness for a repository, from persisted state only.
 *
 * Returns `null` when there is nothing to report, a repository with no recorded
 * pull requests has no release context, and rendering an empty readiness panel
 * would imply Baton had looked and found nothing wrong.
 */
export async function releaseReadinessFor(repoId: string): Promise<ReleaseReadiness | null> {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { id: true, enabled: true, insight: { select: { structure: true, lastReleaseTag: true, lastReleaseAt: true, mergedLast30Days: true } } },
  });
  if (!repo || !repo.enabled || !repo.insight) return null;

  const prs = (await prisma.pullRequest.findMany({
    where: { repoId },
    select: {
      number: true,
      title: true,
      state: true,
      authorLogin: true,
      url: true,
      baseRef: true,
      headRef: true,
      isDraft: true,
      githubState: true,
      reviewDecision: true,
      requestedReviewersJson: true,
      labelsJson: true,
      checksJson: true,
      snapshotJson: true,
      stateEnteredAt: true,
      githubUpdatedAt: true,
      createdAt: true,
    },
    orderBy: { githubUpdatedAt: "desc" },
    take: 500,
  })) as WorkflowPr[];

  if (prs.length === 0) return null;

  const startedAt = Date.now();
  const readiness = buildReleaseReadiness({
    prs,
    structure: readStructure(repo.insight.structure),
    insight: {
      lastReleaseTag: repo.insight.lastReleaseTag,
      lastReleaseAt: repo.insight.lastReleaseAt,
      mergedLast30Days: repo.insight.mergedLast30Days,
    },
    now: new Date(),
  });

  const implications = releaseImplications(prs, readStructure(repo.insight.structure));
  readiness.sections.push({
    key: "change_implications",
    title: "What changed in this window",
    basis:
      implications.pathCount > 0
        ? `Derived from the file lists recorded on ${implications.pathCount} changed path${implications.pathCount === 1 ? "" : "s"} across merged pull requests.`
        : "No merged pull request in this window recorded a file list, so documentation and test coverage cannot be assessed from it.",
    items: implications.findings.map((f) => ({ label: f.title, detail: f.basis, href: null })),
  });

  metrics.workflowRun("release_readiness", true, Date.now() - startedAt);
  logger.info("release-readiness-built", {
    repoId,
    merged: readiness.mergedSinceLastRelease,
    blockers: readiness.blockers.length,
  });
  return readiness;
}
