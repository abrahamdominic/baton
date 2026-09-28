import { describe, it, expect } from "vitest";
import { analyzeChangeImpact } from "./impact";

describe("analyzeChangeImpact", () => {
  it("handles empty file list gracefully", () => {
    const res = analyzeChangeImpact([]);
    expect(res.totalFiles).toBe(0);
    expect(res.overallRisk).toBe("low");
    expect(res.areas).toEqual([]);
    expect(res.needsDocs).toBe(false);
  });

  it("identifies critical risk for authentication changes and flags missing docs", () => {
    const res = analyzeChangeImpact(["src/lib/auth/oauth-flow.ts", "src/middleware.ts"]);
    expect(res.totalFiles).toBe(2);
    expect(res.overallRisk).toBe("critical");
    expect(res.areas.some((a) => a.category === "auth_security")).toBe(true);
    expect(res.needsDocs).toBe(true);
    expect(res.affectedRoutes).toContain("/auth/*");
    expect(res.affectedTests).toContain("src/lib/auth/oauth-flow.test.ts");
  });

  it("identifies database migrations and flags schema migration requirements", () => {
    const res = analyzeChangeImpact([
      "prisma/schema.prisma",
      "prisma/migrations/0004_repository_intelligence/migration.sql",
    ]);
    expect(res.overallRisk).toBe("critical");
    expect(res.needsMigration).toBe(true);
    expect(res.areas.some((a) => a.category === "database")).toBe(true);
  });

  it("identifies dependency modifications and flags dependency audit requirements", () => {
    const res = analyzeChangeImpact(["package.json", "package-lock.json"]);
    expect(res.needsDependencyAudit).toBe(true);
    expect(res.areas.some((a) => a.category === "dependencies")).toBe(true);
  });

  it("identifies low risk for docs and UI changes", () => {
    const res = analyzeChangeImpact(["README.md", "src/components/badge.tsx"]);
    expect(res.overallRisk).toBe("low");
    expect(res.needsDocs).toBe(false);
    expect(res.areas.some((a) => a.category === "documentation")).toBe(true);
    expect(res.areas.some((a) => a.category === "ui_dashboard")).toBe(true);
  });

  it("identifies CI workflow changes as a distinct area", () => {
    const res = analyzeChangeImpact([".github/workflows/ci.yml"]);
    expect(res.areas.some((a) => a.category === "ci_automation")).toBe(true);
  });

  it("classifies by location before extension", () => {
    // Regression: the UI test (`.tsx`, "/app/") used to run before the CI and
    // dependency tests, so a `.tsx` or "app" path outside the UI was swallowed
    // by the UI bucket.
    const res = analyzeChangeImpact(["docs/app/overview.md", ".github/workflows/build.yml"]);
    expect(res.areas.some((a) => a.category === "documentation")).toBe(true);
    expect(res.areas.some((a) => a.category === "ci_automation")).toBe(true);
    expect(res.areas.some((a) => a.category === "ui_dashboard")).toBe(false);
  });

  it("flags a dependency manifest as a dependency, not as UI", () => {
    const res = analyzeChangeImpact(["docs/requirements.txt"]);
    expect(res.needsDependencyAudit).toBe(true);
    expect(res.areas.some((a) => a.category === "dependencies")).toBe(true);
  });

  it("grounds the structural claim in the recorded structure when given it", () => {
    const known = analyzeChangeImpact(["src/new-feature.ts"], {
      topLevel: ["src", "prisma"],
      workflowNames: ["ci.yml"],
    });
    expect(known.inferences.join(" ")).not.toMatch(/not present in the last recorded structure/);

    const fresh = analyzeChangeImpact(["brand-new/dir/file.ts"], {
      topLevel: ["src", "prisma"],
      workflowNames: ["ci.yml"],
    });
    expect(fresh.inferences.join(" ")).toMatch(/brand-new/);
  });

  it("confirms a CI change maps to a workflow that actually exists", () => {
    const res = analyzeChangeImpact([".github/workflows/ci.yml"], {
      topLevel: ["src"],
      workflowNames: ["ci.yml"],
    });
    expect(res.facts.join(" ")).toMatch(/1 workflow that exists/);  });

  it("only infers test paths; it never claims they are verified", () => {
    const res = analyzeChangeImpact(["src/lib/auth/oauth-flow.ts"]);
    // Naming-convention guesses, e.g. README.test.md does not exist anywhere.
    expect(res.affectedTests).toContain("src/lib/auth/oauth-flow.test.ts");
    // They must not be presented as collected facts.
    expect(res.facts.join(" ")).not.toMatch(/affectedTests|related tests/i);
  });
});
