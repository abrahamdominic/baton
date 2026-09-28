/**
 * Change Impact Analysis: correlates modified files against architectural
 * boundaries, affected test suites, database models, and documentation needs.
 *
 * Strict Rule: Baton never conflates FACT with INFERENCE.
 * - FACT: What files changed, what extensions they have, what directories they belong to.
 * - INFERENCE: What tests likely cover them, what routes could be affected, what risk rating applies.
 */

export type ImpactRiskLevel = "critical" | "high" | "medium" | "low";

export interface ImpactArea {
  name: string;
  category:
    | "auth_security"
    | "database"
    | "api_webhooks"
    | "engine_worker"
    | "ui_dashboard"
    | "ci_automation"
    | "dependencies"
    | "documentation"
    | "general";
  risk: ImpactRiskLevel;
  files: string[];
  reasons: string[];
  /**
   * *Candidate* test paths inferred from naming convention. These are not
   * verified to exist — the collector records the trunk layout, not every file
   * in the tree — so they must be presented to a developer as "these are the
   * tests to look at", never as "these are the tests that cover this change".
   */
  affectedTests: string[];
  affectedRoutes: string[];
  evidence: string[];
}

export interface ChangeImpactResult {
  summary: string;
  totalFiles: number;
  overallRisk: ImpactRiskLevel;
  areas: ImpactArea[];
  facts: string[];
  inferences: string[];
  affectedRoutes: string[];
  affectedTests: string[];
  needsDocs: boolean;
  needsMigration: boolean;
  needsDependencyAudit: boolean;
}

const RISK_WEIGHT: Record<ImpactRiskLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Identify candidate test files for a changed file.
 *
 * Purely a naming-convention guess. None of these paths are checked against the
 * tree, so they are surfaced as suggestions to look at, not as tests that exist
 * and will catch a regression.
 */
function inferRelatedTests(filePath: string): string[] {
  const tests: string[] = [];
  const base = filePath.replace(/\.[^.]+$/, "");
  const ext = filePath.split(".").pop() ?? "";

  // Common co-located test patterns
  tests.push(`${base}.test.${ext}`);
  tests.push(`${base}.spec.${ext}`);
  tests.push(`${base}.dbtest.${ext}`);

  // Test directory mirror patterns
  if (filePath.startsWith("src/")) {
    tests.push(filePath.replace(/^src\//, "tests/").replace(/\.[^.]+$/, `.test.${ext}`));
  }

  return tests;
}

export function analyzeChangeImpact(
  changedPaths: string[],
  repoStructure?: { topLevel?: string[]; workflowNames?: string[] },
): ChangeImpactResult {
  const normalized = changedPaths.map((p) => p.trim()).filter(Boolean);
  const facts: string[] = [];
  const inferences: string[] = [];
  const areas: ImpactArea[] = [];
  const allAffectedTests = new Set<string>();
  const allAffectedRoutes = new Set<string>();

  if (normalized.length === 0) {
    return {
      summary: "No changed files specified for impact analysis.",
      totalFiles: 0,
      overallRisk: "low",
      areas: [],
      facts: ["Zero files modified."],
      inferences: ["No ripple effects or test failures expected."],
      affectedRoutes: [],
      affectedTests: [],
      needsDocs: false,
      needsMigration: false,
      needsDependencyAudit: false,
    };
  }

  facts.push(`${normalized.length} file${normalized.length === 1 ? "" : "s"} modified in this change set.`);

  const authFiles: string[] = [];
  const dbFiles: string[] = [];
  const apiFiles: string[] = [];
  const engineFiles: string[] = [];
  const uiFiles: string[] = [];
  const ciFiles: string[] = [];
  const depFiles: string[] = [];
  const docFiles: string[] = [];
  const otherFiles: string[] = [];

  for (const path of normalized) {
    const lower = path.toLowerCase();

    if (
      lower.includes("auth") ||
      lower.includes("oauth") ||
      lower.includes("session") ||
      lower.includes("secret") ||
      lower.includes("security") ||
      lower.includes("crypto") ||
      lower.endsWith("middleware.ts")
    ) {
      authFiles.push(path);
    } else if (
      lower.includes("prisma") ||
      lower.includes("migration") ||
      lower.includes("schema.prisma") ||
      lower.includes("/db") ||
      lower.endsWith("schema.sql")
    ) {
      dbFiles.push(path);
    } else if (
      lower.includes("webhook") ||
      lower.includes("/api/") ||
      lower.includes("route.ts") ||
      lower.includes("endpoint")
    ) {
      apiFiles.push(path);
    } else if (
      lower.includes("engine") ||
      lower.includes("worker") ||
      lower.includes("queue") ||
      lower.includes("runner") ||
      lower.includes("jobs")
    ) {
      engineFiles.push(path);
    } else if (
      lower.startsWith(".github/workflows") ||
      lower.includes("ci.yml") ||
      lower.includes("action.yml")
    ) {
      ciFiles.push(path);
    } else if (
      /(^|\/)(package(-lock)?\.json|yarn\.lock|go\.mod|cargo\.toml|requirements.*\.txt|pyproject\.toml)$/i.test(path)
    ) {
      depFiles.push(path);
    } else if (
      // Documentation is identified by location and filename, so it is checked
      // before the UI test below. Otherwise a prose file under `docs/app/` was
      // classified as a UI change purely because of the directory name.
      lower.endsWith(".md") ||
      lower.startsWith("docs/") ||
      lower.includes("readme") ||
      lower.includes("contributing")
    ) {
      docFiles.push(path);
    } else if (
      // Checked *after* CI, dependency manifests and docs: those are identified
      // by their location and filename, and letting a loose `.tsx`/"/app/" test
      // run first swallowed files that were none of the above.
      lower.includes("component") ||
      lower.includes("/app/") ||
      lower.endsWith(".tsx") ||
      lower.endsWith(".jsx") ||
      lower.endsWith(".css")
    ) {
      uiFiles.push(path);
    } else {
      otherFiles.push(path);
    }
  }

  // 1. Auth & Security Area
  if (authFiles.length > 0) {
    const tests = authFiles.flatMap(inferRelatedTests);
    tests.forEach((t) => allAffectedTests.add(t));
    allAffectedRoutes.add("/auth/*");
    allAffectedRoutes.add("/api/auth/*");

    areas.push({
      name: "Authentication & Security Perimeter",
      category: "auth_security",
      risk: "critical",
      files: authFiles,
      reasons: [
        "Modifications touch credentials, session tokens, or cryptographic signing boundaries.",
        "Regression here risks unauthorized session creation, privilege escalation, or cross-tenant leaks.",
      ],
      affectedTests: tests.slice(0, 5),
      affectedRoutes: ["/auth/login", "/auth/callback", "/auth/install/callback"],
      evidence: authFiles.map((f) => `File: ${f}`),
    });
    inferences.push("Verify OAuth redirects, token signing, session expiration, and state parameter validation.");
  }

  // 2. Database & Data Models Area
  if (dbFiles.length > 0) {
    const hasSchema = dbFiles.some((f) => f.includes("schema.prisma") || f.includes("migration"));
    const tests = dbFiles.flatMap(inferRelatedTests);
    tests.forEach((t) => allAffectedTests.add(t));

    areas.push({
      name: "Database Models & Schema Migrations",
      category: "database",
      risk: hasSchema ? "critical" : "high",
      files: dbFiles,
      reasons: [
        hasSchema
          ? "Database schema altered. Requires migration deployment and mirrors verification."
          : "Database queries or access layer changed. Check for query performance and connection exhaustion.",
      ],
      affectedTests: tests.slice(0, 5),
      affectedRoutes: [],
      evidence: dbFiles.map((f) => `File: ${f}`),
    });
    inferences.push("Run database migration tests and verify client generation (`npm run db:generate`).");
  }

  // 3. API & Webhooks Area
  if (apiFiles.length > 0) {
    const hasWebhooks = apiFiles.some((f) => f.includes("webhook"));
    const tests = apiFiles.flatMap(inferRelatedTests);
    tests.forEach((t) => allAffectedTests.add(t));
    apiFiles.forEach((f) => {
      const match = f.match(/src\/app\/(api\/[^/]+)/);
      if (match) allAffectedRoutes.add(`/${match[1]}`);
    });

    areas.push({
      name: "Public APIs & Inbound Webhooks",
      category: "api_webhooks",
      risk: hasWebhooks ? "high" : "medium",
      files: apiFiles,
      reasons: [
        hasWebhooks
          ? "Inbound webhook signatures, event deduplication, or job dispatching modified."
          : "API contract or response structure changed.",
      ],
      affectedTests: tests.slice(0, 5),
      affectedRoutes: Array.from(allAffectedRoutes).slice(0, 5),
      evidence: apiFiles.map((f) => `File: ${f}`),
    });
    inferences.push("Verify idempotency, signature validation, and error HTTP status codes for external consumers.");
  }

  // 4. Engine & Background Workers Area
  if (engineFiles.length > 0) {
    const tests = engineFiles.flatMap(inferRelatedTests);
    tests.forEach((t) => allAffectedTests.add(t));

    areas.push({
      name: "State Engine & Worker Processing",
      category: "engine_worker",
      risk: "high",
      files: engineFiles,
      reasons: [
        "PR state machine, classification logic, or worker queue claiming modified.",
        "Failures can stall PR synchronization, delay nudges, or cause job loss.",
      ],
      affectedTests: tests.slice(0, 5),
      affectedRoutes: ["/api/cron/drain", "/api/cron/sweep"],
      evidence: engineFiles.map((f) => `File: ${f}`),
    });
    inferences.push("Run real database worker test (`npm run test:db`) to verify atomic lock claiming.");
  }

  // 5. CI & Automation Area
  if (ciFiles.length > 0) {
    areas.push({
      name: "CI Workflows & GitHub Actions",
      category: "ci_automation",
      risk: "high",
      files: ciFiles,
      reasons: [
        "GitHub Actions workflow definitions modified.",
        "May alter test gatekeepers, deployment pipelines, or secret availability across all branches.",
      ],
      affectedTests: [],
      affectedRoutes: [],
      evidence: ciFiles.map((f) => `Workflow: ${f}`),
    });
    inferences.push("Ensure test runner environments, secret injection, and branch triggers match repository requirements.");
  }

  // 6. Dependencies Area
  if (depFiles.length > 0) {
    areas.push({
      name: "Dependencies & Package Manifests",
      category: "dependencies",
      risk: "high",
      files: depFiles,
      reasons: [
        "Package manifest or lockfile updated.",
        "Could shift transitive dependencies, introduce security vulnerabilities, or trigger runtime bundler incompatibilities.",
      ],
      affectedTests: [],
      affectedRoutes: [],
      evidence: depFiles.map((f) => `Manifest: ${f}`),
    });
    inferences.push("Run `npm audit` or package security scanning and verify production build output (`npm run build`).");
  }

  // 7. UI & Dashboards Area
  if (uiFiles.length > 0) {
    const tests = uiFiles.flatMap(inferRelatedTests);
    tests.forEach((t) => allAffectedTests.add(t));

    areas.push({
      name: "User Interface & Dashboard Views",
      category: "ui_dashboard",
      risk: "low",
      files: uiFiles,
      reasons: ["Frontend presentation, forms, or client-side interactivity modified."],
      affectedTests: tests.slice(0, 5),
      affectedRoutes: ["/dashboard"],
      evidence: uiFiles.slice(0, 5).map((f) => `File: ${f}`),
    });
  }

  // 8. Documentation Area
  if (docFiles.length > 0) {
    areas.push({
      name: "Documentation & Contributor Guides",
      category: "documentation",
      risk: "low",
      files: docFiles,
      reasons: ["Markdown documentation or developer onboarding updated."],
      affectedTests: [],
      affectedRoutes: [],
      evidence: docFiles.map((f) => `Doc: ${f}`),
    });
  }

  // Compute overall risk
  let maxRiskVal = 1;
  for (const a of areas) {
    maxRiskVal = Math.max(maxRiskVal, RISK_WEIGHT[a.risk]);
  }
  const overallRisk: ImpactRiskLevel =
    maxRiskVal === 4 ? "critical" : maxRiskVal === 3 ? "high" : maxRiskVal === 2 ? "medium" : "low";

  // Check documentation gap: if core architecture changed but no docs changed
  const touchesCore = authFiles.length > 0 || dbFiles.length > 0 || apiFiles.length > 0 || engineFiles.length > 0;
  const needsDocs = touchesCore && docFiles.length === 0;
  if (needsDocs) {
    inferences.push("Core architecture or API boundaries were modified without updating documentation. Review README/docs.");
  }

  const needsMigration = dbFiles.some((f) => f.includes("schema.prisma") || f.includes("migration"));
  const needsDependencyAudit = depFiles.length > 0;

  // Ground the structural claims in what the collector actually saw. Without
  // this the second parameter was dead weight, and a change touching a brand new
  // top-level area looked identical to a change inside an established one.
  if (repoStructure?.topLevel?.length) {
    const known = new Set(repoStructure.topLevel.map((d) => d.toLowerCase()));
    const introduced = new Set<string>();
    for (const path of normalized) {
      const segment = path.split("/")[0]?.toLowerCase();
      if (segment && !known.has(segment) && !segment.startsWith(".")) introduced.add(segment);
    }
    if (introduced.size > 0) {
      inferences.push(
        `This change touches ${introduced.size} top-level director${
          introduced.size === 1 ? "y" : "ies"
        } not present in the last recorded structure (${[...introduced].slice(0, 4).join(", ")}). That is where to start reading.`,
      );
    }
    if (ciFiles.length > 0 && repoStructure.workflowNames?.length) {
      const touched = ciFiles.filter((f) =>
        repoStructure.workflowNames!.some((w) => f.toLowerCase().endsWith(w.toLowerCase())),
      );
      if (touched.length > 0) {
        facts.push(
          `CI change maps to ${touched.length} workflow${touched.length === 1 ? " that exists" : "s that exist"} in the default branch.`,
        );
      }
    }
  }

  const summary = `Impact Analysis: ${normalized.length} file${
    normalized.length === 1 ? "" : "s"
  } analyzed across ${areas.length} architectural area${areas.length === 1 ? "" : "s"}. Overall Risk: ${overallRisk.toUpperCase()}.`;

  return {
    summary,
    totalFiles: normalized.length,
    overallRisk,
    areas,
    facts,
    inferences,
    affectedRoutes: Array.from(allAffectedRoutes),
    affectedTests: Array.from(allAffectedTests),
    needsDocs,
    needsMigration,
    needsDependencyAudit,
  };
}
