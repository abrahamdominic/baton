import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EMPTY_PROFILE } from "@/lib/intelligence/profile";

/**
 * Database cover for workflow-automation persistence.
 *
 * The workflow functions themselves are pure and unit-tested. What can only be
 * proven against a real database is the relational contract around them:
 *
 *  - one stored run per repository, replaced rather than accumulated, so the page
 *    can never show a finding that a later run has already contradicted;
 *  - a disabled repository is never analysed, because the sweep must not spend
 *    work on a repository the team turned off;
 *  - an unknown installation cannot write a run at all, which is what stops one
 *    installation from recording findings against another's repository;
 *  - the stored JSON round-trips, so what the UI renders is what the workflow
 *    produced rather than a lossy projection.
 */

const { prisma } = await import("@/lib/db");
const { automationCoverage } = await import("@/lib/engine/queue-metrics");
const { processRepoAutomations } = await import("@/lib/engine/runner");
const { WORKFLOW_LABELS } = await import("@/lib/workflows/automation");

const stamp = `auto${Date.now().toString(36)}`;
const installationId = 8_100_000 + (Date.now() % 800_000);
const otherInstallationId = 8_900_000 + (Date.now() % 800_000);

let owner: { id: string };
let repoRowId: string;

const OWNER = "acme";
const REPO = "widgets";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

beforeAll(async () => {
  owner = await prisma.user.create({
    data: { githubId: Math.floor(Math.random() * 1e9) + 5e8, login: `${stamp}-owner` },
    select: { id: true },
  });
  const inst = await prisma.appInstallation.create({
    data: { installationId, accountLogin: `${stamp}-owner`, accountType: "User", userId: owner.id },
    select: { id: true },
  });
  const repo = await prisma.repo.create({
    data: {
      installationId: inst.id,
      repoId: BigInt(installationId) + 1n,
      owner: OWNER,
      name: REPO,
      fullName: `${stamp}/${OWNER}/${REPO}`,
      defaultBranch: "main",
    },
    select: { id: true },
  });
  repoRowId = repo.id;

  await prisma.appInstallation.create({
    data: {
      installationId: otherInstallationId,
      accountLogin: `${stamp}-other`,
      accountType: "User",
      userId: owner.id,
    },
    select: { id: true },
  });

  // Stored state only: no GitHub call is involved in this path, which is the
  // property that lets the sweep schedule it cheaply.
  await prisma.repositoryInsight.create({
    data: {
      repoId: repoRowId,
      revision: 1_700_000_000,
      description: "A test service",
      defaultBranch: "main",
      hasReadme: true,
      hasCodeowners: false,
      hasContributing: false,
      hasCiWorkflows: true,
      hasSecurityPolicy: false,
      hasLicense: true,
      openPullRequests: 1,
      openIssues: 3,
      mergedLast30Days: 4,
      contributorCount: 2,
      lastReleaseTag: "v1.2.0",
      lastReleaseAt: daysAgo(20),
      structure: JSON.stringify({
        topLevel: ["src", "CHANGELOG.md"],
        workflowNames: [],
        profile: { ...EMPTY_PROFILE, hasTests: true },
        codeowners: null,
      }),
      languages: "[]",
      topics: "[]",
      topContributors: "[]",
      evidence: { create: [] },
    },
  });

  // One PR that has been sitting in review long enough to be a finding, and one
  // that is fresh. The suite must report the first and ignore the second.
  await prisma.pullRequest.create({
    data: {
      repoId: repoRowId,
      number: 101,
      title: "Add caching layer",
      url: `https://github.com/${OWNER}/${REPO}/pull/101`,
      state: "awaiting_review",
      authorLogin: "ada",
      baseRef: "main",
      headRef: "feature/cache",
      headSha: "1111111111111111111111111111111111111111",
      githubState: "OPEN",
      isDraft: false,
      reviewDecision: null,
      requestedReviewersJson: JSON.stringify([{ login: "grace" }]),
      labelsJson: "[]",
      checksJson: "[]",
      stateEnteredAt: daysAgo(40),
      githubUpdatedAt: daysAgo(40),
    },
  });
  await prisma.pullRequest.create({
    data: {
      repoId: repoRowId,
      number: 102,
      title: "Fix typo in README",
      url: `https://github.com/${OWNER}/${REPO}/pull/102`,
      state: "ready_to_merge",
      authorLogin: "bob",
      baseRef: "main",
      headRef: "fix-typo",
      headSha: "2222222222222222222222222222222222222222",
      githubState: "OPEN",
      isDraft: false,
      reviewDecision: "APPROVED",
      requestedReviewersJson: "[]",
      labelsJson: "[]",
      checksJson: "[]",
      stateEnteredAt: daysAgo(1),
      githubUpdatedAt: daysAgo(1),
    },
  });
});

afterAll(async () => {
  await prisma.appInstallation.deleteMany({
    where: { installationId: { in: [installationId, otherInstallationId] } },
  });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("processRepoAutomations", () => {
  it("stores findings for the repository it was asked about", async () => {
    const result = await processRepoAutomations({
      installationId,
      owner: OWNER,
      repo: REPO,
    });
    expect(result?.repoRowId).toBe(repoRowId);
    expect(result?.workflowCount).toBeGreaterThan(0);

    const stored = await prisma.repoAutomationRun.findUnique({ where: { repoId: repoRowId } });
    expect(stored).not.toBeNull();
    expect(stored!.findingCount).toBe(result?.findingCount);
  });

  it("reports the stale PR and not the fresh one", async () => {
    await processRepoAutomations({ installationId, owner: OWNER, repo: REPO });
    const stored = await prisma.repoAutomationRun.findUniqueOrThrow({ where: { repoId: repoRowId } });
    const runs = JSON.parse(stored.runsJson) as { kind: string; findings: { title: string; basis: string }[] }[];

    const stale = runs.find((r) => r.kind === "stale_work");
    expect(stale?.findings.map((f) => f.title).join(" ")).toContain("#101");
    expect(stale?.findings.map((f) => f.title).join(" ")).not.toContain("#102");

    const waiting = runs.find((r) => r.kind === "waiting_on_people");
    expect(waiting?.findings.map((f) => f.title).join(" ")).toContain("grace");
  });

  it("stores every finding with a basis and a known label", async () => {
    const stored = await prisma.repoAutomationRun.findUniqueOrThrow({ where: { repoId: repoRowId } });
    const runs = JSON.parse(stored.runsJson) as {
      kind: keyof typeof WORKFLOW_LABELS;
      findings: { kind: string; title: string; basis: string; confidence: string; severity: number }[];
    }[];

    let total = 0;
    for (const run of runs) {
      expect(WORKFLOW_LABELS[run.kind]).toBeTruthy();
      for (const f of run.findings) {
        total += 1;
        expect(f.kind).toBe(run.kind);
        expect(f.title.trim()).not.toBe("");
        expect(f.basis.trim()).not.toBe("");
        expect(["observed", "derived", "speculative"]).toContain(f.confidence);
        expect(typeof f.severity).toBe("number");
      }
    }
    expect(total).toBe(stored.findingCount);
  });

  it("includes release readiness, which is computed per repository", async () => {
    const stored = await prisma.repoAutomationRun.findUniqueOrThrow({ where: { repoId: repoRowId } });
    const runs = JSON.parse(stored.runsJson) as { kind: string }[];
    expect(runs.map((r) => r.kind)).toContain("release_readiness");
  });

  it("replaces the previous run instead of accumulating contradicted findings", async () => {
    await processRepoAutomations({ installationId, owner: OWNER, repo: REPO });
    const first = await prisma.repoAutomationRun.findMany({ where: { repoId: repoRowId } });
    expect(first).toHaveLength(1);

    // Make the stale PR fresh, then re-run: the old finding must disappear
    // instead of lingering alongside the corrected result.
    await prisma.pullRequest.update({
      where: { repoId_number: { repoId: repoRowId, number: 101 } },
      data: { stateEnteredAt: new Date(), githubUpdatedAt: new Date(), state: "ready_to_merge" },
    });
    await processRepoAutomations({ installationId, owner: OWNER, repo: REPO });

    const stored = await prisma.repoAutomationRun.findUniqueOrThrow({ where: { repoId: repoRowId } });
    const runs = JSON.parse(stored.runsJson) as { kind: string; findings: { title: string }[] }[];
    expect(runs.find((r) => r.kind === "stale_work")?.findings).toEqual([]);
    expect(await prisma.repoAutomationRun.count({ where: { repoId: repoRowId } })).toBe(1);
  });

  it("refuses a repository belonging to another installation", async () => {
    const result = await processRepoAutomations({
      installationId: otherInstallationId,
      owner: OWNER,
      repo: REPO,
    });
    expect(result).toBeNull();
  });

  it("refuses an unknown repository", async () => {
    expect(await processRepoAutomations({ installationId, owner: OWNER, repo: "does-not-exist" })).toBeNull();
  });

  it("does not analyse a disabled repository", async () => {
    await prisma.repo.update({ where: { id: repoRowId }, data: { enabled: false } });
    const before = await prisma.repoAutomationRun.findUnique({ where: { repoId: repoRowId } });

    expect(await processRepoAutomations({ installationId, owner: OWNER, repo: REPO })).toBeNull();

    const after = await prisma.repoAutomationRun.findUnique({ where: { repoId: repoRowId } });
    expect(after?.ranAt.getTime()).toBe(before?.ranAt.getTime());

    await prisma.repo.update({ where: { id: repoRowId }, data: { enabled: true } });
  });

  it("stores a run for an uncollected repository without claiming anything about its structure", async () => {
    const freshInstallationId = installationId + 1;
    const inst = await prisma.appInstallation.create({
      data: {
        installationId: freshInstallationId,
        accountLogin: `${stamp}-fresh`,
        accountType: "User",
        userId: owner.id,
      },
      select: { id: true },
    });
    const fresh = await prisma.repo.create({
      data: {
        installationId: inst.id,
        repoId: BigInt(installationId) + 2n,
        owner: OWNER,
        name: "brand-new",
        fullName: `${stamp}/${OWNER}/brand-new`,
        defaultBranch: "main",
      },
      select: { id: true },
    });

    // No insight row, so the structure-derived workflows have nothing to read. A
    // run is still stored, PR-derived findings stay valid, but it must not
    // claim anything about a structure nobody looked at.
    const result = await processRepoAutomations({
      installationId: freshInstallationId,
      owner: OWNER,
      repo: "brand-new",
    });
    expect(result).not.toBeNull();

    const stored = await prisma.repoAutomationRun.findUniqueOrThrow({ where: { repoId: fresh.id } });
    const runs = JSON.parse(stored.runsJson) as {
      kind: string;
      unavailable?: string;
      findings: { id: string; title: string }[];
    }[];
    const structureDependent = runs.filter(
      (r) => r.kind === "unowned_changes" || r.kind === "affected_tests",
    );
    expect(structureDependent).toHaveLength(2);
    for (const run of structureDependent) {
      expect(run.findings).toEqual([]);
      expect(run.unavailable).toMatch(/not collected/i);
    }
  });
});
describe("automationCoverage", () => {
  // Coverage is the operator's only way to tell "analysed and clean" from
  // "never looked", so the arithmetic has to count the rows that are missing,
  // not just the rows that exist.
  it("counts a repository with no stored run as unanalysed", async () => {
    const coverage = await automationCoverage();
    const analysed = coverage.analysedRepos > 0;
    expect(analysed || coverage.neverAnalysed > 0).toBe(true);
    expect(coverage.neverAnalysed).toBe(coverage.enabledRepos - coverage.analysedRepos);
  });

  it("lists repositories waiting for a first run, and omits analysed ones", async () => {
    const coverage = await automationCoverage(50);
    const waiting = coverage.oldestUnanalysed.map((r) => `${r.owner}/${r.name}`);
    expect(waiting).not.toContain(`${OWNER}/${REPO}`);
  });

  it("reports the most recent run and the finding total it stored", async () => {
    await processRepoAutomations({ installationId, owner: OWNER, repo: REPO });
    const coverage = await automationCoverage();
    expect(coverage.mostRecent?.owner).toBe(OWNER);
    expect(coverage.totalFindings).toBeGreaterThan(0);
    expect(coverage.totalFindings).toBe(coverage.mostRecent?.findingCount);
  });
});
