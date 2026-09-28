import { prisma } from "../db";
import { authorizedRepo } from "../queries/intelligence";
import type { SessionUser } from "../auth/session";
import { readStructure } from "./profile";

/**
 * Automatic Repository Onboarding Guide:
 * Transforms raw repository intelligence into a structured, evidence-backed
 * onboarding curriculum for new developers and team members.
 */

export interface ArchitectureModule {
  name: string;
  path: string;
  role: string;
  importance: "critical" | "high" | "standard";
}

export interface SetupStep {
  step: number;
  title: string;
  command?: string;
  description: string;
  evidencePath?: string;
}

export interface ReadingItem {
  path: string;
  title: string;
  reason: string;
  url?: string;
}

export interface CommonPitfall {
  pitfall: string;
  recommendation: string;
  severity: "high" | "medium" | "low";
}

export interface OnboardingGuide {
  repoName: string;
  fullName: string;
  description: string;
  defaultBranch: string;
  revision: number;
  techStack: {
    primaryLanguage: string;
    languages: { name: string; percent: number }[];
    packageManager: string;
  };
  architectureMap: ArchitectureModule[];
  setupWorkflow: SetupStep[];
  testingWorkflow: {
    testFramework: string;
    command: string;
    details: string;
    evidencePath?: string;
  };
  deployWorkflow: {
    ciProvider: string;
    workflows: string[];
    details: string;
  };
  keyOwners: {
    login: string;
    commits: number;
    hasCodeowners: boolean;
  }[];
  readingList: ReadingItem[];
  pitfalls: CommonPitfall[];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function buildOnboardingGuide(
  repo: { name: string; fullName: string; defaultBranch: string },
  insight: {
    description: string | null;
    languages: string;
    structure: string;
    hasReadme: boolean;
    hasCodeowners: boolean;
    hasContributing: boolean;
    hasCiWorkflows: boolean;
    hasSecurityPolicy: boolean;
    hasLicense: boolean;
    topContributors: string;
    revision: number;
    evidence: { id: string; kind: string; label: string; path: string | null; url: string | null }[];
  },
): OnboardingGuide {
  const languages = parseJson<{ name: string; percent: number }[]>(insight.languages, []);
  const structure = readStructure(insight.structure);
  const contributors = parseJson<{ login: string; commits: number }[]>(insight.topContributors, []);

  const primaryLanguage = languages[0]?.name ?? "TypeScript";

  // Package manager comes from the collected profile, which reads the lockfile
  // out of the file tree. This used to scan `topLevel`, which only ever holds
  // trunk *directories*, so the lookup could never match and every repository
  // was reported as npm regardless of its actual lockfile.
  //
  // "unknown" is deliberately not "npm": telling a developer to run `npm
  // install` in a pnpm repository sends them down a wrong path immediately.
  const packageManager = structure.profile.packageManager ?? "unknown";

  // Architecture Map derived from discovered top-level directories
  const architectureMap: ArchitectureModule[] = [];
  const knownDirs = structure.topLevel;

  for (const dir of knownDirs) {
    const lower = dir.toLowerCase();
    if (lower === "src") {
      architectureMap.push({
        name: "Application Core",
        path: "src/",
        role: "Contains primary business logic, domain models, APIs, and UI components.",
        importance: "critical",
      });
    } else if (lower === "prisma" || lower === "migrations" || lower === "db") {
      architectureMap.push({
        name: "Database & Schema",
        path: `${dir}/`,
        role: "Data persistence schema, relational migrations, and ORM configuration.",
        importance: "critical",
      });
    } else if (lower === "app" || lower === "pages") {
      architectureMap.push({
        name: "Routes & Layouts",
        path: `${dir}/`,
        role: "HTTP routing endpoints, server actions, and frontend page views.",
        importance: "high",
      });
    } else if (lower === "lib" || lower === "packages") {
      architectureMap.push({
        name: "Shared Libraries",
        path: `${dir}/`,
        role: "Reusable utility functions, service clients, and internal SDKs.",
        importance: "high",
      });
    } else if (lower === "scripts") {
      architectureMap.push({
        name: "Automation Scripts",
        path: "scripts/",
        role: "Build tooling, test mirrors, seeding, and migration runners.",
        importance: "standard",
      });
    } else if (lower === "docs") {
      architectureMap.push({
        name: "Documentation",
        path: "docs/",
        role: "Architecture specifications, RFCs, and API documentation.",
        importance: "standard",
      });
    }
  }

  // Setup Workflow
  const setupWorkflow: SetupStep[] = [
    {
      step: 1,
      title: "Clone & Environment Setup",
      command: `git clone https://github.com/${repo.fullName}.git && cd ${repo.name}`,
      description: "Clone repository locally and switch to the root workspace directory.",
    },
    {
      step: 2,
      title: "Install Dependencies",
      command: `${packageManager} install`,
      description: `Install locked dependencies via ${packageManager}.`,
    },
  ];

  if (structure.topLevel.includes("prisma")) {
    setupWorkflow.push({
      step: 3,
      title: "Initialize Database & Client",
      command: "npm run db:generate",
      description: "Generate Prisma type definitions from schema.prisma.",
      evidencePath: "prisma/schema.prisma",
    });
  }

  setupWorkflow.push({
    step: setupWorkflow.length + 1,
    title: "Verify Test Suite",
    command: `${packageManager} test`,
    description: "Run automated tests to confirm local environment passes all assertions.",
  });

  // Testing Workflow
  let testFramework = "Vitest / Jest";
  let testCmd = `${packageManager} test`;
  if (primaryLanguage === "Rust") {
    testFramework = "Cargo Test";
    testCmd = "cargo test";
  } else if (primaryLanguage === "Go") {
    testFramework = "Go Test";
    testCmd = "go test ./...";
  } else if (primaryLanguage === "Python") {
    testFramework = "Pytest";
    testCmd = "pytest";
  }

  const testingWorkflow = {
    testFramework,
    command: testCmd,
    details: "Always execute unit and database integration suites prior to opening pull requests.",
  };

  // Deploy Workflow
  const deployWorkflow = {
    ciProvider: insight.hasCiWorkflows ? "GitHub Actions" : "Manual / External",
    workflows: structure.workflowNames,
    details: insight.hasCiWorkflows
      ? `CI runs automatically on push and PR events through ${structure.workflowNames.length} workflow file(s).`
      : "No GitHub Actions workflows configured in default branch.",
  };

  // Reading List
  const readingList: ReadingItem[] = [];
  if (insight.hasReadme) {
    const readmeEv = insight.evidence.find((e) => e.kind === "readme");
    readingList.push({
      path: readmeEv?.path ?? "README.md",
      title: "Project README",
      reason: "Official project overview, mission, and quick start guide.",
      url: readmeEv?.url ?? undefined,
    });
  }
  if (insight.hasContributing) {
    const contEv = insight.evidence.find((e) => e.kind === "contributing");
    readingList.push({
      path: contEv?.path ?? "CONTRIBUTING.md",
      title: "Contributing Guide",
      reason: "Branching strategies, commit conventions, and PR expectations.",
      url: contEv?.url ?? undefined,
    });
  }
  if (insight.hasSecurityPolicy) {
    const secEv = insight.evidence.find((e) => e.kind === "security");
    readingList.push({
      path: secEv?.path ?? "SECURITY.md",
      title: "Security Policy",
      reason: "Vulnerability reporting protocols and disclosure requirements.",
      url: secEv?.url ?? undefined,
    });
  }

  // Key Owners
  const keyOwners = contributors.slice(0, 5).map((c) => ({
    login: c.login,
    commits: c.commits,
    hasCodeowners: insight.hasCodeowners,
  }));

  // Common Pitfalls
  const pitfalls: CommonPitfall[] = [];
  if (!insight.hasCodeowners) {
    pitfalls.push({
      pitfall: "Missing CODEOWNERS configuration",
      recommendation: "Tag relevant domain maintainers manually on PRs to prevent review stalls.",
      severity: "medium",
    });
  }
  if (structure.topLevel.includes("prisma")) {
    pitfalls.push({
      pitfall: "Database schema drift between environments",
      recommendation: "Always generate migration files (`prisma migrate dev`) rather than directly altering tables.",
      severity: "high",
    });
  }
  if (!insight.hasCiWorkflows) {
    pitfalls.push({
      pitfall: "No automated CI workflows in repository",
      recommendation: "Run all linting and test commands locally before merging changes.",
      severity: "high",
    });
  }
  if (!structure.profile.hasTests) {
    pitfalls.push({
      pitfall: "No test files were found in the default branch",
      recommendation:
        "There is no automated safety net here. Verify behaviour manually and treat regressions as expected.",
      severity: "high",
    });
  } else if (!structure.profile.testFramework) {
    pitfalls.push({
      pitfall: "Test files exist but no test runner is configured in the repository root",
      recommendation:
        "Confirm the runner CI actually invokes before assuming `npm test` works; a green local run may not reflect CI.",
      severity: "medium",
    });
  }
  if (!structure.profile.hasEnvExample) {
    pitfalls.push({
      pitfall: "No example environment file is published",
      recommendation:
        "Ask a maintainer which environment variables are required; configuration drift is easy to introduce here.",
      severity: "medium",
    });
  }
  if (structure.profile.hasTests && !structure.profile.lintTool) {
    pitfalls.push({
      pitfall: "No linter is configured in the repository root",
      recommendation: "Match the existing code style by hand; there is no automated style gate to satisfy.",
      severity: "low",
    });
  }
  for (const area of structure.profile.staleAreas.slice(0, 2)) {
    pitfalls.push({
      pitfall: `${area.area === "(root)" ? "Trunk-level files" : area.area} has not changed in the sampled history`,
      recommendation: `Last change was ${area.daysSince} days ago, so this area is unfamiliar ground. Confirm ownership before modifying it.`,
      severity: "low",
    });
  }

  return {
    repoName: repo.name,
    fullName: repo.fullName,
    description: insight.description ?? "No description published on GitHub.",
    defaultBranch: repo.defaultBranch,
    revision: insight.revision,
    techStack: {
      primaryLanguage,
      languages,
      packageManager,
    },
    architectureMap,
    setupWorkflow,
    testingWorkflow,
    deployWorkflow,
    keyOwners,
    readingList,
    pitfalls,
  };
}

export async function getOnboardingGuideForRepo(
  user: SessionUser,
  owner: string,
  repo: string,
): Promise<OnboardingGuide | null> {
  const repoRow = await authorizedRepo(user, owner, repo);
  if (!repoRow) return null;

  const insight = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRow.id },
    include: { evidence: { select: { id: true, kind: true, label: true, path: true, url: true } } },
  });
  if (!insight) return null;

  return buildOnboardingGuide(
    { name: repoRow.name, fullName: repoRow.fullName, defaultBranch: repoRow.defaultBranch },
    {
      description: insight.description,
      languages: insight.languages,
      structure: insight.structure,
      hasReadme: insight.hasReadme,
      hasCodeowners: insight.hasCodeowners,
      hasContributing: insight.hasContributing,
      hasCiWorkflows: insight.hasCiWorkflows,
      hasSecurityPolicy: insight.hasSecurityPolicy,
      hasLicense: insight.hasLicense,
      topContributors: insight.topContributors,
      revision: insight.revision,
      evidence: insight.evidence,
    },
  );
}
