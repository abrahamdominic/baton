import type { graphql } from "@octokit/graphql";
import type { SnapshotInput } from "../engine/types";
import { isBotLogin } from "../engine/classification";

const PR_SNAPSHOT_QUERY = `
query PullRequestSnapshot($owner: String!, $repo: String!, $number: Int!) {
  rateLimit { remaining }
  repository(owner: $owner, name: $repo) {
    id
    pullRequest(number: $number) {
      ...pullRequestNode
    }
  }
}

fragment pullRequestNode on PullRequest {
  id
  number
  title
  url
  state
  isDraft
  createdAt
  updatedAt
  author { login }
  headRefName
  baseRefName
  headRefOid
  mergeable
  reviewDecision
  additions
  deletions
  changedFiles
  labels(first: 50) { nodes { name } }
  comments { totalCount }
  # Authoritative issue linkage. Previously Baton inferred this from a regex
  # over the title and branch name, which both over- and under-matched: a PR
  # titled "fixes the #42 crash" is linked to 42 whether or not 42 exists, and a
  # PR that genuinely closes an issue through the GitHub UI has no such keyword
  # at all. GitHub already knows the real answer; this asks for it.
  closingIssuesReferences(first: 10) {
    nodes { number title url state }
  }
  reviews(last: 20) {
    nodes {
      author { login }
      state
      submittedAt
    }
  }
  reviewRequests(first: 20) {
    nodes {
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { slug }
      }
    }
  }
  commits(last: 1) {
    nodes { commit { pushedDate } }
  }
  files(first: 100) {
    pageInfo { hasNextPage }
    nodes {
      path
      additions
      deletions
      changeType
    }
  }
  latestCheckRuns(first: 50) {
    nodes {
      name
      status
      conclusion
      detailsUrl
      summary { state title text }
      startedAt
      completedAt
      checkSuite { app { slug name } }
    }
  }
}
`;

interface GraphqlPullRequestNode {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  labels: { nodes: { name: string }[] };
  comments: { totalCount: number };
  closingIssuesReferences?: { nodes: { number: number; title: string; url: string; state: string }[] };
  reviews: {
    nodes: {
      author: { login: string } | null;
      state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
      submittedAt: string | null;
    }[];
  };
  reviewRequests: {
    nodes: {
      requestedReviewer: { __typename: string; login?: string; slug?: string } | null;
    }[];
  };
  commits: { nodes: { commit: { pushedDate: string | null } }[] };
  additions: number;
  deletions: number;
  changedFiles: number;
  files: {
    pageInfo: { hasNextPage: boolean };
    nodes: {
      path: string;
      additions: number;
      deletions: number;
      changeType: string | null;
    }[];
  };
  latestCheckRuns: {
    nodes: {
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
      summary: { state: string | null; title: string | null; text: string | null } | null;
      startedAt: string | null;
      completedAt: string | null;
      checkSuite: { app: { slug: string | null; name: string | null } | null } | null;
    }[];
  };
}

export interface SnapshotQueryResult {
  input: SnapshotInput;
  rateLimitRemaining: number | null;
  rawNodeId: string | null;
  /** Raw merged payload archived for debugging. */
  raw: unknown;
}

export { PR_SNAPSHOT_QUERY };

type QueryFn = (query: string, variables: Record<string, unknown>) => Promise<SnapshotQueryData>;

interface SnapshotQueryData {
  repository?: { pullRequest?: GraphqlPullRequestNode | null } | null;
  rateLimit?: { remaining?: number | null } | null;
}

export function fetchPrSnapshot(
  gql: typeof graphql,
  owner: string,
  repo: string,
  number: number,
  now: Date,
): Promise<SnapshotQueryResult | null> {
  const call = gql as unknown as QueryFn;
  return call(PR_SNAPSHOT_QUERY, { owner, repo, number }).then((data) => {
    const pr = data?.repository?.pullRequest ?? null;
    const remaining = data?.rateLimit?.remaining ?? null;
    if (!pr) return null;

    return {
      input: toSnapshotInput(pr, now),
      rateLimitRemaining: remaining,
      rawNodeId: pr.id ?? null,
      raw: pr,
    };
  });
}

export function toSnapshotInput(
  pr: GraphqlPullRequestNode,
  now: Date,
): SnapshotInput {
  const reviews = (pr.reviews?.nodes ?? [])
    .filter((r) => r.author?.login)
    .map((r) => ({
      state: r.state,
      authorLogin: r.author!.login,
      submittedAt: r.submittedAt,
      isBot: isBotLogin(r.author!.login),
    }));

  const reviewerLogins: string[] = [];
  const teamSlugs: string[] = [];
  for (const n of pr.reviewRequests?.nodes ?? []) {
    const rr = n.requestedReviewer;
    if (!rr) continue;
    if (rr.__typename === "Team") {
      if (rr.slug) teamSlugs.push(rr.slug);
    } else if (rr.login) {
      reviewerLogins.push(rr.login);
    }
  }

  const checks = (pr.latestCheckRuns?.nodes ?? []).map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    appSlug: c.checkSuite?.app?.slug ?? null,
    detailsUrl: c.detailsUrl ?? null,
    summary: [c.summary?.title, c.summary?.text].filter(Boolean).join(": ") || null,
    startedAt: c.startedAt ?? null,
    completedAt: c.completedAt ?? null,
  }));

  // A pull request always has a file list on GitHub; `nodes` is empty only for a
  // PR with no changes. Guard anyway so a malformed response degrades to
  // "unknown" rather than to a confident zero.
  const files = Array.isArray(pr.files?.nodes)
    ? pr.files.nodes.map((f) => ({
        path: f.path,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        changeType: f.changeType ?? null,
      }))
    : null;

  return {
    prNumber: pr.number,
    title: pr.title,
    url: pr.url,
    authorLogin: pr.author?.login ?? "unknown",
    headRef: pr.headRefName,
    headSha: pr.headRefOid,
    baseRef: pr.baseRefName,
    isDraft: pr.isDraft,
    githubState: pr.state,
    mergeable: pr.mergeable,
    reviewDecision: pr.reviewDecision ?? "",
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headPushedAt: pr.commits?.nodes?.[0]?.commit?.pushedDate ?? null,
    labels: pr.labels?.nodes?.map((l) => l.name) ?? [],
    reviews,
    requestedReviewerLogins: reviewerLogins,
    requestedTeamSlugs: teamSlugs,
    checks,
    files,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    linkedIssues:
      pr.closingIssuesReferences?.nodes?.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.url,
        state: i.state,
      })) ?? null,
    changedFiles: pr.changedFiles ?? null,
    now,
  };
}