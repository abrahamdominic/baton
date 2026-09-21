import { describe, expect, it } from "vitest";
import type { RepoSetting } from "@prisma/client";
import { decideNudge, parseNudgeBuckets, thresholdHoursFor } from "./nudges";
import type { Classification, SnapshotInput } from "./types";

function setting(overrides: Partial<RepoSetting> = {}): RepoSetting {
  return {
    id: "s1",
    repoId: "r1",
    statusCommentEnabled: true,
    labelsEnabled: true,
    nudgesEnabled: true,
    firstResponseHours: 24,
    reviewFollowUpHours: 36,
    changesRequiredHours: 72,
    ciFailHours: 24,
    conflictHours: 12,
    readyToMergeHours: 48,
    maxNudgesPerState: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RepoSetting;
}

const input = {
  prNumber: 1,
  title: "T",
  url: "https://github.com/a/b/pull/1",
  authorLogin: "author",
  headRef: "x",
  headSha: "s",
  baseRef: "main",
  isDraft: false,
  githubState: "OPEN",
  mergeable: "MERGEABLE",
  reviewDecision: "",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  headPushedAt: null,
  labels: [],
  reviews: [],
  requestedReviewerLogins: ["reviewer"],
  requestedTeamSlugs: [],
  checks: [],
  now: new Date(),
} as SnapshotInput;

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    state: "ci_failing",
    action: "fix it",
    reasons: ["CI failed"],
    whoseTurn: "author",
    nudgable: true,
    hasFirstResponse: false,
    prevState: "",
    ...overrides,
  };
}

describe("thresholdHoursFor", () => {
  it("maps each nudgable state to its configured threshold", () => {
    const s = setting();
    expect(thresholdHoursFor(s, "awaiting_review")).toBe(24);
    expect(thresholdHoursFor(s, "awaiting_review_after_fix")).toBe(36);
    expect(thresholdHoursFor(s, "changes_required")).toBe(72);
    expect(thresholdHoursFor(s, "ci_failing")).toBe(24);
    expect(thresholdHoursFor(s, "conflicts")).toBe(12);
    expect(thresholdHoursFor(s, "ready_to_merge")).toBe(48);
    expect(thresholdHoursFor(s, "draft")).toBeNull();
    expect(thresholdHoursFor(s, "merged")).toBeNull();
  });
});

describe("parseNudgeBuckets", () => {
  it("parses valid JSON arrays and tolerates garbage", () => {
    expect(parseNudgeBuckets('[{"key":"nudge:ci_failing","firedAt":"2026-01-01T00:00:00Z"}]')).toHaveLength(1);
    expect(parseNudgeBuckets("not json")).toEqual([]);
    expect(parseNudgeBuckets("{}")).toEqual([]);
  });
});

describe("decideNudge", () => {
  it("does not nudge before the threshold elapses", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification(),
      stateActiveHours: 23,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(false);
  });

  it("nudges once the threshold elapses", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification(),
      stateActiveHours: 25,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(true);
    expect(d.bucketKey).toBe("nudge:ci_failing");
    expect(d.body).toContain("baton-nudge");
  });

  it("respects maxNudgesPerState", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification(),
      stateActiveHours: 500,
      existingBuckets: [{ key: "nudge:ci_failing", firedAt: "2026-01-01T00:00:00Z" }],
      input,
    });
    expect(d.shouldNudge).toBe(false);
  });

  it("never nudges when nudges are disabled", () => {
    const d = decideNudge({
      setting: setting({ nudgesEnabled: false }),
      classification: classification(),
      stateActiveHours: 1000,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(false);
  });

  it("does not fire a first-response nudge once a human has replied", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification({ state: "awaiting_review", hasFirstResponse: true }),
      stateActiveHours: 1000,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(false);
  });

  it("fires the first-response nudge when nobody has replied", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification({ state: "awaiting_review", hasFirstResponse: false }),
      stateActiveHours: 25,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(true);
  });

  it("does not nudge a non-nudgable state", () => {
    const d = decideNudge({
      setting: setting(),
      classification: classification({ state: "blocked_on_checks", nudgable: false }),
      stateActiveHours: 1000,
      existingBuckets: [],
      input,
    });
    expect(d.shouldNudge).toBe(false);
  });
});
