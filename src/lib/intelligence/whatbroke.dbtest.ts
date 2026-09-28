import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * "What Broke?" cover.
 *
 * The important behaviours are the negative ones: a check that is still running
 * must not be reported as failing, a neutral or skipped check must not be
 * reported as failing, and a pull request with no recorded checks must say so
 * rather than implying a green build.
 */

const { prisma } = await import("@/lib/db");
const { whatBroke } = await import("@/lib/intelligence/whatbroke");

const stamp = `broke${Date.now().toString(36)}`;
const installationId = 6_100_000 + (Date.now() % 800_000);

let owner: { id: string };
let outsider: { id: string };
let repoRowId: string;
let prNumber: number;

type Check = { name: string; status: string; conclusion: string | null; appSlug: string | null; detailsUrl?: string | null; summary?: string | null };

async function setChecks(checks: Check[]) {
  await prisma.pullRequest.update({
    where: { repoId_number: { repoId: repoRowId, number: prNumber } },
    data: { checksJson: JSON.stringify(checks) },
  });
}

const text = (r: Awaited<ReturnType<typeof whatBroke>>) => r!.bullets.map((b) => b.text).join(" | ");

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
  owner = await prisma.user.create({ data: { githubId: Math.floor(Math.random() * 1e9) + 5e8, login: `${stamp}-owner` } });
  outsider = await prisma.user.create({ data: { githubId: Math.floor(Math.random() * 1e9) + 5e8, login: `${stamp}-outsider` } });

  const inst = await prisma.appInstallation.create({
    data: { installationId, accountLogin: `${stamp}-owner`, accountType: "User", userId: owner.id },
    select: { id: true },
  });
  const repo = await prisma.repo.create({
    data: {
      installationId: inst.id,
      repoId: BigInt(installationId) + 7n,
      owner: "acme",
      name: "gadgets",
      fullName: `${stamp}/acme/gadgets`,
      defaultBranch: "main",
    },
    select: { id: true },
  });
  repoRowId = repo.id;
  prNumber = 101;
  await prisma.pullRequest.create({
    data: {
      repoId: repoRowId,
      number: prNumber,
      title: "Refactor the parser",
      url: `https://github.com/acme/gadgets/pull/${prNumber}`,
      state: "ci_failing",
      githubState: "OPEN",
      authorLogin: `${stamp}-owner`,
      headRef: "feat/parser",
      headSha: "abc123",
      baseRef: "main",
      stateEnteredAt: new Date(),
      githubUpdatedAt: new Date(),
      checksJson: "[]",
    },
  });
});

afterAll(async () => {
  await prisma.appInstallation.deleteMany({ where: { installationId } });
  await prisma.user.deleteMany({ where: { login: { startsWith: stamp } } });
});

describe("whatBroke", () => {
  it("returns null for a user who cannot see the repository", async () => {
    expect(await whatBroke(outsider.id, "acme", "gadgets", prNumber)).toBeNull();
  });

  it("returns null for a pull request that does not exist", async () => {
    expect(await whatBroke(owner.id, "acme", "gadgets", 999_999)).toBeNull();
  });

  it("says so when no checks are recorded, rather than implying success", async () => {
    await setChecks([]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("No check runs are recorded");
    expect(r!.failedChecks).toEqual([]);
    expect(r!.bullets[0]!.tone).toBe("risk");
  });

  it("reports a failing check with its provider", async () => {
    await setChecks([{ name: "unit", status: "COMPLETED", conclusion: "FAILURE", appSlug: "github-actions" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("unit reported failure");
    expect(text(r)).toContain("1 failing check from github-actions");
    expect(r!.failedChecks).toHaveLength(1);
  });

  it("does not report an in-progress check as failing", async () => {
    await setChecks([{ name: "e2e", status: "IN_PROGRESS", conclusion: null, appSlug: "github-actions" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(r!.failedChecks).toHaveLength(0);
    expect(r!.pendingChecks).toHaveLength(1);
    expect(text(r)).toContain("e2e is still in progress");
    expect(text(r)).not.toContain("e2e reported failure");
  });

  it("does not report a queued check as failing", async () => {
    await setChecks([{ name: "lint", status: "QUEUED", conclusion: null, appSlug: "github-actions" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(r!.failedChecks).toHaveLength(0);
  });

  it("does not treat NEUTRAL or SKIPPED as a failure", async () => {
    await setChecks([
      { name: "flaky-probe", status: "COMPLETED", conclusion: "NEUTRAL", appSlug: "x" },
      { name: "docs", status: "COMPLETED", conclusion: "SKIPPED", appSlug: "x" },
    ]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(r!.failedChecks).toHaveLength(0);
  });

  it("reports a positive result when every check passed", async () => {
    await setChecks([
      { name: "unit", status: "COMPLETED", conclusion: "SUCCESS", appSlug: "github-actions" },
      { name: "e2e", status: "COMPLETED", conclusion: "SUCCESS", appSlug: "github-actions" },
    ]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("All 2 recorded checks passed");
    expect(r!.bullets[0]!.tone).toBe("positive");
  });

  it("uses the singular for a single passing check", async () => {
    await setChecks([{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS", appSlug: "x" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("All 1 recorded check passed");
  });

  it("groups multiple failures from one provider and ranks by volume", async () => {
    await setChecks([
      { name: "a", status: "COMPLETED", conclusion: "FAILURE", appSlug: "circleci" },
      { name: "b", status: "COMPLETED", conclusion: "FAILURE", appSlug: "circleci" },
      { name: "c", status: "COMPLETED", conclusion: "FAILURE", appSlug: "vercel" },
    ]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("2 failing checks from circleci");
    expect(text(r)).toContain("1 failing check from vercel");
  });

  it("says an unidentified provider is unidentified rather than guessing one", async () => {
    await setChecks([{ name: "mystery", status: "COMPLETED", conclusion: "FAILURE", appSlug: null }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("unidentified provider");
  });

  it("surfaces the annotation GitHub recorded for a failure", async () => {
    await setChecks([
      { name: "unit", status: "COMPLETED", conclusion: "FAILURE", appSlug: "x", summary: "3 tests failed in parser.spec.ts" },
    ]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(text(r)).toContain("3 tests failed in parser.spec.ts");
  });

  it("never invents an annotation when GitHub recorded none", async () => {
    await setChecks([{ name: "unit", status: "COMPLETED", conclusion: "FAILURE", appSlug: "x" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    const b = r!.bullets.find((x) => /unit reported failure/.test(x.text))!;
    // No failure reason is fabricated. The only thing added is an explicit
    // statement that GitHub recorded no log link, which is itself a fact about
    // the data rather than a guess about the cause.
    expect(b.text).toBe("unit reported failure: GitHub recorded no log link for this run, so check the provider's own dashboard.");
    expect(b.text).not.toMatch(/because|likely|probably|due to/i);
  });

  it("points at the recorded log when GitHub supplied one", async () => {
    await setChecks([
      {
        name: "unit",
        status: "COMPLETED",
        conclusion: "FAILURE",
        appSlug: "x",
        detailsUrl: "https://github.com/acme/gadgets/runs/1",
        summary: "3 tests failed",
      },
    ]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    const b = r!.bullets.find((x) => /unit reported failure/.test(x.text))!;
    expect(b.text).toContain("3 tests failed");
    expect(b.text).toContain("the run log is linked from this view");
    // The deep link must survive onto the structured result the page renders.
    expect(r!.failedChecks[0]!.detailsUrl).toBe("https://github.com/acme/gadgets/runs/1");
  });

  it("counts a TIMED_OUT check as a failure", async () => {
    await setChecks([{ name: "slow", status: "COMPLETED", conclusion: "TIMED_OUT", appSlug: "x" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(r!.failedChecks).toHaveLength(1);
    expect(text(r)).toContain("slow reported timed_out");
  });

  it("reports no profile when the repository has never been collected", async () => {
    await setChecks([{ name: "unit", status: "COMPLETED", conclusion: "FAILURE", appSlug: "x" }]);
    const r = await whatBroke(owner.id, "acme", "gadgets", prNumber);
    expect(r!.hasProfile).toBe(false);
  });
});
