import { prisma } from "../db";
import { myInstallations } from "../queries/dashboard";
import type { SessionUser } from "../auth/session";

/**
 * Cross-Repository Context:
 * Connects intelligence across multiple repositories in an organization or workspace.
 * Identifies shared dependencies, cross-repository bottlenecks, common maintainers,
 * and multi-repo health trends without manual tool-hopping.
 */

export interface SharedTechnology {
  name: string;
  repoCount: number;
  repos: string[];
}

export interface CrossRepoBottleneck {
  repo: string;
  issue: string;
  severity: "high" | "medium";
  recommendation: string;
}

export interface CrossRepoIntelligence {
  totalRepos: number;
  totalOpenPrs: number;
  stalledPrsCount: number;
  ciFailingPrsCount: number;
  sharedTechnologies: SharedTechnology[];
  bottlenecks: CrossRepoBottleneck[];
  activeMaintainers: { login: string; repoCount: number }[];
  repoSummaries: {
    owner: string;
    name: string;
    openPrs: number;
    hasCi: boolean;
    hasCodeowners: boolean;
    primaryLanguage: string;
  }[];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function getCrossRepoIntelligence(user: SessionUser): Promise<CrossRepoIntelligence> {
  const installations = await myInstallations(user);
  const repoIds = installations.flatMap((i) => i.repos.map((r) => r.id));

  if (repoIds.length === 0) {
    return {
      totalRepos: 0,
      totalOpenPrs: 0,
      stalledPrsCount: 0,
      ciFailingPrsCount: 0,
      sharedTechnologies: [],
      bottlenecks: [],
      activeMaintainers: [],
      repoSummaries: [],
    };
  }

  const [repos, prs] = await Promise.all([
    prisma.repo.findMany({
      where: { id: { in: repoIds }, enabled: true },
      include: {
        insight: {
          select: {
            languages: true,
            structure: true,
            hasCiWorkflows: true,
            hasCodeowners: true,
            hasReadme: true,
            topContributors: true,
            mergedLast30Days: true,
          },
        },
      },
    }),
    prisma.pullRequest.findMany({
      where: { repoId: { in: repoIds }, githubState: "OPEN", isDraft: false },
      select: {
        id: true,
        repoId: true,
        state: true,
        stateEnteredAt: true,
      },
    }),
  ]);

  const totalRepos = repos.length;
  const totalOpenPrs = prs.length;
  const stalledPrsCount = prs.filter((p) => (Date.now() - p.stateEnteredAt.getTime()) / 3_600_000 >= 24).length;
  const ciFailingPrsCount = prs.filter((p) => p.state === "ci_failing").length;

  // Aggregate shared technologies
  const techMap = new Map<string, Set<string>>();
  const maintainerMap = new Map<string, Set<string>>();
  const bottlenecks: CrossRepoBottleneck[] = [];

  const repoSummaries = repos.map((r) => {
    const prCount = prs.filter((p) => p.repoId === r.id).length;
    const languages = parseJson<{ name: string; percent: number }[]>(r.insight?.languages ?? "[]", []);
    const primaryLanguage = languages[0]?.name ?? "Unknown";

    if (languages.length > 0) {
      for (const lang of languages) {
        if (lang.percent >= 10) {
          const set = techMap.get(lang.name) ?? new Set();
          set.add(`${r.owner}/${r.name}`);
          techMap.set(lang.name, set);
        }
      }
    }

    if (r.insight) {
      const contribs = parseJson<{ login: string; commits: number }[]>(r.insight.topContributors, []);
      for (const c of contribs.slice(0, 3)) {
        const set = maintainerMap.get(c.login) ?? new Set();
        set.add(`${r.owner}/${r.name}`);
        maintainerMap.set(c.login, set);
      }

      if (!r.insight.hasCiWorkflows) {
        bottlenecks.push({
          repo: `${r.owner}/${r.name}`,
          issue: "No automated CI workflows configured",
          severity: "high",
          recommendation: "Add GitHub Actions workflow to establish reproducible PR quality gates.",
        });
      }
      if (!r.insight.hasCodeowners) {
        bottlenecks.push({
          repo: `${r.owner}/${r.name}`,
          issue: "No CODEOWNERS file present",
          severity: "medium",
          recommendation: "Define ownership rules to automate reviewer routing and prevent stalls.",
        });
      }
      if (r.insight.mergedLast30Days === 0 && prCount > 0) {        bottlenecks.push({
          repo: `${r.owner}/${r.name}`,
          issue: "Zero merges in the last 30 days despite open PRs",
          severity: "high",
          recommendation: "Review stale pull requests to verify if project review pipeline is blocked.",
        });
      }
    }

    return {
      owner: r.owner,
      name: r.name,
      openPrs: prCount,
      hasCi: r.insight?.hasCiWorkflows ?? false,
      hasCodeowners: r.insight?.hasCodeowners ?? false,
      primaryLanguage,
    };
  });

  const sharedTechnologies: SharedTechnology[] = Array.from(techMap.entries())
    .filter(([, set]) => set.size >= 2)
    .map(([name, set]) => ({
      name,
      repoCount: set.size,
      repos: Array.from(set),
    }))
    .sort((a, b) => b.repoCount - a.repoCount);

  const activeMaintainers = Array.from(maintainerMap.entries())
    .map(([login, set]) => ({
      login,
      repoCount: set.size,
    }))
    .filter((m) => m.repoCount >= 2)
    .sort((a, b) => b.repoCount - a.repoCount);

  return {
    totalRepos,
    totalOpenPrs,
    stalledPrsCount,
    ciFailingPrsCount,
    sharedTechnologies,
    bottlenecks: bottlenecks.slice(0, 10),
    activeMaintainers,
    repoSummaries,
  };
}
