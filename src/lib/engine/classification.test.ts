import { describe, expect, it } from "vitest";
import { classifyPullRequest } from "./classification";
import type { CheckRunInfo, ReviewInfo, SnapshotInput } from "./types";

const NOW = new Date("2026-01-10T12:00:00Z");

function snapshot(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    prNumber: 1,
    title: "Test PR",
    url: "https://github.com/acme/widgets/pull/1",
    authorLogin: "author",
    headRef: "feature/x",
    headSha: "abc123",
    baseRef: "main",
    isDraft: false,
    githubState: "OPEN",
    mergeable: "MERGEABLE",
    reviewDecision: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-09T00:00:00Z",
    headPushedAt: "2026-01-08T00:00:00Z",
    labels: [],
    reviews: [],
    requestedReviewerLogins: ["reviewer"],
    requestedTeamSlugs: [],
    checks: [],
    now: NOW,
    ...overrides,
  };
}

const review = (state: ReviewInfo["state"], login = "reviewer", at = "2026-01-05T00:00:00Z"): ReviewInfo => ({
  state,
  authorLogin: login,
  submittedAt: at,
  isBot: false,
});

const check = (conclusion: CheckRunInfo["conclusion"], status = "COMPLETED"): CheckRunInfo => ({
  name: `check-${conclusion}`,
  status,
  conclusion,
  appSlug: "github-actions",
});

describe("classifyPullRequest", () => {
  it("classifies merged and closed terminally", () => {
    expect(classifyPullRequest(snapshot({ githubState: "MERGED" })).state).toBe("merged");
    expect(classifyPullRequest(snapshot({ githubState: "CLOSED" })).state).toBe("closed");
  });

  it("classifies drafts before anything else", () => {
    const c = classifyPullRequest(snapshot({ isDraft: true, mergeable: "CONFLICTING" }));
    expect(c.state).toBe("draft");
    expect(c.nudgable).toBe(false);
  });

  it("conflicts dominate CI and review state", () => {
    const c = classifyPullRequest(snapshot({ mergeable: "CONFLICTING", checks: [check("FAILURE")] }));
    expect(c.state).toBe("conflicts");
    expect(c.whoseTurn).toBe("author");
    expect(c.nudgable).toBe(true);
  });

  it("CI failure is next after conflicts", () => {
    const c = classifyPullRequest(snapshot({ checks: [check("FAILURE")] }));
    expect(c.state).toBe("ci_failing");
    expect(c.reasons[0]).toContain("failing");
  });

  it("treats cancelled and timed out checks as failing", () => {
    expect(classifyPullRequest(snapshot({ checks: [check("TIMED_OUT")] })).state).toBe("ci_failing");
    expect(classifyPullRequest(snapshot({ checks: [check("CANCELLED")] })).state).toBe("ci_failing");
  });

  it("approved with pending checks is blocked_on_checks and not nudgable", () => {
    const c = classifyPullRequest(
      snapshot({
        mergeable: "UNKNOWN",
        reviewDecision: "APPROVED",
        reviews: [review("APPROVED")],
        checks: [check(null, "IN_PROGRESS")],
      }),
    );
    expect(c.state).toBe("blocked_on_checks");
    expect(c.nudgable).toBe(false);
  });

  it("unanswered change requests are changes_required (author's turn)", () => {
    const c = classifyPullRequest(
      snapshot({
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [review("CHANGES_REQUESTED", "reviewer", "2026-01-09T00:00:00Z")],
        headPushedAt: "2026-01-05T00:00:00Z",
      }),
    );
    expect(c.state).toBe("changes_required");
    expect(c.whoseTurn).toBe("author");
    expect(c.nudgable).toBe(true);
  });

  it("fixes pushed after a change request await re-review", () => {
    const c = classifyPullRequest(
      snapshot({
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [review("CHANGES_REQUESTED", "reviewer", "2026-01-05T00:00:00Z")],
        headPushedAt: "2026-01-08T00:00:00Z",
      }),
    );
    expect(c.state).toBe("awaiting_review_after_fix");
    expect(c.whoseTurn).toBe("reviewers");
  });

  it("a later approval overrides an older change request", () => {
    const c = classifyPullRequest(
      snapshot({
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        reviews: [
          review("CHANGES_REQUESTED", "reviewer", "2026-01-03T00:00:00Z"),
          review("APPROVED", "reviewer", "2026-01-09T00:00:00Z"),
        ],
        headPushedAt: "2026-01-04T00:00:00Z",
      }),
    );
    expect(c.state).toBe("ready_to_merge");
  });

  it("approved + green + mergeable is ready_to_merge", () => {
    const c = classifyPullRequest(
      snapshot({
        reviewDecision: "APPROVED",
        reviews: [review("APPROVED")],
        checks: [check("SUCCESS")],
      }),
    );
    expect(c.state).toBe("ready_to_merge");
    expect(c.whoseTurn).toBe("maintainer_or_author");
  });

  it("no decision with reviewers requested is awaiting_review", () => {
    const c = classifyPullRequest(snapshot({ requestedReviewerLogins: ["a", "b"] }));
    expect(c.state).toBe("awaiting_review");
    expect(c.whoseTurn).toBe("reviewers");
    expect(c.hasFirstResponse).toBe(false);
  });

  it("ignores bot reviews when computing human state", () => {
    const bot: ReviewInfo = {
      state: "CHANGES_REQUESTED",
      authorLogin: "coderabbitai[bot]",
      submittedAt: "2026-01-09T00:00:00Z",
      isBot: true,
    };
    const c = classifyPullRequest(snapshot({ reviews: [bot] }));
    expect(c.state).toBe("awaiting_review");
    expect(c.hasFirstResponse).toBe(false);
  });
});
