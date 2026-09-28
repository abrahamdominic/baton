import { describe, it, expect } from "vitest";
import {
  buildDeveloperBriefing,
  buildReviewBrief,
  type DigestBullet,
} from "./briefing";

const ev = (id: string, kind: string) => ({ id, kind, label: `${kind} label`, rank: 10 });

function profile(overrides: Record<string, unknown> = {}, evidence = [ev("e_repo", "repo")]) {
  return {
    id: "ins_1",
    revision: 3,
    repoId: "repo_1",
    description: "Payments service",
    topics: "[]",
    languages: JSON.stringify([{ name: "TypeScript", bytes: 900, percent: 80 }]),
    hasReadme: true,
    hasCodeowners: true,
    hasContributing: true,
    hasCiWorkflows: true,
    hasSecurityPolicy: true,
    hasLicense: true,
    defaultBranch: "main",
    openPullRequests: 4,
    openIssues: 9,
    mergedLast30Days: 31,
    contributorCount: 12,
    topContributors: JSON.stringify([{ login: "ada", commits: 120 }]),
    lastReleaseTag: "v2.3.0",
    lastReleaseAt: new Date("2026-01-05T00:00:00Z"),
    structure: JSON.stringify({ topLevel: ["src", "README.md", "package.json"], workflowNames: ["ci.yml"] }),
    ...overrides,
    evidence,
  } as Parameters<typeof buildDeveloperBriefing>[0];
}

const text = (b: DigestBullet[]) => b.map((x) => x.text).join(" | ");

describe("buildDeveloperBriefing", () => {
  it("stamps the digest with the profile revision it was rendered from", () => {
    const d = buildDeveloperBriefing(profile({ revision: 7 }), { days: 3, openPrs: [] });
    expect(d.revision).toBe(7);
    expect(d.kind).toBe("developer_briefing");
  });

  it("never emits a bullet without evidence", () => {
    const d = buildDeveloperBriefing(profile({}, []), { days: 3, openPrs: [] });
    expect(d.bullets).toEqual([]);
  });

  it("flags a repository with no merged PRs in 30 days as a risk", () => {
    const d = buildDeveloperBriefing(profile({ mergedLast30Days: 0 }), { days: 3, openPrs: [] });
    const b = d.bullets.find((x) => /No pull requests merged/.test(x.text));
    expect(b?.tone).toBe("risk");
  });

  it("does not raise the inactivity risk when PRs did merge", () => {
    const d = buildDeveloperBriefing(profile({ mergedLast30Days: 31 }), { days: 3, openPrs: [] });
    expect(d.bullets.some((x) => /No pull requests merged/.test(x.text))).toBe(false);
  });

  it("uses the singular for exactly one merge in the window", () => {
    const d = buildDeveloperBriefing(profile({ mergedLast30Days: 1 }), { days: 3, openPrs: [] });
    expect(d.bullets.some((x) => /1 pull request merged/.test(x.text))).toBe(true);
  });

  it("only lists PRs past the threshold", () => {
    const d = buildDeveloperBriefing(profile(), {
      days: 3,
      openPrs: [
        { number: 1, title: "old", url: "u", ageDays: 10 },
        { number: 2, title: "new", url: "u", ageDays: 1 },
      ],
    });
    expect(text(d.bullets)).toContain("#1");
    expect(text(d.bullets)).not.toContain("#2");
  });

  it("treats a PR exactly on the threshold as not yet stale", () => {
    const d = buildDeveloperBriefing(profile(), {
      days: 3,
      openPrs: [{ number: 9, title: "edge", url: "u", ageDays: 3 }],
    });
    expect(text(d.bullets)).not.toContain("#9");
  });

  it("caps the stale list so one neglected repository cannot flood the briefing", () => {
    const openPrs = Array.from({ length: 40 }, (_, i) => ({
      number: i + 1,
      title: "t",
      url: "u",
      ageDays: 10 + i,
    }));
    const d = buildDeveloperBriefing(profile(), { days: 3, openPrs });
    const stale = d.bullets.filter((x) => /past the 3-day threshold/.test(x.text));
    expect(stale).toHaveLength(5);
  });

  it("flags a missing CODEOWNERS file as a risk with the structure citation", () => {
    const d = buildDeveloperBriefing(profile({ hasCodeowners: false }, [ev("e_s", "structure")]), {
      days: 3,
      openPrs: [],
    });
    const b = d.bullets.find((x) => /No CODEOWNERS/.test(x.text));
    expect(b?.tone).toBe("risk");
    expect(b?.evidenceIds).toEqual(["e_s"]);
  });

  it("flags a contributor base of one as a risk", () => {
    const d = buildDeveloperBriefing(
      profile({ contributorCount: 1 }, [ev("e_c", "contributors")]),
      { days: 3, openPrs: [] },
    );
    expect(d.bullets.some((x) => /Only 1 contributor appears/.test(x.text))).toBe(true);
  });

  it("does not flag a healthy contributor base", () => {
    const d = buildDeveloperBriefing(profile({ contributorCount: 40 }, [ev("e_c", "contributors")]), {
      days: 3,
      openPrs: [],
    });
    expect(d.bullets.some((x) => /Only \d+ contributor/.test(x.text))).toBe(false);
  });
});

describe("buildReviewBrief", () => {
  const pr = {
    number: 42,
    title: "Add webhooks",
    state: "awaiting_review",
    additions: 120,
    deletions: 30,
    changedFiles: 5,
    authorLogin: "ada",
    requestedReviewers: ["grace"],
    ageDays: 2,
  };

  it("summarises the diff size from the supplied PR facts", () => {
    const d = buildReviewBrief(profile(), pr);
    expect(text(d.bullets)).toContain("5 files (+120/-30)");
    expect(d.title).toBe("Review brief for #42");
  });

  it("uses singular wording for a one-file PR", () => {
    const d = buildReviewBrief(profile(), { ...pr, changedFiles: 1 });
    expect(text(d.bullets)).toContain("1 file ");
  });

  it("warns when no reviewers are requested", () => {
    const d = buildReviewBrief(profile(), { ...pr, requestedReviewers: [] });
    const b = d.bullets.find((x) => /No reviewers have been requested/.test(x.text));
    expect(b?.tone).toBe("risk");
  });

  it("does not warn when a reviewer is requested", () => {
    const d = buildReviewBrief(profile(), pr);
    expect(d.bullets.some((x) => /No reviewers have been requested/.test(x.text))).toBe(false);
  });

  it("points the reviewer at CODEOWNERS only when it exists", () => {
    const d = buildReviewBrief(profile({ hasCodeowners: false }, [ev("e_s", "structure")]), pr);
    expect(text(d.bullets)).toContain("no CODEOWNERS");
  });

  it("warns that there is no automated check when CI is absent", () => {
    const d = buildReviewBrief(profile({ hasCiWorkflows: false }, [ev("e_s", "structure")]), pr);
    expect(text(d.bullets)).toContain("no GitHub Actions workflows");
  });
});
