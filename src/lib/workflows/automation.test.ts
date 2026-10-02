import { describe, it, expect } from "vitest";
import {
  runWorkflows,
  staleWork,
  blockedWork,
  abandonedWork,
  waitingOnPeople,
  duplicateIssues,
  relatedWork,
  docsImplications,
  affectedTests,
  unownedChanges,
  dependencyChain,
  pathsFromSnapshot,
  allChangedPaths,
  WORKFLOW_LABELS,
  WORKFLOW_ORDER,
  type WorkflowPr,
  type WorkflowRunInput,
  type IssueLike,
} from "./automation";
import { EMPTY_PROFILE } from "@/lib/intelligence/profile";

/**
 * Tests for the workflow suite.
 *
 * Two properties are worth more than coverage of any single workflow:
 *
 * 1. Every finding is sourced. `assertFindings` enforces a non-empty basis, and
 *    these tests assert it independently so a future refactor cannot quietly
 *    delete the guard and still pass.
 * 2. "Nothing found" and "did not look" stay distinguishable. §11 forbids
 *    presenting an unexamined repository as a healthy one, and the `issues: null`
 *    case is exactly where that rule is easiest to break.
 */

const NOW = new Date("2026-03-02T12:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function pr(overrides: Partial<WorkflowPr> = {}): WorkflowPr {
  return {
    number: 1,
    title: "Add caching layer",
    state: "ready_to_merge",
    authorLogin: "ada",
    url: "https://github.com/acme/widgets/pull/1",
    baseRef: "main",
    headRef: "feature/cache",
    isDraft: false,
    githubState: "OPEN",
    reviewDecision: "APPROVED",
    requestedReviewersJson: "[]",
    labelsJson: "[]",
    checksJson: "[]",
    stateEnteredAt: daysAgo(1),
    githubUpdatedAt: daysAgo(1),
    createdAt: daysAgo(10),
    ...overrides,
  };
}

function issue(overrides: Partial<IssueLike> = {}): IssueLike {
  return {
    number: 100,
    title: "Cache layer is slow",
    body: "Requests are slow without a cache.",
    state: "open",
    url: "https://github.com/acme/widgets/issues/100",
    labels: [],
    createdAt: daysAgo(20),
    authorLogin: "bob",
    ...overrides,
  };
}

function input(overrides: Partial<WorkflowRunInput> = {}): WorkflowRunInput {
  return {
    prs: [],
    issues: [],
    structureCollected: true,
    structure: { topLevel: [], workflowNames: [], profile: { ...EMPTY_PROFILE, hasTests: true }, codeowners: null },
    now: NOW,
    thresholds: {
      staleDays: 14,
      inactiveDays: 30,
      duplicateThreshold: 0.6,
      relatedTokenThreshold: 0.35,
    },
    ...overrides,
  };
}

describe("staleWork", () => {
  it("flags a PR past the threshold with its recorded state date as the basis", () => {
    const findings = staleWork([pr({ number: 7, stateEnteredAt: daysAgo(40) })], NOW, {
      thresholdDays: 14,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("#7");
    expect(findings[0]!.basis).toContain(daysAgo(40).toISOString().slice(0, 10));
    expect(findings[0]!.basis).toContain("14 days");
    expect(findings[0]!.basis).not.toBe("");
  });

  it("leaves a PR exactly at the threshold alone", () => {
    // `<=` not `<`: "14 days in review" at a 14-day threshold is not yet stale.
    expect(staleWork([pr({ stateEnteredAt: daysAgo(14) })], NOW, { thresholdDays: 14 })).toEqual([]);
  });

  it("ignores merged and closed PRs", () => {
    const findings = staleWork(
      [pr({ number: 1, state: "merged" }), pr({ number: 2, state: "closed" })].map((p) => ({
        ...p,
        stateEnteredAt: daysAgo(90),
      })),
      NOW,
      { thresholdDays: 1 },
    );
    expect(findings).toEqual([]);
  });

  it("orders the most severe finding first", () => {
    const findings = staleWork(
      [pr({ number: 1, stateEnteredAt: daysAgo(20) }), pr({ number: 2, stateEnteredAt: daysAgo(80) })],
      NOW,
      { thresholdDays: 14 },
    );
    expect(findings.map((f) => f.id)).toEqual(["stale-2", "stale-1"]);
  });
});

describe("blockedWork", () => {
  it("reports conflicting PRs as blocked on a merge conflict, not on a person", () => {
    const findings = blockedWork([pr({ number: 3, state: "conflicts" })], NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("blocked_work");
    expect(findings[0]!.href).toContain("/pulls/3");
  });

  it("reports failing checks once the PR is recorded as failing", () => {
    const findings = blockedWork([pr({ number: 4, state: "ci_failing" })], NOW);
    expect(findings.map((f) => f.id)).toEqual(["blocked-ci-4"]);
  });

  it("does not flag a review that is merely pending", () => {
    expect(blockedWork([pr({ state: "awaiting_review" })], NOW)).toEqual([]);
  });
});

describe("abandonedWork", () => {
  it("flags a PR with no activity inside the inactivity window", () => {
    const findings = abandonedWork(
      [
        pr({
          number: 9,
          githubUpdatedAt: daysAgo(75),
          stateEnteredAt: daysAgo(75),
          reviewDecision: null,
          requestedReviewersJson: "[]",
        }),
      ],
      NOW,
      { inactiveDays: 30 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.basis).toContain(daysAgo(75).toISOString().slice(0, 10));
  });

  it("does not flag a quiet PR that somebody already engaged with", () => {
    // The three signals are ANDed on purpose: quiet alone is just a slow review.
    const engaged = [
      pr({
        number: 10,
        githubUpdatedAt: daysAgo(75),
        stateEnteredAt: daysAgo(75),
        requestedReviewersJson: JSON.stringify([{ login: "grace" }]),
      }),
    ];
    expect(abandonedWork(engaged, NOW, { inactiveDays: 30 })).toEqual([]);
  });

  it("does not flag a draft PR", () => {
    expect(
      abandonedWork([pr({ isDraft: true, githubUpdatedAt: daysAgo(75), stateEnteredAt: daysAgo(75) })], NOW, {
        inactiveDays: 30,
      }),
    ).toEqual([]);
  });

  it("respects the inactivity window as an input", () => {
    const quiet = [
      pr({
        githubUpdatedAt: daysAgo(45),
        stateEnteredAt: daysAgo(45),
        reviewDecision: null,
        requestedReviewersJson: "[]",
      }),
    ];
    expect(abandonedWork(quiet, NOW, { inactiveDays: 30 })).toHaveLength(1);
    expect(abandonedWork(quiet, NOW, { inactiveDays: 60 })).toEqual([]);
  });
});

describe("waitingOnPeople", () => {
  it("names the reviewers still outstanding", () => {
    const findings = waitingOnPeople(
      [
        pr({
          number: 5,
          state: "awaiting_review",
          requestedReviewersJson: JSON.stringify([{ login: "grace" }, { login: "linus" }]),
        }),
      ],
      NOW,
    );
    expect(findings.map((f) => f.actors[0])).toEqual(["grace", "linus"]);
    expect(findings.every((f) => f.basis.includes("requested reviewer"))).toBe(true);
  });

  it("ignores terminal states", () => {
    expect(
      waitingOnPeople(
        [pr({ state: "merged", requestedReviewersJson: JSON.stringify([{ login: "grace" }]) })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("says nobody was asked rather than guessing an owner", () => {
    const findings = waitingOnPeople(
      [pr({ number: 6, state: "awaiting_review", requestedReviewersJson: "[]" })],
      NOW,
    );
    expect(findings.map((f) => f.id)).toEqual(["waiting-none-6"]);
    expect(findings[0]!.basis).toContain("No requested reviewers");
  });

  it("survives malformed reviewer JSON rather than throwing", () => {
    const findings = waitingOnPeople([pr({ requestedReviewersJson: "{not json" })], NOW);
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe("duplicateIssues", () => {
  it("reports two issues with the same substance as a speculative match", () => {
    const findings = duplicateIssues(
      [
        issue({ number: 1, title: "Cache makes requests slow", body: "Pages load slowly without caching." }),
        issue({ number: 2, title: "Requests slow without cache", body: "Pages load slowly when uncached." }),
      ],
      { threshold: 0.6 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.confidence).toBe("speculative");
    expect(findings[0]!.basis).not.toBe("");
  });

  it("does not report unrelated issues", () => {
    const findings = duplicateIssues(
      [
        issue({ number: 1, title: "Cache makes requests slow", body: "Pages load slowly without caching." }),
        issue({ number: 2, title: "Upgrade the database driver", body: "The postgres client is unmaintained." }),
      ],
      { threshold: 0.6 },
    );
    expect(findings).toEqual([]);
  });

  it("returns nothing for fewer than two issues", () => {
    expect(duplicateIssues([issue()], { threshold: 0.6 })).toEqual([]);
    expect(duplicateIssues([], { threshold: 0.6 })).toEqual([]);
  });
});

describe("relatedWork", () => {
  it("links a PR to an issue it explicitly references", () => {
    const findings = relatedWork(
      [pr({ number: 11, title: "Fix cache eviction #100", headRef: "fix-cache" })],
      [issue({ number: 100, title: "Cache eviction bug" })],
      { tokenThreshold: 0.35 },
    );
    expect(findings.map((f) => f.id)).toEqual(["related-ref-11-100"]);
    expect(findings[0]!.confidence).toBe("observed");
    expect(findings[0]!.actors).toEqual(expect.arrayContaining(["ada", "bob"]));
  });

  it("reports a token-overlap match as speculative, below an explicit reference", () => {
    const findings = relatedWork(
      [pr({ number: 12, title: "Fix cache eviction bug", headRef: "fix-cache-eviction" })],
      [issue({ number: 101, title: "Cache eviction bug", body: "Cache eviction is wrong." })],
      { tokenThreshold: 0.35 },
    );
    expect(findings.some((f) => f.id.startsWith("related-token-"))).toBe(true);
    expect(findings.filter((f) => f.id.startsWith("related-token-")).every((f) => f.confidence === "speculative")).toBe(
      true,
    );
  });

  it("does not link an unrelated pair", () => {
    const findings = relatedWork(
      [pr({ number: 13, title: "Fix cache eviction", headRef: "fix-cache" })],
      [issue({ number: 102, title: "Dark mode toggle missing", body: "No way to switch themes." })],
      { tokenThreshold: 0.9 },
    );
    expect(findings).toEqual([]);
  });

  it("does not resurrect a merged PR as related work", () => {
    expect(
      relatedWork(
        [pr({ state: "merged", title: "Fix cache eviction #100" })],
        [issue({ number: 100, title: "Cache eviction bug" })],
        { tokenThreshold: 0.2 },
      ),
    ).toEqual([]);
  });
});

describe("docsImplications", () => {
  it("flags a user-facing surface change as needing documentation", () => {
    const findings = docsImplications(["src/app/api/routes/route.ts"]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.confidence === "derived")).toBe(true);
  });

  it("does not flag an internal test-only change", () => {
    expect(docsImplications(["src/lib/parser/tokenize.test.ts"])).toEqual([]);
  });

  it("reports a documentation change as observed, since the file list proves it", () => {
    const findings = docsImplications(["docs/install.md"]);
    expect(findings.find((f) => f.id === "docs-changed")?.confidence).toBe("observed");
  });
});

describe("affectedTests", () => {
  it("says so plainly when the repository has no tests", () => {
    const findings = affectedTests(["src/lib/thing.ts"], { hasTestsInRepo: false });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("tests-none");
    expect(findings[0]!.basis).toContain("No test file");
  });

  it("reports a changed test as its own affected area", () => {
    const findings = affectedTests(["src/lib/tokenize.test.ts"], { hasTestsInRepo: true });
    expect(findings.some((f) => f.confidence === "observed")).toBe(true);
  });

  it("maps a source change to the directory holding its tests", () => {
    const findings = affectedTests(["src/billing/refund.ts"], { hasTestsInRepo: true });
    expect(findings.some((f) => f.basis.includes("refund") || f.basis.includes("src/billing"))).toBe(true);
  });
});

describe("unownedChanges", () => {
  // No `*` rule on purpose: a catch-all assigns an owner to every path, so a
  // repository with one can never have an unowned change. That is the whole
  // premise of this workflow, and a test that used `*` would prove nothing.
  const CODEOWNERS = "docs/ @acme/writers\nsrc/billing/ @acme/payments";

  it("flags a changed path no CODEOWNERS rule matches", () => {
    const findings = unownedChanges(["src/lib/parser/tokenize.ts"], CODEOWNERS);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.paths).toEqual(["src/lib/parser/tokenize.ts"]);
  });

  it("stays quiet for a path a rule matches", () => {
    expect(unownedChanges(["docs/handbook.md"], CODEOWNERS)).toEqual([]);
    expect(unownedChanges(["src/billing/refund.ts"], CODEOWNERS)).toEqual([]);
  });

  it("reports every unowned path in one finding rather than one finding per path", () => {
    const findings = unownedChanges(["src/a.ts", "src/b.ts", "docs/c.md"], CODEOWNERS);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns nothing when there is no CODEOWNERS text or nothing changed", () => {
    expect(unownedChanges(["src/a.ts"], null)).toEqual([]);
    expect(unownedChanges(["src/a.ts"], "")).toEqual([]);
    expect(unownedChanges(["src/a.ts"], "# only comments here")).toEqual([]);
    expect(unownedChanges([], CODEOWNERS)).toEqual([]);
  });
});

describe("dependencyChain", () => {
  it("reports a PR stacked on another open PR as a chain", () => {
    const findings = dependencyChain([
      pr({ number: 20, headRef: "feature/base" }),
      pr({ number: 21, headRef: "feature/base-layer", baseRef: "feature/base" }),
    ]);
    expect(findings.some((f) => f.basis.includes("#20"))).toBe(true);
  });

  it("does not report a PR branched from the default branch", () => {
    expect(dependencyChain([pr({ number: 22, headRef: "feature/x", baseRef: "main" })])).toEqual([]);
  });
});

describe("pathsFromSnapshot", () => {
  it("reads paths from object entries", () => {
    const paths = pathsFromSnapshot(JSON.stringify({ files: [{ path: "a.ts" }, { path: "b.ts" }] }));
    expect(paths).toEqual(["a.ts", "b.ts"]);
  });

  it("returns null — not an empty list — when nothing was collected", () => {
    expect(pathsFromSnapshot(null)).toBeNull();
    expect(pathsFromSnapshot("")).toBeNull();
    expect(pathsFromSnapshot(JSON.stringify({}))).toBeNull();
    expect(pathsFromSnapshot(JSON.stringify({ files: [] }))).toBeNull();
  });

  it("survives corrupt JSON", () => {
    expect(pathsFromSnapshot("{oops")).toBeNull();
  });
});

describe("allChangedPaths", () => {
  it("unions paths across PRs and ignores PRs with no snapshot", () => {
    const paths = allChangedPaths([
      pr({ number: 1, snapshotJson: JSON.stringify({ files: [{ path: "a.ts" }] }) }),
      pr({ number: 2, snapshotJson: JSON.stringify({ files: [{ path: "a.ts" }, { path: "b.ts" }] }) }),
      pr({ number: 3 }),
    ]);
    expect(paths.sort()).toEqual(["a.ts", "b.ts"]);
  });
});

describe("runWorkflows", () => {
  it("returns one run per workflow, each with a basis for every finding", () => {
    const runs = runWorkflows(input({ prs: [pr({ number: 30, stateEnteredAt: daysAgo(40) })] }));
    const kinds = runs.map((r) => r.kind);
    for (const kind of new Set(kinds)) expect(kinds).toContain(kind);
    for (const run of runs) {
      for (const f of run.findings) {
        expect(f.kind).toBe(run.kind);
        expect(f.basis.trim()).not.toBe("");
        expect(f.title.trim()).not.toBe("");
      }
    }
  });

  it("runs the workflows that were previously declared but never executed", () => {
    const runs = runWorkflows(
      input({
        prs: [pr({ number: 31, snapshotJson: JSON.stringify({ files: [{ path: "docs/install.md" }] }) })],
      }),
    );
    const byKind = new Map(runs.map((r) => [r.kind, r]));
    expect(byKind.get("docs_implications")?.findings.length ?? 0).toBeGreaterThan(0);
    expect(byKind.get("affected_tests")).toBeDefined();
  });

  it("marks issue-shaped work as unavailable when no issues were collected", () => {
    const runs = runWorkflows(input({ issues: null }));
    const duplicate = runs.find((r) => r.kind === "duplicate_issues");
    expect(duplicate?.findings).toEqual([]);
    expect(duplicate?.unavailable).toBeTruthy();
    expect(duplicate?.unavailable).toMatch(/issue/i);
  });

  it("still runs PR-side related work when issues were never collected", () => {
    const runs = runWorkflows(
      input({
        issues: null,
        prs: [
          pr({ number: 40, title: "Fix cache eviction", headRef: "fix-cache" }),
          pr({ number: 41, title: "Cache eviction follow-up", headRef: "cache-eviction-2" }),
        ],
      }),
    );
    const related = runs.find((r) => r.kind === "related_work");
    expect(related?.unavailable).toBeUndefined();
  });

  it("distinguishes a collected-empty issue list from an uncollected one", () => {
    const collected = runWorkflows(input({ issues: [] }));
    const missing = runWorkflows(input({ issues: null }));
    expect(collected.find((r) => r.kind === "duplicate_issues")?.unavailable).toBeUndefined();
    expect(missing.find((r) => r.kind === "duplicate_issues")?.unavailable).toBeDefined();
  });

  it("reports structure-dependent workflows as unavailable when nothing was collected", () => {
    // An uncollected repository has an empty structure, which is indistinguishable
    // from a collected one that found no CODEOWNERS and no tests. Claiming either
    // about code nobody read is exactly the false fact the brief forbids.
    const runs = runWorkflows(input({ structureCollected: false }));
    for (const kind of ["unowned_changes", "affected_tests"] as const) {
      const run = runs.find((r) => r.kind === kind);
      expect(run?.findings).toEqual([]);
      expect(run?.unavailable).toMatch(/not collected/i);
    }
  });

  it("still runs PR-derived workflows when nothing was collected", () => {
    const runs = runWorkflows(
      input({ structureCollected: false, prs: [pr({ number: 60, stateEnteredAt: daysAgo(40) })] }),
    );
    expect(runs.find((r) => r.kind === "stale_work")?.findings).toHaveLength(1);
  });

  it("reports a missing CODEOWNERS as a finding rather than an empty section", () => {
    const runs = runWorkflows(input());
    const unowned = runs.find((r) => r.kind === "unowned_changes");
    expect(unowned?.findings.map((f) => f.id)).toContain("no-codeowners");
    expect(unowned?.unavailable).toBeUndefined();
  });

  it("reports structure-derived workflows as unavailable when nothing was collected", () => {
    // An uncollected repository must not be described as having no CODEOWNERS
    // and no test suite: both would be assertions about files nobody read.
    const runs = runWorkflows(input({ structureCollected: false }));
    for (const kind of ["unowned_changes", "affected_tests"] as const) {
      const run = runs.find((r) => r.kind === kind);
      expect(run?.findings).toEqual([]);
      expect(run?.unavailable).toMatch(/not collected/i);
    }
    // PR-derived findings still run: they depend on stored PR state, not structure.
    expect(runs.find((r) => r.kind === "dependency_chains")?.unavailable).toBeUndefined();
  });

  it("isolates one workflow's failure instead of losing the whole run", () => {
    const hostile = pr({ number: 50, checksJson: "null", labelsJson: "null", requestedReviewersJson: "null" });
    Object.defineProperty(hostile, "stateEnteredAt", {
      get() {
        throw new Error("boom");
      },
    });
    const runs = runWorkflows(input({ prs: [hostile, pr({ number: 51, stateEnteredAt: daysAgo(40) })] }));
    expect(runs.find((r) => r.kind === "stale_work")?.unavailable).toBeTruthy();
    expect(runs.find((r) => r.kind === "waiting_on_people")).toBeDefined();
  });
});

describe("workflow catalogue", () => {
  it("labels every kind", () => {
    const kinds = [...runWorkflows(input()).map((r) => r.kind), "release_readiness" as const];
    for (const kind of kinds) expect(WORKFLOW_LABELS[kind]).toBeTruthy();
  });

  it("renders release readiness first-to-last in WORKFLOW_ORDER without duplicates", () => {
    expect(new Set(WORKFLOW_ORDER).size).toBe(WORKFLOW_ORDER.length);
    expect(WORKFLOW_ORDER).toContain("blocked_work");
    expect(WORKFLOW_ORDER).toContain("release_readiness");
  });
});