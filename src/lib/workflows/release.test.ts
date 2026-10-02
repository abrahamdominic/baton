import { describe, it, expect } from "vitest";
import {
  mergedSince,
  buildReleaseReadiness,
  releaseImplications,
  type ReleaseInput,
} from "./release";
import { EMPTY_PROFILE } from "@/lib/intelligence/profile";
import type { WorkflowPr } from "./automation";

/**
 * Tests for release preparation.
 *
 * The property under test throughout is honesty about unknowns: a missing
 * release tag, an unavailable merge count, or an absent changelog must each
 * surface as "we do not know" or "check this", never as a clean zero or a
 * fabricated "ready" verdict. §11 forbids presenting an inference as a confirmed
 * fact, and a release checklist that quietly assumes the best is the most
 * expensive place to break that rule.
 */

const NOW = new Date("2026-03-02T12:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function pr(overrides: Partial<WorkflowPr> = {}): WorkflowPr {
  return {
    number: 1,
    title: "Add caching layer",
    state: "merged",
    authorLogin: "ada",
    url: "https://github.com/acme/widgets/pull/1",
    baseRef: "main",
    headRef: "feature/cache",
    isDraft: false,
    githubState: "MERGED",
    reviewDecision: "APPROVED",
    requestedReviewersJson: "[]",
    labelsJson: "[]",
    checksJson: "[]",
    stateEnteredAt: daysAgo(3),
    githubUpdatedAt: daysAgo(3),
    createdAt: daysAgo(10),
    ...overrides,
  };
}

function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    prs: [],
    structure: { topLevel: [], workflowNames: [], profile: EMPTY_PROFILE, codeowners: null },
    insight: { lastReleaseTag: null, lastReleaseAt: null, mergedLast30Days: null },
    now: NOW,
    ...overrides,
  };
}

describe("mergedSince", () => {
  it("counts merged PRs since the last release date", () => {
    const lastRelease = daysAgo(10);
    const { prs, windowDays, basedOnRelease } = mergedSince(
      [pr({ number: 1, githubUpdatedAt: daysAgo(8) }), pr({ number: 2, githubUpdatedAt: daysAgo(2) })],
      lastRelease,
      NOW,
    );
    expect(prs.map((p) => p.number).sort()).toEqual([1, 2]);
    expect(windowDays).toBe(10);
    expect(basedOnRelease).toBe(true);
  });

  it("excludes PRs merged before the last release", () => {
    const { prs } = mergedSince([pr({ number: 1, githubUpdatedAt: daysAgo(60) })], daysAgo(10), NOW);
    expect(prs).toEqual([]);
  });

  it("falls back to a 30-day window and says so when no release was recorded", () => {
    const { prs, windowDays, basedOnRelease } = mergedSince(
      [pr({ number: 1, githubUpdatedAt: daysAgo(5) }), pr({ number: 2, githubUpdatedAt: daysAgo(45) })],
      null,
      NOW,
    );
    expect(prs.map((p) => p.number)).toEqual([1]);
    expect(windowDays).toBe(30);
    expect(basedOnRelease).toBe(false);
  });

  it("ignores open PRs entirely", () => {
    const { prs } = mergedSince([pr({ number: 1, githubState: "OPEN" })], null, NOW);
    expect(prs).toEqual([]);
  });
});

describe("buildReleaseReadiness", () => {
  it("gives every section a basis, so no section is unexplained", () => {
    const readiness = buildReleaseReadiness(input());
    expect(readiness.sections.length).toBeGreaterThan(0);
    for (const s of readiness.sections) {
      expect(s.title.trim()).not.toBe("");
      expect(s.basis.trim()).not.toBe("");
    }
  });

  it("never declares a release ready on its own", () => {
    const readiness = buildReleaseReadiness(
      input({
        structure: { topLevel: ["CHANGELOG.md"], workflowNames: [], profile: EMPTY_PROFILE, codeowners: null },
        insight: { lastReleaseTag: "v2.0.0", lastReleaseAt: daysAgo(30), mergedLast30Days: 12 },
        prs: [pr()],
      }),
    );
    expect(readiness.blockers).toEqual([]);
    expect(readiness.headline).not.toMatch(/ready to ship|is ready|safe to release/i);
  });

  it("treats an unavailable merge count as unknown, not as zero", () => {
    const readiness = buildReleaseReadiness(input());
    const throughput = readiness.sections.find((s) => s.key === "throughput");
    expect(throughput?.basis).toMatch(/unknown/i);
    expect(throughput?.basis).toMatch(/not zero/i);
    expect(readiness.blockers.map((b) => b.text).join(" ")).not.toMatch(/throughput/i);
  });

  it("reports a real merge count when one was collected", () => {
    const readiness = buildReleaseReadiness(
      input({ insight: { lastReleaseTag: "v1", lastReleaseAt: daysAgo(30), mergedLast30Days: 12 } }),
    );
    expect(readiness.sections.find((s) => s.key === "throughput")?.basis).toContain("12");
  });

  it("flags a PR merged while its checks were failing", () => {
    const readiness = buildReleaseReadiness(
      input({ prs: [pr({ number: 5, state: "ci_failing", githubState: "MERGED" })] }),
    );
    expect(readiness.blockers.some((b) => b.text.includes("#5"))).toBe(true);
    expect(readiness.blockers.find((b) => b.text.includes("#5"))?.basis).toMatch(/confirm/i);
  });

  it("raises a missing changelog as a prompt to check, not a defect", () => {
    const readiness = buildReleaseReadiness(input());
    const blocker = readiness.blockers.find((b) => /changelog/i.test(b.text));
    expect(blocker).toBeDefined();
    expect(blocker?.basis).toMatch(/not a defect|prompt to check/i);
  });

  it("raises no changelog blocker when one exists at the root", () => {
    const readiness = buildReleaseReadiness(
      input({
        structure: {
          topLevel: ["CHANGELOG.md", "src"],
          workflowNames: [],
          profile: EMPTY_PROFILE,
          codeowners: null,
        },
      }),
    );
    expect(readiness.blockers.filter((b) => /changelog/i.test(b.text))).toEqual([]);
    expect(readiness.sections.find((s) => s.key === "documentation")?.basis).toMatch(/detected/i);
  });

  it("lists open conflicting PRs separately from blockers", () => {
    const readiness = buildReleaseReadiness(
      input({ prs: [pr({ number: 8, githubState: "OPEN", state: "conflicts" })] }),
    );
    const section = readiness.sections.find((s) => s.key === "open_conflicts");
    expect(section?.items.map((i) => i.label)).toEqual(["#8"]);
    expect(readiness.blockers.filter((b) => /#8/.test(b.text))).toEqual([]);
  });

  it("ranks contributors by merged count, then by login for a stable order", () => {
    const readiness = buildReleaseReadiness(
      input({
        prs: [
          pr({ number: 1, authorLogin: "zoe" }),
          pr({ number: 2, authorLogin: "ada" }),
          pr({ number: 3, authorLogin: "ada" }),
        ],
      }),
    );
    expect(readiness.contributors).toEqual([
      { login: "ada", mergedCount: 2 },
      { login: "zoe", mergedCount: 1 },
    ]);
  });

  it("names the window in the headline rather than implying completeness", () => {
    const readiness = buildReleaseReadiness(input({ prs: [pr()] }));
    expect(readiness.headline).toContain("30 days");
    expect(readiness.mergedSinceLastRelease).toBe(1);
  });

  it("reports zero merged without dressing it up", () => {
    const readiness = buildReleaseReadiness(input());
    expect(readiness.mergedSinceLastRelease).toBe(0);
    expect(readiness.headline).toMatch(/No merged pull requests/i);
  });

  it("names detected security tooling instead of guessing at its absence", () => {
    const withTooling = buildReleaseReadiness(
      input({
        structure: {
          topLevel: ["SECURITY.md"],
          workflowNames: [],
          profile: { ...EMPTY_PROFILE, securityTooling: ["SECURITY.md"] },
          codeowners: null,
        },
      }),
    );
    expect(withTooling.sections.find((s) => s.key === "security")?.basis).toContain("SECURITY.md");

    const without = buildReleaseReadiness(input());
    expect(without.sections.find((s) => s.key === "security")?.basis).toMatch(/no security tooling/i);
  });

  it("counts PRs whose labels look like deferred work in open work", () => {
    const readiness = buildReleaseReadiness(input({ prs: [pr({ number: 2, githubState: "OPEN" })] }));
    const section = readiness.sections.find((s) => s.key === "open_work");
    expect(section?.items).toHaveLength(1);
    expect(section?.basis).toMatch(/deliberately deferred/i);
  });
});

describe("releaseImplications", () => {
  const structure = (hasTests: boolean) => ({
    topLevel: [] as string[],
    workflowNames: [],
    profile: { ...EMPTY_PROFILE, hasTests },
    codeowners: null,
  });

  it("reports docs and test implications from the merged window", () => {
    const { findings, pathCount } = releaseImplications(
      [pr({ number: 1, snapshotJson: JSON.stringify({ files: [{ path: "docs/install.md" }] }) })],
      structure(true),
    );
    expect(pathCount).toBe(1);
    expect(findings.length).toBeGreaterThan(0);
    // The findings keep their own kind: a docs implication surfaced on the
    // release surface is still a docs implication, and re-labelling it would
    // lose the workflow it belongs to.
    expect(findings.map((f) => f.kind)).toContain("docs_implications");
    for (const f of findings) expect(f.basis.trim()).not.toBe("");
  });

  it("reports zero changed paths when no merged PR recorded its file list", () => {
    const { findings, pathCount } = releaseImplications([pr({ number: 1 })], structure(true));
    expect(pathCount).toBe(0);
    expect(findings).toEqual([]);
  });

  it("says so when the repository has no test suite", () => {
    const { findings } = releaseImplications(
      [pr({ number: 1, snapshotJson: JSON.stringify({ files: [{ path: "src/a.ts" }] }) })],
      structure(false),
    );
    expect(findings.some((f) => f.id === "tests-none")).toBe(true);
  });
});