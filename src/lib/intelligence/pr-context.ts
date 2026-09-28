import { prisma } from "../db";
import { authorizedRepo } from "../queries/intelligence";
import type { SessionUser } from "../auth/session";
import { analyzeChangeImpact, type ChangeImpactResult } from "./impact";
import { whatBrokeForRepo, type WhatBrokeResult } from "./whatbroke";
import { buildReviewBrief, type InsightDigestPayload } from "./briefing";
import { readStructure } from "./profile";
import { likelyOwners } from "./codeowners";

/**
 * Smart PR Context & Review Preparation:
 * Eliminates developer manual context reconstruction by correlating
 * pull request metadata, check runs, code relationships, and repository intelligence.
 *
 * Strict Rule: Baton never presents an assumption as a confirmed fact.
 * Every observation is strictly tagged as FACT or INFERENCE.
 */

export interface FactItem {
  id: string;
  category: string;
  label: string;
  value: string;
  evidenceUrl?: string;
}

export interface InferenceItem {
  id: string;
  confidence: "high" | "medium" | "low";
  claim: string;
  basis: string;
  suggestedAction?: string;
}

export interface SmartPrContextView {
  pr: {
    id: string;
    number: number;
    title: string;
    url: string;
    authorLogin: string;
    headRef: string;
    headSha: string;
    baseRef: string;
    state: string;
    githubState: string;
    isDraft: boolean;
    mergeableState: string | null;
    reviewDecision: string | null;
    stateEnteredAt: Date;
    githubUpdatedAt: Date;
    requestedReviewers: string[];
    labels: string[];
  };
  repo: {
    id: string;
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  };
  facts: FactItem[];
  inferences: InferenceItem[];
  reviewBrief: InsightDigestPayload | null;
  impactAnalysis: ChangeImpactResult | null;
  whatBroke: WhatBrokeResult | null;
  nextActions: {
    label: string;
    description: string;
    targetUrl: string;
    type: "review" | "ci_fix" | "merge" | "update_docs" | "author_action";
  }[];
  isPreservedContext: boolean;
  preservedContextId?: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Extract referenced GitHub issue numbers from title, body, or branch name.
 * e.g., "fixes #142", "closes #55", "issue-99"
 */
function extractLinkedIssues(title: string, branch: string): number[] {
  const text = `${title} ${branch}`;
  const matches = text.match(/(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#|#|issue-)(\d+)/gi);
  if (!matches) return [];
  const numbers: number[] = [];
  for (const m of matches) {
    const num = parseInt(m.replace(/\D/g, ""), 10);
    if (!Number.isNaN(num) && num > 0) numbers.push(num);
  }
  return [...new Set(numbers)];
}

export async function getSmartPrContext(
  user: SessionUser,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<SmartPrContextView | null> {
  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return null;

  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId: repoRow.id, number: prNumber } },
  });
  if (!pr) return null;

  const insight = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRow.id },
    include: {
      evidence: { select: { id: true, kind: true, label: true, rank: true, url: true } },
    },
  });

  const requestedReviewers = parseJson<string[]>(pr.requestedReviewersJson, []);
  const labels = parseJson<string[]>(pr.labelsJson, []);
  const checks = parseJson<any[]>(pr.checksJson, []);
  const snapshot = parseJson<any>(pr.snapshotJson, {});

  const facts: FactItem[] = [
    {
      id: "f-branch",
      category: "Git Metadata",
      label: "Branches",
      value: `${pr.headRef} → ${pr.baseRef} @ ${pr.headSha.slice(0, 7)}`,
      evidenceUrl: `${pr.url}/commits`,
    },
    {
      id: "f-author",
      category: "Authorship",
      label: "Author",
      value: `@${pr.authorLogin}`,
      evidenceUrl: `https://github.com/${pr.authorLogin}`,
    },
    {
      id: "f-state",
      category: "Baton Lifecycle",
      label: "Baton State",
      value: `baton:${pr.state.toLowerCase().replace(/_/g, "-")}`,
    },
  ];

  if (pr.reviewDecision) {
    facts.push({
      id: "f-review-decision",
      category: "Review Status",
      label: "Review Decision",
      value: pr.reviewDecision,
      evidenceUrl: pr.url,
    });
  }

  if (checks.length > 0) {
    const passed = checks.filter((c) => c.conclusion === "SUCCESS").length;
    const failed = checks.filter((c) => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT").length;
    facts.push({
      id: "f-checks",
      category: "CI Checks",
      label: "Executed Checks",
      value: `${passed} passed, ${failed} failed, ${checks.length - passed - failed} pending/other`,
      evidenceUrl: `${pr.url}/checks`,
    });
  }

  const inferences: InferenceItem[] = [];

  // Related issues (aa.md §11).
  //
  // Two tiers, and the difference matters. GitHub's `closingIssuesReferences` is
  // a fact: it is the connection GitHub itself maintains, populated either by
  // the linking UI or by a closing keyword. The keyword scan is a guess that
  // both over- and under-matches, so it is only used when the snapshot predates
  // the field, and it is labelled as what it is.
  const authoritativeIssues = Array.isArray(snapshot.linkedIssues) ? snapshot.linkedIssues : null;
  if (authoritativeIssues && authoritativeIssues.length > 0) {
    for (const issue of authoritativeIssues) {
      facts.push({
        id: `f-issue-${issue.number}`,
        category: "Related Issues",
        label: `Closes #${issue.number}: ${issue.title}`,
        value: `Issue is ${String(issue.state ?? "unknown").toLowerCase()}`,
        evidenceUrl: issue.url ?? `${pr.url}`,
      });
    }
  } else {
    const linkedIssues = extractLinkedIssues(pr.title, pr.headRef);
    if (linkedIssues.length > 0) {
      inferences.push({
        id: "inf-issues",
        confidence: "medium",
        claim: `Mentions issue number(s) #${linkedIssues.join(", #")} in its text`,
        basis:
          "Scanned the title and branch name for issue keywords. GitHub reports no closing issue for this pull request, so this is a possible reference, not a confirmed link.",
        suggestedAction: `Open #${linkedIssues[0]} and confirm it is the intended counterpart before closing anything.`,
      });
    }
  }

  // Likely owners (aa.md §8 "identify CODEOWNERS affected by changes", §11
  // "likely owners"). This is a FACT, not an inference: the repository states
  // the rule and the changed files are known, so the result is exact.
  if (insight) {
    const structure = readStructure(insight.structure);
    const changedPaths = Array.isArray(snapshot.files)
      ? (snapshot.files as { path?: string }[]).map((f) => f?.path).filter((p): p is string => typeof p === "string")
      : [];
    const owners = likelyOwners(structure.codeowners, changedPaths);
    for (const [i, o] of owners.entries()) {
      facts.push({
        id: `f-owner-${i}`,
        category: "Likely Owners",
        label: `${o.owner} owns ${o.paths.length} of the changed file${o.paths.length === 1 ? "" : "s"}`,
        value: o.paths.slice(0, 3).join(", ") + (o.paths.length > 3 ? `, +${o.paths.length - 3} more` : ""),
        evidenceUrl: `${pr.url}/files`,
      });
    }
  }

  // Branch intent inference
  const lowerBranch = pr.headRef.toLowerCase();
  if (lowerBranch.startsWith("fix/") || lowerBranch.startsWith("bugfix/")) {
    inferences.push({
      id: "inf-intent",
      confidence: "medium",
      claim: "Change appears intended as a bug fix or patch.",
      basis: `Branch naming prefix '${pr.headRef.split("/")[0]}/'`,
      suggestedAction: "Verify reproduction test is included in PR.",
    });
  } else if (lowerBranch.startsWith("feat/") || lowerBranch.startsWith("feature/")) {
    inferences.push({
      id: "inf-intent",
      confidence: "medium",
      claim: "Change appears intended as a new feature or enhancement.",
      basis: `Branch naming prefix '${pr.headRef.split("/")[0]}/'`,
      suggestedAction: "Verify documentation and test coverage accompany the feature.",
    });
  }

  // Review Brief
  let reviewBrief: InsightDigestPayload | null = null;
  if (insight) {
    const ageDays = Math.max(0, Math.floor((Date.now() - pr.stateEnteredAt.getTime()) / 86_400_000));
    reviewBrief = buildReviewBrief(
      {
        id: insight.id,
        repoId: repoRow.id,
        revision: insight.revision,
        description: insight.description,
        topics: insight.topics,
        languages: insight.languages,
        hasReadme: insight.hasReadme,
        hasCodeowners: insight.hasCodeowners,
        hasContributing: insight.hasContributing,
        hasCiWorkflows: insight.hasCiWorkflows,
        hasSecurityPolicy: insight.hasSecurityPolicy,
        hasLicense: insight.hasLicense,
        defaultBranch: insight.defaultBranch,
        openPullRequests: insight.openPullRequests,
        openIssues: insight.openIssues,
        mergedLast30Days: insight.mergedLast30Days,
        contributorCount: insight.contributorCount,
        topContributors: insight.topContributors,
        lastReleaseTag: insight.lastReleaseTag,
        lastReleaseAt: insight.lastReleaseAt,
        structure: insight.structure,
        evidence: insight.evidence,
      },
      {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        additions: snapshot.additions ?? null,
        deletions: snapshot.deletions ?? null,
        changedFiles: snapshot.changedFiles ?? null,
        authorLogin: pr.authorLogin,
        requestedReviewers,
        ageDays,
      },
    );
  }

  // Change Impact Analysis (extract changed paths from snapshot if available, or branch paths)
  const changedPaths: string[] = Array.isArray(snapshot.files)
    ? snapshot.files.map((f: any) => (typeof f === "string" ? f : f?.path ?? ""))
    : [];
  const impactAnalysis = analyzeChangeImpact(changedPaths);

  // What Broke? (if CI failing)
  let brokenSummary: WhatBrokeResult | null = null;
  if (pr.state === "ci_failing" || checks.some((c) => c.conclusion === "FAILURE")) {
    brokenSummary = await whatBrokeForRepo(repoRow.id, pr.number);
  }

  // Check if user has a saved context for this PR
  const existingContext = await prisma.workContext.findFirst({
    where: {
      userId: user.id,
      repoId: repoRow.id,
      targetUrl: `/dashboard/repos/${owner}/${repo}/pulls/${pr.number}`,
    },
    select: { id: true },
  });

  // Next recommended actions
  const nextActions: SmartPrContextView["nextActions"] = [];

  if (pr.state === "ci_failing") {
    nextActions.push({
      label: "Investigate CI Failure",
      description: "Inspect the failing check runs and annotations surfaced in What Broke?",
      targetUrl: `${pr.url}/checks`,
      type: "ci_fix",
    });
  } else if (pr.state === "changes_required") {
    nextActions.push({
      label: "Address Review Feedback",
      description: "Push changes responding to reviewer comments to advance to awaiting_review_after_fix.",
      targetUrl: pr.url,
      type: "author_action",
    });
  } else if (pr.state === "awaiting_review" || pr.state === "awaiting_review_after_fix") {
    const isAuthor = user.login === pr.authorLogin;
    if (isAuthor && requestedReviewers.length === 0) {
      nextActions.push({
        label: "Request Reviewers",
        description: "Assign domain reviewers or CODEOWNERS to unblock this pull request.",
        targetUrl: pr.url,
        type: "review",
      });
    } else {
      nextActions.push({
        label: "Submit Review on GitHub",
        description: "Complete review to move PR toward ready_to_merge or request modifications.",
        targetUrl: pr.url,
        type: "review",
      });
    }
  } else if (pr.state === "ready_to_merge") {
    nextActions.push({
      label: "Merge Pull Request",
      description: "All checks passed and approvals satisfied. Merge to trunk.",
      targetUrl: pr.url,
      type: "merge",
    });
  }

  return {
    pr: {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      authorLogin: pr.authorLogin,
      headRef: pr.headRef,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
      state: pr.state,
      githubState: pr.githubState,
      isDraft: pr.isDraft,
      mergeableState: pr.mergeableState,
      reviewDecision: pr.reviewDecision,
      stateEnteredAt: pr.stateEnteredAt,
      githubUpdatedAt: pr.githubUpdatedAt,
      requestedReviewers,
      labels,
    },
    repo: {
      id: repoRow.id,
      owner: repoRow.owner,
      name: repoRow.name,
      fullName: repoRow.fullName,
      defaultBranch: repoRow.defaultBranch,
    },
    facts,
    inferences,
    reviewBrief,
    impactAnalysis,
    whatBroke: brokenSummary,
    nextActions,
    isPreservedContext: Boolean(existingContext),
    preservedContextId: existingContext?.id,
  };
}
