import { describe, it, expect } from "vitest";
import {
  deriveRepositoryProfile,
  isPackageJsonReadable,
  readStructure,
  stableProfileKey,
  EMPTY_PROFILE,
  type CommitTouch,
} from "./profile";

const NOW = new Date("2026-03-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function commit(files: string[], days: number): CommitTouch {
  return { files, date: daysAgo(days), author: "someone" };
}

describe("deriveRepositoryProfile — package manager and manifests", () => {
  it("detects the package manager from the lockfile, not from a guess", () => {
    expect(deriveRepositoryProfile(["pnpm-lock.yaml", "package.json"], [], null).packageManager).toBe("pnpm");
    expect(deriveRepositoryProfile(["yarn.lock"], [], null).packageManager).toBe("yarn");
    expect(deriveRepositoryProfile(["package-lock.json"], [], null).packageManager).toBe("npm");
    expect(deriveRepositoryProfile(["Cargo.lock", "Cargo.toml"], [], null).packageManager).toBe("cargo");
    expect(deriveRepositoryProfile(["go.sum", "go.mod"], [], null).packageManager).toBe("go");
  });

  it("reports an unknown package manager when no lockfile exists", () => {
    // Never "npm" as a fallback: telling someone to run `npm install` in a
    // repository with no lockfile is a confident wrong instruction.
    expect(deriveRepositoryProfile(["package.json"], [], null).packageManager).toBeNull();
  });

  it("prefers the more specific lockfile when several are present", () => {
    const p = deriveRepositoryProfile(["package-lock.json", "pnpm-lock.yaml"], [], null);
    expect(p.packageManager).toBe("pnpm");
  });

  it("lists the dependency manifests it found", () => {
    const p = deriveRepositoryProfile(["package.json", "go.mod", "Cargo.toml"], [], null);
    expect(p.manifests).toEqual(["package.json", "go.mod", "Cargo.toml"]);
  });
});

describe("deriveRepositoryProfile — dependencies and frameworks", () => {
  it("names frameworks from the declared dependencies", () => {
    const raw = JSON.stringify({ dependencies: { next: "1", react: "1" }, devDependencies: { vitest: "1" } });
    const p = deriveRepositoryProfile(["package.json"], [], raw);
    expect(p.frameworks).toEqual(["Next.js", "React"]);
    expect(p.dependencyCount).toBe(3);
  });

  it("reports no frameworks when package.json cannot be parsed", () => {
    // The distinction that matters: an unreadable manifest is not an absence of
    // frameworks, so we return none but never a fabricated set.
    const p = deriveRepositoryProfile(["package.json"], [], "{ this is not json");
    expect(p.frameworks).toEqual([]);
    expect(p.dependencyCount).toBeNull();
  });

  it("does not invent frameworks from directory names", () => {
    const p = deriveRepositoryProfile(["src/components/Button.tsx", "app/page.tsx"], [], null);
    expect(p.frameworks).toEqual([]);
  });
});

describe("deriveRepositoryProfile — quality tooling", () => {
  it("detects TypeScript, the test runner, the linter and the formatter", () => {
    const raw = JSON.stringify({ dependencies: { next: "1" }, devDependencies: { vitest: "1" } });
    const p = deriveRepositoryProfile(
      ["package.json", "tsconfig.json", "vitest.config.ts", "eslint.config.js", ".prettierrc"],
      [],
      raw,
    );
    expect(p.hasTypeScript).toBe(true);
    expect(p.testFramework).toBe("Vitest");
    expect(p.lintTool).toBe("ESLint");
    expect(p.formatTool).toBe("Prettier");
  });

  it("counts test files and finds them across common layouts", () => {
    const p = deriveRepositoryProfile(
      ["src/a.test.ts", "tests/b.test.ts", "__tests__/c.tsx", "e2e/d.spec.ts", "src/lib/thing.go", "src/lib/thing_test.go"],
      [],
      null,
    );
    expect(p.hasTests).toBe(true);
    expect(p.testFileCount).toBe(5);
  });

  it("treats a configured runner with no test files as tested", () => {
    const p = deriveRepositoryProfile(["jest.config.js"], [], null);
    expect(p.hasTests).toBe(true);
  });

  it("reports no tests for a repository with neither", () => {
    const p = deriveRepositoryProfile(["src/index.ts", "README.md"], [], null);
    expect(p.hasTests).toBe(false);
    expect(p.testFileCount).toBe(0);
  });
});

describe("deriveRepositoryProfile — infrastructure", () => {
  it("detects the ORM, migrations and deployment target", () => {
    const p = deriveRepositoryProfile(
      ["prisma/schema.prisma", "prisma/migrations/0001_init/migration.sql", "vercel.json", "Dockerfile"],
      [],
      null,
    );
    expect(p.orm).toBe("Prisma");
    expect(p.hasMigrations).toBe(true);
    expect(p.deploymentTargets).toContain("Vercel");
    expect(p.hasDocker).toBe(true);
  });

  it("detects an example environment file", () => {
    expect(deriveRepositoryProfile([".env.example"], [], null).hasEnvExample).toBe(true);
    expect(deriveRepositoryProfile([".env.sample"], [], null).hasEnvExample).toBe(true);
    // A real .env must not be mistaken for a published example.
    expect(deriveRepositoryProfile([".env", ".env.local"], [], null).hasEnvExample).toBe(false);
  });

  it("detects dependency security tooling and monorepo management", () => {
    const p = deriveRepositoryProfile([".github/dependabot.yml", "pnpm-workspace.yaml", "turbo.json"], [], null);
    expect(p.securityTooling).toContain("Dependabot");
    expect(p.monorepoTools).toEqual(["Turborepo", "pnpm workspaces"]);
  });

  it("describes the API surface for a Next.js App Router project", () => {
    const raw = JSON.stringify({ dependencies: { next: "15" } });
    expect(deriveRepositoryProfile(["package.json", "src/app/api/health/route.ts"], [], raw).apiStyle).toBe(
      "Next.js App Router API routes",
    );
  });

  it("describes the API surface for an Express service", () => {
    const raw = JSON.stringify({ dependencies: { express: "4" } });
    expect(deriveRepositoryProfile(["package.json", "src/server.ts"], [], raw).apiStyle).toBe("Express routes");
  });

  it("reports no API style rather than guessing one", () => {
    expect(deriveRepositoryProfile(["main.go"], [], null).apiStyle).toBeNull();
  });
});

describe("deriveRepositoryProfile — churn and staleness", () => {
  it("ranks areas by how often the sampled commits touched them", () => {
    const commits = [
      commit(["src/a.ts", "src/b.ts"], 1),
      commit(["src/c.ts"], 2),
      commit(["docs/readme.md"], 3),
    ];
    const p = deriveRepositoryProfile(["src/a.ts", "docs/x.md"], commits, null, NOW);
    expect(p.highChurnAreas[0]).toEqual({ area: "src", commits: 3 });
    expect(p.commitSampleSize).toBe(3);
  });

  it("ranks the most frequently modified files", () => {
    const commits = [commit(["src/hot.ts"], 1), commit(["src/hot.ts"], 2), commit(["src/hot.ts"], 3), commit(["src/cold.ts"], 4)];
    const p = deriveRepositoryProfile(["src/hot.ts", "src/cold.ts"], commits, null, NOW);
    expect(p.frequentlyModifiedFiles[0]).toEqual({ path: "src/hot.ts", commits: 3, lastTouchedAt: daysAgo(1) });
  });

  it("flags areas untouched for six months or more as stale", () => {
    const commits = [commit(["src/fresh.ts"], 1), commit(["legacy/old.ts"], 200)];
    const p = deriveRepositoryProfile(["src/fresh.ts", "legacy/old.ts"], commits, null, NOW);
    expect(p.staleAreas).toEqual([{ area: "legacy", lastTouchedAt: daysAgo(200), daysSince: 200 }]);
  });

  it("does not report churn when commit history is unavailable", () => {
    // An unreadable history means "unknown", which must not render as a claim
    // that the repository is quiet or abandoned.
    const p = deriveRepositoryProfile(["src/a.ts"], [], null, NOW);
    expect(p.commitSampleSize).toBe(0);
    expect(p.highChurnAreas).toEqual([]);
    expect(p.staleAreas).toEqual([]);
  });

  it("buckets trunk-level files as a root area", () => {
    const p = deriveRepositoryProfile(["README.md"], [commit(["README.md"], 1)], null, NOW);
    expect(p.highChurnAreas[0]?.area).toBe("(root)");
  });
});

describe("isPackageJsonReadable", () => {
  it("separates a missing manifest from an unparseable one", () => {
    expect(isPackageJsonReadable(["package.json"], JSON.stringify({}))).toBe(true);
    expect(isPackageJsonReadable(["package.json"], "{oops")).toBe(false);
    expect(isPackageJsonReadable(["go.mod"], null)).toBe(false);
  });
});

describe("readStructure", () => {
  it("returns an empty profile for a structure written before profiles existed", () => {
    const s = readStructure(JSON.stringify({ topLevel: ["src"], workflowNames: ["ci.yml"] }));
    expect(s.topLevel).toEqual(["src"]);
    expect(s.workflowNames).toEqual(["ci.yml"]);
    expect(s.profile).toEqual(EMPTY_PROFILE);
  });

  it("survives null, empty and malformed JSON", () => {
    for (const raw of [null, undefined, "", "not json", "null", "[]"]) {
      const s = readStructure(raw);
      expect(s.topLevel).toEqual([]);
      expect(s.profile).toEqual(EMPTY_PROFILE);
    }
  });

  it("keeps a stored profile intact", () => {
    const profile = deriveRepositoryProfile(["package.json", "package-lock.json"], [], JSON.stringify({ dependencies: {} }));
    const s = readStructure(JSON.stringify({ topLevel: ["src"], workflowNames: [], profile }));
    expect(s.profile.packageManager).toBe("npm");
  });
});

describe("stableProfileKey", () => {
  it("ignores churn so a collection sweep does not bump the revision", () => {
    const a = deriveRepositoryProfile(["package.json", "package-lock.json"], [commit(["src/a.ts"], 1)], "{}");
    const b = deriveRepositoryProfile(["package.json", "package-lock.json"], [commit(["src/b.ts"], 1)], "{}");
    expect(stableProfileKey(a)).toBe(stableProfileKey(b));
  });

  it("changes when a structural fact changes", () => {
    const before = deriveRepositoryProfile(["package.json", "package-lock.json"], [], "{}");
    const after = deriveRepositoryProfile(
      ["package.json", "package-lock.json", "vitest.config.ts"],
      [],
      JSON.stringify({ devDependencies: { vitest: "1" } }),
    );
    expect(stableProfileKey(before)).not.toBe(stableProfileKey(after));
  });
});
