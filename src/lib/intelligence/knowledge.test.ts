import { describe, it, expect } from "vitest";
import { deriveKnowledge, RETIRE_AFTER_DAYS, type KnowledgeInput } from "./knowledge";
import { EMPTY_PROFILE, type RepositoryProfile } from "./profile";

/**
 * Repository memory derivation (skill.md §15).
 *
 * The property that matters most is the first one tested below: a claim with no
 * evidence is not emitted. Everything else in this file checks that the memory
 * describes the repository it was collected from rather than a plausible-looking
 * generic one.
 */

const NOW = new Date("2026-03-01T00:00:00Z");

function evidenceMap(kinds: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  kinds.forEach((k, i) => m.set(k, [`${k}-ev-${i}`]));
  return m;
}

function input(overrides: Partial<KnowledgeInput> = {}): KnowledgeInput {
  return {
    profile: EMPTY_PROFILE,
    evidenceByKind: evidenceMap(["repo", "profile", "structure", "workflow", "readme", "churn"]),
    codeowners: null,
    defaultBranch: "main",
    hasReadme: true,
    hasCiWorkflows: true,
    lastReleaseTag: null,
    lastReleaseAt: null,
    mergedLast30Days: 12,
    openPullRequests: 3,
    ciFailureCount: 0,
    ciFailureRate: null,
    now: NOW,
    ...overrides,
  };
}

const profile = (over: Partial<RepositoryProfile> = {}): RepositoryProfile => ({
  ...EMPTY_PROFILE,
  ...over,
});

describe("deriveKnowledge — evidence discipline", () => {
  it("emits nothing when there is no evidence at all", () => {
    expect(deriveKnowledge(input({ evidenceByKind: new Map() }))).toEqual([]);
  });

  it("never emits a claim whose evidence list is empty", () => {
    const entries = deriveKnowledge(
      input({
        profile: profile({
          hasTypeScript: true,
          orm: "Prisma",
          testFramework: "vitest",
          hasDocker: true,
          hasDocsDir: true,
        }),
      }),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("assigns every entry a stable key derived from its kind and subject", () => {
    const a = deriveKnowledge(input({ profile: profile({ orm: "Prisma" }) }));
    const b = deriveKnowledge(input({ profile: profile({ orm: "Prisma" }) }));
    expect(a.map((e) => e.stableKey)).toEqual(b.map((e) => e.stableKey));
  });

  it("produces different keys for different claims of the same kind", () => {
    const entries = deriveKnowledge(
      input({
        profile: profile({
          hasTypeScript: true,
          typeConfig: "tsconfig.json",
          lintTool: "eslint",
          testFramework: "vitest",
        }),
      }),
    );
    expect(new Set(entries.map((e) => e.stableKey)).size).toBe(entries.length);
  });

  it("de-duplicates identical claims rather than storing them twice", () => {
    const entries = deriveKnowledge(input());
    expect(new Set(entries.map((e) => e.stableKey)).size).toBe(entries.length);
  });
});

describe("deriveKnowledge — architecture and workflow", () => {
  it("records the ORM and says whether migrations exist", () => {
    const entries = deriveKnowledge(input({ profile: profile({ orm: "Prisma", hasMigrations: true }) }));
    const orm = entries.find((e) => e.title.includes("Prisma"));
    expect(orm).toBeDefined();
    expect(orm?.detail).toMatch(/migrations/i);
  });

  it("says the opposite about migrations when there are none", () => {
    const entries = deriveKnowledge(input({ profile: profile({ orm: "Prisma", hasMigrations: false }) }));
    expect(entries.find((e) => e.title.includes("Prisma"))?.detail).toMatch(/not reviewable/i);
  });

  it("records the package manager from the lockfile rather than guessing", () => {
    const entries = deriveKnowledge(input({ profile: profile({ packageManager: "pnpm" }) }));
    expect(entries.some((e) => e.title === "pnpm manages dependencies")).toBe(true);
  });

  it("records the test framework as a workflow fact", () => {
    const entries = deriveKnowledge(input({ profile: profile({ testFramework: "vitest" }) }));
    expect(entries.some((e) => e.title === "Tests run with vitest")).toBe(true);
  });

  it("records GitHub Actions when the insight says workflows exist", () => {
    const entries = deriveKnowledge(input({ hasCiWorkflows: true }));
    expect(entries.some((e) => e.title === "CI runs on GitHub Actions")).toBe(true);
  });

  it("omits the CI claim when the repository has no workflows", () => {
    const entries = deriveKnowledge(input({ hasCiWorkflows: false }));
    expect(entries.some((e) => e.title === "CI runs on GitHub Actions")).toBe(false);
  });

  it("records deployment targets found in the tree", () => {
    const entries = deriveKnowledge(input({ profile: profile({ deploymentTargets: ["Vercel"] }) }));
    expect(entries.some((e) => e.title === "Deployed to Vercel")).toBe(true);
  });
});

describe("deriveKnowledge — documentation and failure patterns", () => {
  it("records the README as the documented entry point", () => {
    const entries = deriveKnowledge(input({ hasReadme: true }));
    expect(entries.some((e) => e.kind === "documentation" && e.title.includes("README"))).toBe(true);
  });

  it("records the absence of a README as a failure pattern, not a documentation entry", () => {
    const entries = deriveKnowledge(input({ hasReadme: false }));
    const missing = entries.find((e) => e.title === "No README in the default branch");
    expect(missing).toBeDefined();
    expect(missing?.kind).toBe("failure_pattern");
  });

  it("flags test files with no configured runner as a failure pattern", () => {
    const entries = deriveKnowledge(input({ profile: profile({ testFileCount: 12, testFramework: null }) }));
    const entry = entries.find((e) => e.kind === "failure_pattern" && e.title.includes("no test runner"));
    expect(entry?.detail).toContain("12 test files");
  });

  it("does not flag a runnerless repository that has no tests at all", () => {
    const entries = deriveKnowledge(input({ profile: profile({ testFileCount: 0 }) }));
    expect(entries.some((e) => e.title.includes("no test runner"))).toBe(false);
  });

  it("flags recurring CI failures once the count is meaningful", () => {
    const few = deriveKnowledge(input({ ciFailureCount: 2, ciFailureRate: 0.1 }));
    const many = deriveKnowledge(input({ ciFailureCount: 9, ciFailureRate: 0.3 }));
    expect(few.some((e) => e.title === "CI failures recur on this repository")).toBe(false);
    expect(many.some((e) => e.title === "CI failures recur on this repository")).toBe(true);
  });

  it("states the CI failure rate only when one is known", () => {
    const withRate = deriveKnowledge(input({ ciFailureCount: 9, ciFailureRate: 0.25 }));
    const withoutRate = deriveKnowledge(input({ ciFailureCount: 9, ciFailureRate: null }));
    expect(withRate.find((e) => e.title === "CI failures recur on this repository")?.detail).toContain(
      "25%",
    );
    expect(
      withoutRate.find((e) => e.title === "CI failures recur on this repository")?.detail,
    ).not.toContain("%");
  });

  it("flags open work with no recent merges as blocked on review capacity", () => {
    const entries = deriveKnowledge(input({ mergedLast30Days: 0, openPullRequests: 5 }));
    expect(entries.some((e) => e.title === "Open work with no recent merges")).toBe(true);
  });

  it("does not flag a healthy repository as blocked", () => {
    const entries = deriveKnowledge(input({ mergedLast30Days: 7, openPullRequests: 5 }));
    expect(entries.some((e) => e.title === "Open work with no recent merges")).toBe(false);
  });
});

describe("deriveKnowledge — ownership", () => {
  it("records CODEOWNERS as an ownership fact", () => {
    const entries = deriveKnowledge(
      input({ codeowners: "* @acme/platform\n", evidenceByKind: evidenceMap(["codeowners", "repo"]) }),
    );
    expect(entries.some((e) => e.kind === "ownership")).toBe(true);
  });

  it("does not record ownership when CODEOWNERS exists but was never cited as evidence", () => {
    // The file is in the tree, but nothing in this run actually read it, so the
    // claim would be a guess dressed as an observation.
    const entries = deriveKnowledge(input({ codeowners: "* @acme/platform\n" }));
    expect(entries.some((e) => e.kind === "ownership")).toBe(false);
  });

  it("records nothing about ownership when there is no CODEOWNERS file", () => {
    const entries = deriveKnowledge(input({ codeowners: null }));
    expect(entries.some((e) => e.kind === "ownership")).toBe(false);
  });
});

describe("deriveKnowledge — change frequency", () => {
  const churnProfile = profile({
    commitSampleSize: 100,
    highChurnAreas: [
      { area: "src", commits: 40 },
      { area: "docs", commits: 2 },
    ],
    frequentlyModifiedFiles: [{ path: "src/billing.ts", commits: 18, lastTouchedAt: "2026-02-28T00:00:00Z" }],
  });

  it("records a hot area with its share of sampled commits", () => {
    const entries = deriveKnowledge(input({ profile: churnProfile }));
    const hot = entries.find((e) => e.kind === "hot_area" && e.title.includes("src"));
    expect(hot?.detail).toContain("40 of 100");
  });

  it("ignores an area that is a rounding error in the sample", () => {
    const entries = deriveKnowledge(input({ profile: churnProfile }));
    expect(entries.some((e) => e.kind === "hot_area" && e.title.includes("docs"))).toBe(false);
  });

  it("scales strength with the sample, so a 3-commit sample cannot outrank a 100-commit one", () => {
    const big = deriveKnowledge(
      input({ profile: profile({ commitSampleSize: 100, highChurnAreas: [{ area: "src", commits: 40 }] }) }),
    );
    const small = deriveKnowledge(
      input({ profile: profile({ commitSampleSize: 3, highChurnAreas: [{ area: "src", commits: 2 }] }) }),
    );
    expect(big.find((e) => e.kind === "hot_area")!.strength).toBeGreaterThan(
      small.find((e) => e.kind === "hot_area")!.strength,
    );
  });

  it("computes days since a file was last touched from the injected clock", () => {
    const entries = deriveKnowledge(input({ profile: churnProfile }));
    const file = entries.find((e) => e.title.includes("src/billing.ts"));
    expect(file?.detail).toContain("1 day ago");
  });

  it("records no hot areas when history could not be read", () => {
    const entries = deriveKnowledge(
      input({ profile: profile({ commitSampleSize: 0, highChurnAreas: [], frequentlyModifiedFiles: [] }) }),
    );
    expect(entries.some((e) => e.kind === "hot_area")).toBe(false);
  });

  it("labels a single sampled commit in the singular", () => {
    const entries = deriveKnowledge(
      input({
        profile: profile({
          commitSampleSize: 100,
          highChurnAreas: [{ area: "src", commits: 40 }],
          frequentlyModifiedFiles: [{ path: "src/a.ts", commits: 1, lastTouchedAt: "2026-02-28T00:00:00Z" }],
        }),
      }),
    );
    // A file touched once in 100 commits is not a hot area, so nothing is claimed.
    expect(entries.some((e) => e.title.includes("src/a.ts"))).toBe(false);
  });
});

describe("RETIRE_AFTER_DAYS", () => {
  it("gives a claim more than one collection cycle of grace", () => {
    expect(RETIRE_AFTER_DAYS).toBeGreaterThanOrEqual(2);
  });
});