import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EMPTY_PROFILE } from "./profile";

/**
 * Database cover for the intelligence persistence layer.
 *
 * These run against a real database because the properties under test are
 * relational, not functional: evidence must reference an insight that actually
 * exists, change detection must compare stored JSON columns correctly, and a
 * work context must never be readable by a user who lost repository access.
 *
 * The highest-value case here is the last one. Losing access to a repository is
 * an ordinary event (a team member leaves, an install is removed), and a saved
 * context that still renders a private repository name and PR title is a data
 * leak, not a cosmetic bug.
 */

const { prisma } = await import("@/lib/db");
const { saveRepositoryIntelligence } = await import("@/lib/intelligence/collect");
const { rememberContext, recentContexts, restoreContext, nextActionsFor } = await import(
  "@/lib/intelligence/context"
);
const { saveDigest, loadDigest, buildDeveloperBriefing } = await import("@/lib/intelligence/briefing");
const { askQuestion } = await import("@/lib/intelligence/answer");

const stamp = `intel${Date.now().toString(36)}`;
const installationId = 7_100_000 + (Date.now() % 800_000);

let owner: { id: string; login: string };
let outsider: { id: string; login: string };
let installationRowId: string;
let repoRowId: string;

type Collected = Parameters<typeof saveRepositoryIntelligence>[1];

function collected(overrides: Partial<Collected> = {}): Collected {
  return {
    description: "A test service",
    homepage: null,
    topics: ["testing"],
    languages: [{ name: "TypeScript", bytes: 100, percent: 100 }],
    hasReadme: true,
    hasCodeowners: true,
    hasContributing: false,
    hasCiWorkflows: true,
    hasSecurityPolicy: false,
    hasLicense: true,
    defaultBranch: "main",
    openPullRequests: 2,
    openIssues: 5,
    mergedLast30Days: 10,
    contributorCount: 4,
    topContributors: [{ login: "ada", commits: 50 }],
    lastReleaseTag: "v1.0.0",
    lastReleaseAt: new Date("2026-02-01T00:00:00Z"),
    structure: { topLevel: ["src"], workflowNames: ["ci.yml"], profile: EMPTY_PROFILE, codeowners: null },
    evidence: [
      { kind: "repo", label: "Repository metadata", url: "https://github.com/a/b", rank: 70 },
      { kind: "codeowners", label: "CODEOWNERS present", path: "CODEOWNERS", rank: 10 },
      { kind: "workflow", label: "CI configured", path: ".github/workflows/ci.yml", rank: 30 },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
  owner = await prisma.user.create({ data: { githubId: Math.floor(Math.random() * 1e9) + 5e8, login: `${stamp}-owner` } });
  outsider = await prisma.user.create({ data: { githubId: Math.floor(Math.random() * 1e9) + 5e8, login: `${stamp}-outsider` } });

  const inst = await prisma.appInstallation.create({
    data: { installationId, accountLogin: `${stamp}-owner`, accountType: "User", userId: owner.id },
    select: { id: true },
  });
  installationRowId = inst.id;

  const repo = await prisma.repo.create({
    data: {
      installationId: installationRowId,
      repoId: BigInt(installationId) + 1n,
      owner: "acme",
      name: "widgets",
      fullName: `${stamp}/acme/widgets`,
      defaultBranch: "main",
    },
    select: { id: true },
  });
  repoRowId = repo.id;
});

afterAll(async () => {
  await prisma.appInstallation.deleteMany({ where: { installationId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("saveRepositoryIntelligence", () => {
  it("creates a profile with its evidence linked to the insight", async () => {
    const { insightId } = await saveRepositoryIntelligence(repoRowId, collected());
    const rows = await prisma.repoEvidence.findMany({ where: { insightId } });
    expect(rows).toHaveLength(3);
    // Every evidence row must point at the insight it was written for.
    for (const r of rows) expect(r.insightId).toBe(insightId);
  });

  it("upserts rather than creating a second profile for the same repository", async () => {
    await saveRepositoryIntelligence(repoRowId, collected());
    await saveRepositoryIntelligence(repoRowId, collected({ description: "Changed" }));
    const all = await prisma.repositoryInsight.findMany({ where: { repoId: repoRowId } });
    expect(all).toHaveLength(1);
    expect(all[0]!.description).toBe("Changed");
  });

  it("bumps the revision only when the facts actually changed", async () => {
    await saveRepositoryIntelligence(repoRowId, collected({ description: "v1" }));
    const first = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });

    // Re-saving identical data must not churn the revision, otherwise every
    // scheduled run would invalidate every cached digest.
    await saveRepositoryIntelligence(repoRowId, collected({ description: "v1" }));
    const second = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    expect(second.revision).toBe(first.revision);

    await saveRepositoryIntelligence(repoRowId, collected({ description: "v2" }));
    const third = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    expect(third.revision).toBe(first.revision + 1);
  });

  it("does not treat a different JSON key order in stored columns as a change", async () => {
    await saveRepositoryIntelligence(repoRowId, collected({ description: "stable", topics: ["a", "b"] }));
    const before = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    // Re-collect the same facts; the stored JSON is re-serialised each run.
    await saveRepositoryIntelligence(
      repoRowId,
      collected({ description: "stable", topics: ["a", "b"], languages: [{ name: "TypeScript", bytes: 100, percent: 100 }] }),
    );
    const after = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    expect(after.revision).toBe(before.revision);
  });

  it("replaces stale evidence rather than accumulating it", async () => {
    await saveRepositoryIntelligence(repoRowId, collected());
    const insightId = (
      await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } })
    ).id;
    const before = await prisma.repoEvidence.count({ where: { insightId } });

    await saveRepositoryIntelligence(repoRowId, collected({ evidence: [{ kind: "repo", label: "only one", rank: 70 }] }));
    const after = await prisma.repoEvidence.count({ where: { insightId } });
    expect(after).toBe(1);
    expect(after).toBeLessThan(before + 10);
  });

  it("detects a change in a nested structural fact", async () => {
    await saveRepositoryIntelligence(repoRowId, collected({ structure: { topLevel: ["src"], workflowNames: ["ci.yml"], profile: EMPTY_PROFILE, codeowners: null } }));
    const before = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    await saveRepositoryIntelligence(
      repoRowId,
      collected({ structure: { topLevel: ["src"], workflowNames: ["ci.yml", "release.yml"], profile: EMPTY_PROFILE, codeowners: null } }),
    );
    const after = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    expect(after.revision).toBeGreaterThan(before.revision);
  });
});

describe("grounded questions", () => {
  it("persists a question and its evidence-cited answer", async () => {
    await saveRepositoryIntelligence(repoRowId, collected());
    const answer = await askQuestion(owner.id, repoRowId, "who owns this code?");
    expect(answer.answered).toBe(true);
    for (const c of answer.claims) expect(c.evidenceIds.length).toBeGreaterThan(0);

    const rows = await prisma.insightQuestion.findMany({ where: { userId: owner.id } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("does not persist a question against a repository with no profile", async () => {
    const before = await prisma.insightQuestion.count({ where: { userId: outsider.id } });
    const answer = await askQuestion(outsider.id, repoRowId + "-nonexistent", "who owns this code?");
    expect(answer.answered).toBe(false);
    const after = await prisma.insightQuestion.count({ where: { userId: outsider.id } });
    expect(after).toBe(before);
  });
});

describe("digests", () => {
  it("stores a digest and reads it back with its bullets intact", async () => {
    await saveRepositoryIntelligence(repoRowId, collected());
    const profileRow = await prisma.repositoryInsight.findUniqueOrThrow({ where: { repoId: repoRowId } });
    const withEvidence = await prisma.repositoryInsight.findUniqueOrThrow({
      where: { repoId: repoRowId },
      include: { evidence: { select: { id: true, kind: true, label: true, rank: true } } },
    });
    expect(profileRow.id).toBe(withEvidence.id);

    const payload = buildDeveloperBriefing(withEvidence, { days: 3, openPrs: [] });
    const id = await saveDigest(repoRowId, "main", payload);
    const loaded = await loadDigest(repoRowId, "developer_briefing", "main");
    expect(loaded?.id).toBe(id);
    expect(loaded!.bullets.length).toBe(payload.bullets.length);
  });

  it("reuses the digest while the profile revision is unchanged", async () => {
    const first = await prisma.insightDigest.count({ where: { repoId: repoRowId, kind: "developer_briefing" } });
    const withEvidence = await prisma.repositoryInsight.findUniqueOrThrow({
      where: { repoId: repoRowId },
      include: { evidence: { select: { id: true, kind: true, label: true, rank: true } } },
    });
    await saveDigest(repoRowId, "main", buildDeveloperBriefing(withEvidence, { days: 3, openPrs: [] }));
    await saveDigest(repoRowId, "main", buildDeveloperBriefing(withEvidence, { days: 3, openPrs: [] }));
    const second = await prisma.insightDigest.count({ where: { repoId: repoRowId, kind: "developer_briefing" } });
    expect(second).toBe(first);
  });

  it("refuses to digest a repository that has no profile", async () => {
    await expect(saveDigest(`${repoRowId}-nope`, "main", {
      kind: "developer_briefing",
      title: "x",
      bullets: [],
      revision: 1,
      renderedAt: new Date().toISOString(),
      userId: null,
    })).rejects.toThrow(/no repository insight/);
  });
});

describe("work context authorization", () => {
  it("stores a context for a user who can reach the repository", async () => {
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "repository",
      label: "Reviewing widgets",
      targetUrl: `/${stamp}/acme/widgets`,
    });
    expect(id).not.toBeNull();
  });

  it("refuses to store a context for a repository the user cannot reach", async () => {
    const id = await rememberContext({
      userId: outsider.id,
      repoId: repoRowId,
      kind: "repository",
      label: "Sneaking a peek",
      targetUrl: "/acme/widgets",
    });
    expect(id).toBeNull();
  });

  it("rejects an off-origin target so a stored link cannot redirect off-site", async () => {
    for (const bad of [
      "https://evil.example.com",
      "//evil.example.com",
      "/\\evil.example.com",
      "\\\\evil.example.com",
      "javascript:alert(1)",
      "/a\nb",
    ]) {
      const id = await rememberContext({
        userId: owner.id,
        repoId: repoRowId,
        kind: "repository",
        label: "bad",
        targetUrl: bad,
      });
      expect(id, `accepted ${bad}`).toBeNull();
    }
  });

  it("accepts a normal same-origin path", async () => {
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "repository",
      label: "ok",
      targetUrl: "/acme/widgets/pull/7",
    });
    expect(id).not.toBeNull();
  });

  it("does not list another user's context", async () => {
    const mine = await recentContexts(owner.id);
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await recentContexts(outsider.id);
    expect(theirs).toEqual([]);
  });

  it("refuses to restore a context belonging to another user", async () => {
    const mine = await recentContexts(owner.id);
    const first = mine[0]!;
    const stolen = await restoreContext(outsider.id, first.id);
    expect(stolen).toBeNull();
  });

  it("returns the live repository state rather than the state at save time", async () => {
    // Create exactly one live pull request so the expected count is explicit
    // rather than dependent on whatever other tests in this file have run.
    const number = 7300 + (Math.floor(Math.random() * 90) + 10);
    await prisma.pullRequest.create({
      data: {
        repoId: repoRowId,
        number,
        title: "live check",
        url: `https://github.com/acme/widgets/pull/${number}`,
        authorLogin: owner.login,
        headRef: "live",
        headSha: "sha",
        baseRef: "main",
        githubState: "OPEN",
        state: "awaiting_review",
        stateEnteredAt: new Date(),
        githubUpdatedAt: new Date(),
      },
    });
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "repository",
      label: "live check",
      targetUrl: "/dashboard/repos/acme/widgets",
      payload: { openPrs: 999 },
    });
    expect(id).not.toBeNull();
    const restored = await restoreContext(owner.id, id!);
    expect(restored).not.toBeNull();
    // The payload claimed 999 open PRs; the live count must come from the
    // database, not from the stored snapshot. Previously this asserted 0,
    // which was the *bug* (a filter on a non-existent "open" state) rather
    // than the intended behaviour.
    expect(restored!.live).toEqual({ kind: "repository", openPrs: 1 });
  });

  it("refuses to restore a PR context that does not exist", async () => {
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "pr",
      label: "ghost PR",
      targetUrl: "/acme/widgets/pull/9999",
      payload: { number: 9999 },
    });
    expect(await restoreContext(owner.id, id!)).toBeNull();
  });

  it("refuses to restore a PR context with a malformed number", async () => {
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "pr",
      label: "no number",
      targetUrl: "/acme/widgets",
      payload: {},
    });
    expect(await restoreContext(owner.id, id!)).toBeNull();
  });

  it("hides next actions from a user who cannot reach the repository", async () => {
    expect(await nextActionsFor(outsider.id, repoRowId)).toEqual([]);
  });

  it("surfaces a next action for a live pull request and links to a real route", async () => {
    // Regression: this filtered on a Baton state named "open", which does not
    // exist, so the whole next-actions feature returned nothing in production
    // while every existing test still passed.
    await prisma.pullRequest.create({
      data: {
        repoId: repoRowId,
        number: 4242,
        title: "Fix the flaky watcher",
        url: "https://github.com/acme/gadgets/pull/4242",
        authorLogin: owner.login,
        headRef: "fix/watcher",
        headSha: "abc123",
        baseRef: "main",
        githubState: "OPEN",
        state: "changes_required",
        stateEnteredAt: new Date(),
        githubUpdatedAt: new Date(),
      },
    });
    const actions = await nextActionsFor(owner.id, repoRowId);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toContain("#4242");
    // The old link was `/${owner}/${name}/pull/${n}`, which is not a route.
    expect(actions[0]!.href).toBe("/dashboard/repos/acme/widgets/pulls/4242");
  });

  it("offers a review action for a post-fix pull request the viewer was asked on", async () => {
    // Regression: this matched the state "after_fix"; the real value is
    // "awaiting_review_after_fix", so the review action never fired.
    await prisma.pullRequest.create({
      data: {
        repoId: repoRowId,
        number: 4243,
        title: "Address the review",
        url: "https://github.com/acme/gadgets/pull/4243",
        authorLogin: "someone-else",
        headRef: "fix/review",
        headSha: "def456",
        baseRef: "main",
        githubState: "OPEN",
        state: "awaiting_review_after_fix",
        requestedReviewersJson: JSON.stringify([owner.login]),
        stateEnteredAt: new Date(),
        githubUpdatedAt: new Date(),
      },
    });
    const actions = await nextActionsFor(owner.id, repoRowId);
    expect(actions.map((a) => a.label)).toContain("Review #4243");
  });

  it("ignores merged and closed pull requests when listing next actions", async () => {
    for (const [n, state] of [[5150, "merged"], [5151, "closed"]] as const) {
      await prisma.pullRequest.create({
        data: {
          repoId: repoRowId,
          number: n,
          title: `terminal ${n}`,
          url: `https://github.com/acme/gadgets/pull/${n}`,
          authorLogin: owner.login,
          headRef: "done",
          headSha: "sha",
          baseRef: "main",
          githubState: "MERGED",
          state,
          stateEnteredAt: new Date(),
          githubUpdatedAt: new Date(),
        },
      });
    }
    const actions = await nextActionsFor(owner.id, repoRowId);
    expect(actions.map((a) => a.label)).not.toContain("Address feedback on #5150");
  });

  it("restores a PR context written with the prNumber key the PR page uses", async () => {
    // Regression: restoreContext read payload.number while the save action
    // wrote payload.prNumber, so "Resume working" never resolved.
    await prisma.pullRequest.create({
      data: {
        repoId: repoRowId,
        number: 6161,
        title: "Resume me",
        url: "https://github.com/acme/gadgets/pull/6161",
        authorLogin: owner.login,
        headRef: "resume",
        headSha: "sha",
        baseRef: "main",
        githubState: "OPEN",
        state: "awaiting_review",
        stateEnteredAt: new Date(),
        githubUpdatedAt: new Date(),
      },
    });
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "pr",
      label: "Resume me",
      targetUrl: "/dashboard/repos/acme/widgets/pulls/6161",
      payload: { owner: "acme", repo: "gadgets", prNumber: 6161 },
    });
    const restored = await restoreContext(owner.id, id!);
    expect(restored).not.toBeNull();
    expect(restored!.live).toEqual({
      kind: "pr",
      state: "awaiting_review",
      updatedAt: expect.any(Date),
    });
  });

  it("counts live open PRs when restoring a repository context", async () => {
    const id = await rememberContext({
      userId: owner.id,
      repoId: repoRowId,
      kind: "repository",
      label: "widgets",
      targetUrl: "/dashboard/repos/acme/widgets",
      payload: { openPrs: 999 },
    });
    const restored = await restoreContext(owner.id, id!);
    // Counted from the database rather than hard-coded, so this stays correct
    // regardless of how many pull requests earlier tests in this file left
    // behind. What is being asserted is that merged/closed rows are excluded
    // and live rows are included -- not a particular total.
    const live = await prisma.pullRequest.count({
      where: {
        repoId: repoRowId,
        state: { in: ["awaiting_review", "awaiting_review_after_fix", "changes_required", "ci_failing", "blocked_on_checks", "conflicts", "ready_to_merge"] },
      },
    });
    expect(live).toBeGreaterThan(0);
    expect(restored!.live).toEqual({ kind: "repository", openPrs: live });
  });
});
