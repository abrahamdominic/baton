import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Database cover for repository memory (skill.md §15).
 *
 * The properties here are relational and temporal, which is exactly why they
 * cannot be tested against a stub:
 *
 *  - reconciliation is idempotent, because the collector re-runs on a schedule
 *    and must not manufacture a second copy of every claim;
 *  - retirement is delayed, because a collection that fails for an afternoon
 *    would otherwise erase a repository's memory;
 *  - a recorded decision survives reconciliation, because it was never derived
 *    and so is never "missing";
 *  - a decision can only be deleted through the recorded path, so no caller
 *    can erase an observed fact and hide that it was ever asserted.
 */

const { prisma } = await import("@/lib/db");
const { saveRepositoryIntelligence } = await import("@/lib/intelligence/collect");
const {
  syncKnowledge,
  loadKnowledge,
  summariseKnowledge,
  recordDecision,
  forgetDecision,
  deriveKnowledge,
  RETIRE_AFTER_DAYS,
} = await import("@/lib/intelligence/knowledge");
const { EMPTY_PROFILE } = await import("@/lib/intelligence/profile");

const stamp = `know${Date.now().toString(36)}`;
const installationId = 8_100_000 + (Date.now() % 800_000);

let owner: { id: string; login: string };
let repoRowId: string;
let insightId: string;

const entry = (over: Record<string, unknown> = {}) => ({
  kind: "architecture" as const,
  stableKey: `architecture:test-${Object.keys(over).length}`,
  title: "Prisma owns the schema",
  detail: "Schema changes go through migrations, not ad hoc SQL.",
  source: "observed" as const,
  evidenceIds: ["ev-1"],
  path: "prisma/schema.prisma",
  strength: 80,
  ...over,
});

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
  owner = await prisma.user.create({
    data: { githubId: Math.floor(Math.random() * 1e9) + 6e8, login: `${stamp}-owner` },
  });

  const inst = await prisma.appInstallation.create({
    data: { installationId, accountLogin: `${stamp}-owner`, accountType: "User", userId: owner.id },
    select: { id: true },
  });
  const repo = await prisma.repo.create({
    data: {
      installationId: inst.id,
      repoId: BigInt(installationId) + 1n,
      owner: "acme",
      name: "widgets",
      fullName: `${stamp}/acme/widgets`,
      defaultBranch: "main",
    },
    select: { id: true },
  });
  repoRowId = repo.id;

  // A real insight row: knowledge must hang off one, so that deleting the
  // intelligence it was derived from takes its memory with it.
  const saved = await saveRepositoryIntelligence(repoRowId, {
    description: "A test service",
    homepage: null,
    topics: [],
    languages: [{ name: "TypeScript", bytes: 100, percent: 100 }],
    hasReadme: true,
    hasCodeowners: false,
    hasContributing: false,
    hasCiWorkflows: true,
    hasSecurityPolicy: false,
    hasLicense: false,
    defaultBranch: "main",
    openPullRequests: 0,
    openIssues: 0,
    mergedLast30Days: 3,
    contributorCount: 1,
    topContributors: [],
    lastReleaseTag: null,
    lastReleaseAt: null,
    structure: { topLevel: ["src"], workflowNames: [], profile: EMPTY_PROFILE, codeowners: null },
    evidence: [{ kind: "repo", label: "Repository metadata", url: "https://github.com/a/b", rank: 70 }],
  });
  insightId = saved.insightId;
});

afterAll(async () => {
  await prisma.appInstallation.deleteMany({ where: { installationId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("syncKnowledge", () => {
  it("stores a derived claim against the insight it came from", async () => {
    const res = await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: "architecture:prisma" })]);
    expect(res.inserted).toBe(1);
    const stored = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:prisma" },
    });
    expect(stored.insightId).toBe(insightId);
    expect(JSON.parse(stored.evidence)).toEqual(["ev-1"]);
  });

  it("is idempotent: a second sweep over the same claims inserts nothing", async () => {
    const claims = [entry({ stableKey: "architecture:idem" })];
    await syncKnowledge(insightId, repoRowId, 1, claims);
    const second = await syncKnowledge(insightId, repoRowId, 1, claims);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    const rows = await prisma.repoKnowledge.count({ where: { repoId: repoRowId, stableKey: "architecture:idem" } });
    expect(rows).toBe(1);
  });

  it("counts a re-observation without changing the claim's revision", async () => {
    const claims = [entry({ stableKey: "architecture:observe" })];
    await syncKnowledge(insightId, repoRowId, 4, claims);
    const first = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:observe" },
    });
    const changedAt = first.lastChangedAt;

    await syncKnowledge(insightId, repoRowId, 9, claims);
    const second = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:observe" },
    });
    // Reinforcement is the point; an unchanged claim is not news.
    expect(second.observations).toBe(2);
    expect(second.revision).toBe(4);
    expect(second.lastChangedAt).toEqual(changedAt);
  });

  it("bumps the revision and the change time when the wording actually changes", async () => {
    const claims = [entry({ stableKey: "architecture:rewrite" })];
    await syncKnowledge(insightId, repoRowId, 2, claims);
    await syncKnowledge(
      insightId,
      repoRowId,
      3,
      [entry({ stableKey: "architecture:rewrite", detail: "Schema changes go through migrations only." })],
    );
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:rewrite" },
    });
    expect(row.revision).toBe(3);
    expect(row.detail).toContain("only");
  });

  it("clears a claim that reappears after being missed", async () => {
    const claims = [entry({ stableKey: "architecture:flicker" })];
    await syncKnowledge(insightId, repoRowId, 1, claims);
    await syncKnowledge(insightId, repoRowId, 1, []);
    const missing = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:flicker" },
    });
    expect(missing.missingSince).not.toBeNull();
    expect(missing.status).toBe("active");

    await syncKnowledge(insightId, repoRowId, 2, claims);
    const back = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:flicker" },
    });
    expect(back.missingSince).toBeNull();
    expect(back.status).toBe("active");
  });
});

describe("retirement", () => {
  it("does not retire a claim the first time it goes missing", async () => {
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: "architecture:grace" })]);
    await syncKnowledge(insightId, repoRowId, 1, []);
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:grace" },
    });
    expect(row.status).toBe("active");
  });

  it("does not retire a claim whose grace period has not elapsed", async () => {
    const key = "architecture:too-soon";
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    await syncKnowledge(insightId, repoRowId, 1, []);
    // Backdate the first miss to just inside the window.
    await prisma.repoKnowledge.update({
      where: { repoId_stableKey: { repoId: repoRowId, stableKey: key } },
      data: { missingSince: new Date(Date.now() - (RETIRE_AFTER_DAYS - 1) * 86_400_000) },
    });
    await syncKnowledge(insightId, repoRowId, 1, []);
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: key },
    });
    expect(row.status).toBe("active");
  });

  it("retires a claim that has been missing for longer than the grace period", async () => {
    const key = "architecture:gone";
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    await syncKnowledge(insightId, repoRowId, 1, []);
    await prisma.repoKnowledge.update({
      where: { repoId_stableKey: { repoId: repoRowId, stableKey: key } },
      data: { missingSince: new Date(Date.now() - (RETIRE_AFTER_DAYS + 1) * 86_400_000) },
    });
    const res = await syncKnowledge(insightId, repoRowId, 1, []);
    expect(res.retired).toBe(1);
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: key },
    });
    expect(row.status).toBe("retired");
  });

  it("retires rather than deletes, so the history of the claim survives", async () => {
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:gone" },
    });
    expect(row.createdAt).toBeInstanceOf(Date);
    await prisma.repoKnowledge.delete({ where: { id: row.id } });
  });

  it("hides retired claims from the default read but can still show them", async () => {
    const key = "architecture:hidden";
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    await prisma.repoKnowledge.update({
      where: { repoId_stableKey: { repoId: repoRowId, stableKey: key } },
      data: { status: "retired", missingSince: new Date(Date.now() - (RETIRE_AFTER_DAYS + 2) * 86_400_000) },
    });
    const visible = await loadKnowledge(repoRowId);
    const withRetired = await loadKnowledge(repoRowId, { includeRetired: true });
    expect(visible.some((f) => f.stableKey === key)).toBe(false);
    expect(withRetired.some((f) => f.stableKey === key)).toBe(true);
    await prisma.repoKnowledge.delete({ where: { repoId_stableKey: { repoId: repoRowId, stableKey: key } } });
  });
});

describe("recorded decisions", () => {
  it("stores a decision with no citations, because a human asserted it", async () => {
    const fact = await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Sessions are stateless",
      detail: "State lives in the database, not in a session object.",
    });
    expect(fact.source).toBe("recorded");
    expect(fact.evidenceIds).toEqual([]);
  });

  it("refuses a decision with no detail", async () => {
    await expect(
      recordDecision({ userId: owner.id, repoId: repoRowId, insightId, title: "Bare title", detail: "  " }),
    ).rejects.toThrow();
  });

  it("survives a reconciliation that never derived it", async () => {
    await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Never regenerate a digest",
      detail: "Digests are read-only once written so that history cannot be rewritten.",
    });
    // A sweep that derives nothing at all is the worst case for retirement.
    await syncKnowledge(insightId, repoRowId, 1, []);
    const decisions = await loadKnowledge(repoRowId, { kind: "decision" });
    expect(decisions.some((d) => d.title === "Never regenerate a digest")).toBe(true);
  });

  it("updates a decision in place rather than accumulating duplicates", async () => {
    await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Evidence before prose",
      detail: "First wording.",
    });
    await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Evidence before prose",
      detail: "Second wording, which is the corrected one.",
    });
    const rows = await prisma.repoKnowledge.findMany({
      where: { repoId: repoRowId, kind: "decision", title: "Evidence before prose" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toContain("Second wording");
  });

  it("cannot be deleted through the decision path, only its own", async () => {
    const observed = entry({ stableKey: "architecture:protected" });
    await syncKnowledge(insightId, repoRowId, 1, [observed]);
    const row = await prisma.repoKnowledge.findFirstOrThrow({
      where: { repoId: repoRowId, stableKey: "architecture:protected" },
    });
    // An observed fact is not deletable through the decision API: that would
    // let a caller quietly remove a claim the collector still stands behind.
    expect(await forgetDecision(owner.id, repoRowId, row.id)).toBe(false);
    expect(await prisma.repoKnowledge.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("will not forget a decision belonging to another repository", async () => {
    const fact = await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Scoped forget",
      detail: "Must not be removable through the wrong repository id.",
    });
    expect(await forgetDecision(owner.id, "some-other-repo", fact.id)).toBe(false);
    expect(await prisma.repoKnowledge.findUnique({ where: { id: fact.id } })).not.toBeNull();
  });

  it("deletes a decision of this repository when asked", async () => {
    const fact = await recordDecision({
      userId: owner.id,
      repoId: repoRowId,
      insightId,
      title: "Temporary decision",
      detail: "Removed again in the next test run.",
    });
    expect(await forgetDecision(owner.id, repoRowId, fact.id)).toBe(true);
    expect(await prisma.repoKnowledge.findUnique({ where: { id: fact.id } })).toBeNull();
  });
});

describe("loadKnowledge and summariseKnowledge", () => {
  it("orders by strength so the best-evidenced claim leads", async () => {
    await syncKnowledge(insightId, repoRowId, 1, [
      entry({ stableKey: "architecture:weak", strength: 10 }),
      entry({ stableKey: "architecture:strong", strength: 95 }),
    ]);
    const facts = await loadKnowledge(repoRowId, { kind: "architecture" });
    const first = facts[0]!;
    expect(first.strength).toBe(95);
  });

  it("honours the limit", async () => {
    const facts = await loadKnowledge(repoRowId, { limit: 2 });
    expect(facts.length).toBeLessThanOrEqual(2);
  });

  it("scopes every read to the repository it was asked about", async () => {
    const mine = await loadKnowledge(repoRowId);
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await loadKnowledge("a-different-repo-id");
    expect(theirs).toEqual([]);
  });

  it("counts active entries, reinforcements, and retirements separately", async () => {
    const key = "architecture:summary-target";
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    await syncKnowledge(insightId, repoRowId, 1, [entry({ stableKey: key })]);
    // observations is now 3, which is the definition of a reinforced claim.
    await syncKnowledge(insightId, repoRowId, 1, []);

    const summary = await summariseKnowledge(repoRowId);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.reinforced).toBeGreaterThan(0);
    expect(summary.lastUpdatedAt).toBeInstanceOf(Date);
    expect(summary.byKind.length).toBeGreaterThan(0);
  });

  it("returns a zero summary for a repository it knows nothing about", async () => {
    const summary = await summariseKnowledge("a-different-repo-id");
    expect(summary.total).toBe(0);
    expect(summary.reinforced).toBe(0);
    expect(summary.retired).toBe(0);
    expect(summary.lastUpdatedAt).toBeNull();
  });
});

describe("collection reconciliation", () => {
  it("derives claims from a collected snapshot and persists them", async () => {
    const derived = deriveKnowledge({
      profile: { ...EMPTY_PROFILE, orm: "Prisma", hasMigrations: true, testFramework: "vitest" },
      evidenceByKind: new Map([
        ["repo", ["ev-repo"]],
        ["profile", ["ev-profile"]],
        ["readme", ["ev-readme"]],
      ]),
      codeowners: null,
      defaultBranch: "main",
      hasReadme: true,
      hasCiWorkflows: true,
      lastReleaseTag: null,
      lastReleaseAt: null,
      mergedLast30Days: 4,
      openPullRequests: 1,
      ciFailureCount: 0,
      ciFailureRate: null,
    });
    expect(derived.length).toBeGreaterThan(0);
    const res = await syncKnowledge(insightId, repoRowId, 5, derived);
    expect(res.inserted).toBeGreaterThan(0);
    // Whatever was written, every claim in the table must be attributed to this
    // insight: an orphan claim is a claim the UI cannot cite.
    const orphans = await prisma.repoKnowledge.count({ where: { repoId: repoRowId, insightId: { not: insightId } } });
    expect(orphans).toBe(0);
  });
});
