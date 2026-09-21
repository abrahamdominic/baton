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
  labels(first: 50) { nodes { name } }
  comments { totalCount }
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
  latestCheckRuns(first: 50) {
    nodes {
      name
      status
      conclusion
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
  latestCheckRuns: {
    nodes: {
      name: string;
      status: string;
      conclusion: string | null;
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
  }));

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
    now,
  };
}