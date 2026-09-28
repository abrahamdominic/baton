import { prisma } from "../db";
import { myInstallations } from "./dashboard";
import type { SessionUser } from "../auth/session";

/**
 * Read side for repository intelligence.
 *
 * Authorization is delegated to `myInstallations` — the single source of truth
 * for "which installations may this user see" — rather than re-implemented here.
 * A second, subtly different copy of that rule is how IDOR bugs get written, so
 * this module resolves the repository through the same query the dashboard uses
 * and returns `null` when it is not visible.
 */

export interface IntelligenceEvidenceView {
  id: string;
  kind: string;
  label: string;
  path: string | null;
  ref: string | null;
  url: string | null;
  rank: number;
}

export interface IntelligenceView {
  repo: { id: string; owner: string; name: string; fullName: string; defaultBranch: string };
  insight: {
    description: string | null;
    homepage: string | null;
    topics: string[];
    languages: { name: string; percent: number }[];
    flags: {
      readme: boolean;
      codeowners: boolean;
      contributing: boolean;
      ci: boolean;
      securityPolicy: boolean;
      license: boolean;
    };
    defaultBranch: string | null;
    counts: {
      openPullRequests: number;
      openIssues: number;
      mergedLast30Days: number | null;
      contributors: number;
    };
    topContributors: { login: string; commits: number }[];
    lastReleaseTag: string | null;
    lastReleaseAt: Date | null;
    structure: { topLevel: string[]; workflowNames: string[] };
    revision: number;
    collectedAt: Date;
  };
  evidence: IntelligenceEvidenceView[];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Resolve a repository the user is allowed to see, or `null`. */
export async function authorizedRepo(user: SessionUser, owner: string, repo: string) {
  // `allRepos: true` matters here: an authorized user who has disabled a
  // repository can still reach its intelligence page. Filtering on `enabled`
  // made a repository the user demonstrably owns 404 with no way to tell that
  // apart from "not yours".
  const installations = await myInstallations(user, { allRepos: true });
  for (const i of installations) {
    const match = i.repos.find((r) => r.owner === owner && r.name === repo);
    if (match) return { ...match, installation: i };
  }
  return null;
}

/**
 * The full intelligence view for a repository, or `null` when the user cannot
 * see it or the repository has not been collected yet.
 */
export async function intelligenceFor(
  user: SessionUser,
  owner: string,
  repo: string,
): Promise<IntelligenceView | null> {
  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return null;

  const insight = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRow.id },
    include: { evidence: { orderBy: { rank: "asc" }, take: 200 } },
  });
  if (!insight) return null;

  return {
    repo: {
      id: repoRow.id,
      owner: repoRow.owner,
      name: repoRow.name,
      fullName: repoRow.fullName,
      defaultBranch: repoRow.defaultBranch,
    },
    insight: {
      description: insight.description,
      homepage: insight.homepage,
      topics: parseJson<string[]>(insight.topics, []),
      languages: parseJson(insight.languages, [] as { name: string; percent: number }[]),
      flags: {
        readme: insight.hasReadme,
        codeowners: insight.hasCodeowners,
        contributing: insight.hasContributing,
        ci: insight.hasCiWorkflows,
        securityPolicy: insight.hasSecurityPolicy,
        license: insight.hasLicense,
      },
      defaultBranch: insight.defaultBranch,
      counts: {
        openPullRequests: insight.openPullRequests,
        openIssues: insight.openIssues,
        mergedLast30Days: insight.mergedLast30Days,
        contributors: insight.contributorCount,
      },
      topContributors: parseJson(insight.topContributors, [] as { login: string; commits: number }[]),
      lastReleaseTag: insight.lastReleaseTag,
      lastReleaseAt: insight.lastReleaseAt,
      structure: parseJson(insight.structure, { topLevel: [], workflowNames: [] }),
      revision: insight.revision,
      collectedAt: insight.collectedAt,
    },
    evidence: insight.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      path: e.path,
      ref: e.ref,
      url: e.url,
      rank: e.rank,
    })),
  };
}

/** Resolve the evidence rows referenced by a set of digest bullets. */
export async function evidenceByIds(ids: string[]): Promise<Map<string, IntelligenceEvidenceView>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.repoEvidence.findMany({ where: { id: { in: unique } } });
  return new Map(
    rows.map((e) => [
      e.id,
      {
        id: e.id,
        kind: e.kind,
        label: e.label,
        path: e.path,
        ref: e.ref,
        url: e.url,
        rank: e.rank,
      } satisfies IntelligenceEvidenceView,
    ]),
  );
}
