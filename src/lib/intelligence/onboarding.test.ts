import { describe, it, expect } from "vitest";
import { buildOnboardingGuide } from "./onboarding";
import { deriveRepositoryProfile } from "./profile";

/**
 * A realistic collected profile, derived rather than hand-written, so the
 * fixture cannot drift from what `collect` actually stores.
 */
const profile = deriveRepositoryProfile(
  [
    "src/app/page.tsx",
    "src/lib/db.ts",
    "prisma/schema.prisma",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "src/lib/db.test.ts",
    ".github/workflows/ci.yml",
    "README.md",
  ],
  [],
  JSON.stringify({ dependencies: { next: "15.0.0", "@prisma/client": "6.0.0" } }),
);

describe("buildOnboardingGuide", () => {
  it("builds a structured onboarding curriculum from repository facts", () => {
    const guide = buildOnboardingGuide(
      { name: "baton", fullName: "abrahamdominic/baton", defaultBranch: "main" },
      {
        description: "Developer workflow platform",
        languages: JSON.stringify([{ name: "TypeScript", percent: 85 }]),
        structure: JSON.stringify({
          topLevel: ["src", "prisma"],
          workflowNames: ["ci.yml"],
          profile,
        }),
        hasReadme: true,
        hasCodeowners: true,
        hasContributing: true,
        hasCiWorkflows: true,
        hasSecurityPolicy: false,
        hasLicense: true,
        topContributors: JSON.stringify([{ login: "alice", commits: 42 }]),
        revision: 3,
        evidence: [
          { id: "e1", kind: "readme", label: "README", path: "README.md", url: "https://example.com/readme" },
        ],
      },
    );

    expect(guide.repoName).toBe("baton");
    expect(guide.techStack.primaryLanguage).toBe("TypeScript");
    expect(guide.techStack.packageManager).toBe("npm");
    expect(guide.architectureMap.length).toBeGreaterThanOrEqual(2);
    expect(guide.setupWorkflow.some((s) => s.command?.includes("db:generate"))).toBe(true);
    expect(guide.deployWorkflow.ciProvider).toBe("GitHub Actions");
    expect(guide.keyOwners[0]?.login).toBe("alice");
    expect(guide.readingList[0]?.path).toBe("README.md");
  });
});
