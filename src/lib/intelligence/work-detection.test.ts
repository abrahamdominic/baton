import { describe, it, expect } from "vitest";
import { classifyWorkSignals, LIVE_PR_STATES, type WorkSignal } from "./work-detection";

/**
 * The classifier decides what a developer is told they have to deal with, so the
 * negative cases matter as much as the positive ones: a signal that fires for a
 * healthy pull request is worse than no signal at all, because it costs
 * attention and erodes trust in every other signal.
 */

const REPO = { owner: "acme", name: "widgets" };
const NOW = new Date("2026-03-01T00:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function pr(overrides: Partial<Parameters<typeof classifyWorkSignals>[0][number]> = {}) {
  return {
    number: 42,
    title: "Add widget cache",
    url: "https://github.com/acme/widgets/pull/42",
    state: "awaiting_review",
    isDraft: false,
    authorLogin: "dev",
    headRef: "feat/widget-cache",
    baseRef: "main",
    reviewDecision: "REVIEW_REQUIRED",
    requestedReviewersJson: "[]",
    stateEnteredAt: daysAgo(1),
    githubUpdatedAt: daysAgo(1),
    ...overrides,
  };
}

const kinds = (signals: WorkSignal[]) => signals.map((s) => s.kind).sort();

/**
 * `PrRow.state` is a free-form string, but the rules below switch on the exact
 * Baton classification values. A typo there (`awaiting_review_after_changes`)
 * would silently drop a whole signal class with no test failure, so the values
 * are asserted against the same source the query uses.
 */
describe("classifyWorkSignals — state values", () => {
  it("uses only real Baton PR states", () => {
    expect([...LIVE_PR_STATES].sort()).toEqual(
      [
        "approved",
        "approved_after_fix",
        "awaiting_review",
        "awaiting_review_after_fix",
        "changes_required",
        "ci_failing",
        "conflicts",
        "draft",
      ].sort(),
    );
  });

  it("produces a signal for every state it queries for", () => {
    // A state in the query filter that no rule can act on is a silent no-op:
    // the database pays for the row and the developer sees nothing.
    for (const state of LIVE_PR_STATES) {
      const s = classifyWorkSignals(
        [pr({ state, isDraft: state === "draft", reviewDecision: state === "approved" ? "APPROVED" : "REVIEW_REQUIRED" })],
        "dev",
        REPO,
        NOW,
      );
      // These two states are only actionable for someone who is *not* the
      // author, and only once they have been asked to review. A plain fixture
      // is authored by the viewer and requested by nobody, so there is
      // correctly nothing to report.
      if (state === "draft" || state === "awaiting_review" || state === "awaiting_review_after_fix") {
        expect(s, `state "${state}" fired unexpectedly for an uninvolved viewer`).toEqual([]);
        continue;
      }
      expect(s.length, `no signal produced for live state "${state}"`).toBeGreaterThan(0);
    }
  });
});

describe("classifyWorkSignals — signals proven by stored state", () => {
  it("flags a review the developer was personally requested for", () => {
    const s = classifyWorkSignals(
      [pr({ authorLogin: "someone-else", requestedReviewersJson: '["Dev"]', stateEnteredAt: daysAgo(3) })],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(s)).toContain("review_requested");
    expect(s[0]!.confidence).toBe("high");
    expect(s[0]!.href).toBe("/dashboard/repos/acme/widgets/pulls/42");
  });

  it("matches the viewer login case-insensitively", () => {
    const s = classifyWorkSignals(
      [pr({ authorLogin: "other", requestedReviewersJson: '["DEV"]' })],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(s)).toContain("review_requested");
  });

  it("flags changes requested on the developer's own pull request", () => {
    const s = classifyWorkSignals(
      [
        pr({
          state: "changes_required",
          reviewDecision: "CHANGES_REQUESTED",
          stateEnteredAt: daysAgo(2),
          githubUpdatedAt: daysAgo(1),
        }),
      ],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(s)).toContain("changes_requested");
    expect(s.find((x) => x.kind === "changes_requested")!.confidence).toBe("high");
  });

  it("flags failing CI, conflicts and approved-but-unmerged work", () => {
    expect(kinds(classifyWorkSignals([pr({ state: "ci_failing" })], "dev", REPO, NOW))).toContain("ci_failing");
    expect(kinds(classifyWorkSignals([pr({ state: "conflicts" })], "dev", REPO, NOW))).toContain("conflicts");

    const approved = classifyWorkSignals(
      [pr({ state: "approved", reviewDecision: "APPROVED", stateEnteredAt: daysAgo(4) })],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(approved)).toContain("approved_waiting");
  });

  it("does not report approved-but-unmerged when the PR is broken", () => {
    // A PR that is approved *and* failing CI needs fixing, not merging, so the
    // "waiting to merge" framing would be actively misleading.
    const s = classifyWorkSignals(
      [pr({ state: "ci_failing", reviewDecision: "APPROVED" })],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(s)).not.toContain("approved_waiting");
  });

  it("flags a PR that was approved and then changed, which still shows a green approval", () => {
    const s = classifyWorkSignals([pr({ state: "approved_after_fix", stateEnteredAt: daysAgo(5) })], "dev", REPO, NOW);
    expect(kinds(s)).toContain("needs_rereview");
    expect(s[0]!.confidence).toBe("high");
  });

  it("does not report a review the developer was not asked for", () => {
    const s = classifyWorkSignals([pr({ authorLogin: "other", requestedReviewersJson: '["someone"]' })], "dev", REPO, NOW);
    expect(kinds(s)).not.toContain("review_requested");
  });

  it("does not report state signals on pull requests the developer did not author", () => {
    const s = classifyWorkSignals(
      [pr({ authorLogin: "other", state: "changes_required", reviewDecision: "CHANGES_REQUESTED" })],
      "dev",
      REPO,
      NOW,
    );
    expect(kinds(s)).toEqual([]);
  });

  it("reports nothing for a healthy pull request", () => {
    const s = classifyWorkSignals(
      [pr({ stateEnteredAt: daysAgo(1), githubUpdatedAt: daysAgo(1) })],
      "dev",
      REPO,
      NOW,
    );
    expect(s).toEqual([]);
  });
});

describe("classifyWorkSignals — signals inferred from inactivity", () => {
  it("marks time-based signals as medium confidence", () => {
    const s = classifyWorkSignals([pr({ githubUpdatedAt: daysAgo(12) })], "dev", REPO, NOW);
    const stalled = s.find((x) => x.kind === "stalled_author");
    expect(stalled).toBeDefined();
    expect(stalled!.confidence).toBe("medium");
    expect(stalled!.evidence[0]!.label).toMatch(/last github update/i);
    // "Abandoned" is a claim Baton cannot make from a timestamp.
    expect(stalled!.detail).not.toMatch(/abandoned/i);
  });

  it("uses a longer stall threshold for drafts", () => {
    // A draft is unfinished work on purpose, so it should not be flagged a
    // week after being opened.
    const tenDays = classifyWorkSignals([pr({ isDraft: true, githubUpdatedAt: daysAgo(10) })], "dev", REPO, NOW);
    expect(kinds(tenDays)).not.toContain("stalled_author");
    expect(kinds(tenDays)).not.toContain("draft_stalled");

    const thirtyDays = classifyWorkSignals([pr({ isDraft: true, githubUpdatedAt: daysAgo(30) })], "dev", REPO, NOW);
    expect(kinds(thirtyDays)).toContain("draft_stalled");
  });

  it("never reports inactivity for a pull request the developer does not own", () => {
    const s = classifyWorkSignals([pr({ authorLogin: "other", githubUpdatedAt: daysAgo(90) })], "dev", REPO, NOW);
    expect(kinds(s)).toEqual([]);
  });

  it("ranks proven signals above inferred ones", () => {
    const s = classifyWorkSignals(
      [
        pr({ number: 1, authorLogin: "other", requestedReviewersJson: '["dev"]' }),
        pr({ number: 2, githubUpdatedAt: daysAgo(40) }),
      ],
      "dev",
      REPO,
      NOW,
    );
    expect(s[0]!.kind).toBe("review_requested");
    expect(s.at(-1)!.confidence).toBe("medium");
  });

  it("caps the number of signals so the panel stays actionable", () => {
    // Distinct ages keep the ordering deterministic before the cap applies.
    const many = Array.from({ length: 40 }, (_, i) =>
      pr({ number: i + 1, state: "changes_required", stateEnteredAt: daysAgo(i + 1) }),
    );
    const signals = classifyWorkSignals(many, "dev", REPO, NOW);
    expect(signals).toHaveLength(12);
    // The cap must keep the oldest work, not an arbitrary slice.
    expect(signals[0]!.ageDays).toBe(40);
    expect(signals.at(-1)!.ageDays).toBe(29);
  });

  it("carries the pull request coordinates into the saved payload", () => {
    const s = classifyWorkSignals([pr({ state: "ci_failing" })], "dev", REPO, NOW);
    const ci = s.find((x) => x.kind === "ci_failing")!;
    expect(ci.payload).toMatchObject({ prNumber: 42, branch: "feat/widget-cache", baseRef: "main" });
  });
});
