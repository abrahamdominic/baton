import { describe, it, expect } from "vitest";
import { answerFromInsight, detectIntent } from "./answer";

/**
 * These tests exist to protect one property above all others: **the answer never
 * asserts anything it cannot cite.** Each "must not claim" case pairs a question
 * with a profile that lacks the relevant evidence, and asserts the claim is
 * absent rather than merely uncertain.
 */

interface EvidenceRow {
  id: string;
  kind: string;
  label: string;
  rank: number;
}

function profile(overrides: Record<string, unknown> = {}, evidence: EvidenceRow[] = []) {
  return {
    id: "ins_1",
    repoId: "repo_1",
    description: "A payments service.",
    topics: JSON.stringify(["payments", "typescript"]),
    languages: JSON.stringify([
      { name: "TypeScript", bytes: 900, percent: 78 },
      { name: "Shell", bytes: 250, percent: 22 },
    ]),
    hasReadme: true,
    hasCodeowners: false,
    hasContributing: false,
    hasCiWorkflows: true,
    hasSecurityPolicy: true,
    hasLicense: true,
    defaultBranch: "main",
    openPullRequests: 4,
    openIssues: 9,
    mergedLast30Days: 31,
    contributorCount: 12,
    topContributors: JSON.stringify([
      { login: "ada", commits: 120 },
      { login: "grace", commits: 90 },
    ]),
    lastReleaseTag: "v2.3.0",
    lastReleaseAt: new Date("2026-01-05T00:00:00Z"),
    structure: JSON.stringify({
      topLevel: ["src", "README.md", "package.json"],
      workflowNames: ["ci.yml"],
    }),
    evidence,
    ...overrides,
  } as Parameters<typeof answerFromInsight>[1];
}

const E = (id: string, kind: string): EvidenceRow => ({ id, kind, label: `${kind} label`, rank: 10 });

describe("detectIntent", () => {
  it("maps ownership questions to the ownership facet", () => {
    expect(detectIntent("who should review my PR?")).toBe("ownership");
    expect(detectIntent("Who owns this code?")).toBe("ownership");
    expect(detectIntent("is there a CODEOWNERS file")).toBe("ownership");
  });

  it("maps CI, language, release, and maintenance questions", () => {
    expect(detectIntent("how does CI work here")).toBe("ci");
    expect(detectIntent("what language is this in")).toBe("language");
    expect(detectIntent("what is the latest release")).toBe("release");
    expect(detectIntent("is this project actively maintained")).toBe("maintenance");
    expect(detectIntent("how do I get started")).toBe("onboarding");
    expect(detectIntent("what is the directory layout")).toBe("structure");
  });

  it("returns null for a question it cannot map to a facet", () => {
    // Guessing a facet here would risk answering an ownership question with a
    // language statistic.
    expect(detectIntent("what is the airspeed velocity of an unladen swallow")).toBeNull();
  });

  it("does not match a short token inside a longer word", () => {
    // Substring matching would classify "velocity" as a CI question, and the
    // product would then answer a physics question with CI facts.
    expect(detectIntent("what is the airspeed velocity of an unladen swallow")).toBeNull();
    expect(detectIntent("what is this repo's social capital")).toBeNull();
  });

  it("treats a GitHub workflow as CI, since that is what the term means", () => {
    expect(detectIntent("what does the workflow directory contain")).toBe("ci");
  });
});

describe("answerFromInsight: the citation invariant", () => {
  it("returns no claims and answered=false when there is no profile at all", () => {
    const a = answerFromInsight("what is this repository?", null);
    expect(a.answered).toBe(false);
    expect(a.claims).toEqual([]);
  });

  it("never emits a claim with an empty evidence list", () => {
    const a = answerFromInsight("who owns this?", profile({}, []));
    for (const c of a.claims) {
      expect(c.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("refuses to claim CODEOWNERS exists when there is no codeowners evidence", () => {
    const a = answerFromInsight("who should review?", profile({ hasCodeowners: true }, [E("e1", "repo")]));
    expect(a.claims.some((c) => /CODEOWNERS file/.test(c.text))).toBe(false);
  });

  it("refuses to claim workflows exist when the workflow evidence is absent", () => {
    const a = answerFromInsight("how does CI work?", profile({ hasCiWorkflows: true }, [E("e1", "repo")]));
    expect(a.claims.some((c) => /workflow/.test(c.text) && !/no GitHub Actions/.test(c.text))).toBe(false);
  });
});

describe("answerFromInsight: evidence-backed answers", () => {
  it("states that CODEOWNERS exists only when the evidence row is present", () => {
    const a = answerFromInsight("who owns this code?", profile({}, [E("e_code", "codeowners")]));
    const claim = a.claims.find((c) => /CODEOWNERS/.test(c.text));
    expect(claim).toBeDefined();
    expect(claim!.evidenceIds).toContain("e_code");
  });

  it("names the workflow files from the recorded structure", () => {
    const a = answerFromInsight("how does CI work?", profile({}, [E("e_ci", "workflow")]));
    const claim = a.claims.find((c) => /ci\.yml/.test(c.text));
    expect(claim).toBeDefined();
    expect(claim!.evidenceIds).toEqual(["e_ci"]);
  });

  it("reports the dominant language with its share", () => {
    const a = answerFromInsight("what language is this?", profile({}, [E("e_l", "languages")]));
    const claim = a.claims.find((c) => /TypeScript/.test(c.text));
    expect(claim).toBeDefined();
    expect(claim!.text).toContain("78%");
  });

  it("reports the latest release tag", () => {
    const a = answerFromInsight("what is the latest release?", profile({}, [E("e_r", "release"), E("e_repo", "repo")]));
    expect(a.claims.some((c) => /v2\.3\.0/.test(c.text))).toBe(true);
  });

  it("says no release exists instead of inventing one", () => {
    const a = answerFromInsight(
      "what is the latest release?",
      profile({ lastReleaseTag: null, lastReleaseAt: null }, [E("e_repo", "repo")]),
    );
    expect(a.claims.some((c) => /No GitHub release has been published/.test(c.text))).toBe(true);
    expect(a.claims.some((c) => /v2\.3\.0/.test(c.text))).toBe(false);
  });

  it("flags single-contributor concentration as a risk with evidence", () => {
    const a = answerFromInsight(
      "is this maintained?",
      profile({ contributorCount: 1, topContributors: JSON.stringify([{ login: "ada", commits: 500 }]) }, [E("e_c", "contributors")]),
    );
    const claim = a.claims.find((c) => /Only 1 contributor/.test(c.text));
    expect(claim).toBeDefined();
    expect(claim!.evidenceIds).toContain("e_c");
  });

  it("uses the plural correctly for a two-contributor repository", () => {
    const a = answerFromInsight(
      "is this maintained?",
      profile({ contributorCount: 2, topContributors: JSON.stringify([{ login: "ada", commits: 5 }]) }, [E("e_c", "contributors")]),
    );
    expect(a.claims.some((c) => /Only 2 contributors have/.test(c.text))).toBe(true);
  });

  it("answers an unmapped question with the general profile and still cites", () => {
    const a = answerFromInsight("tell me about this", profile({}, [E("e_repo", "repo"), E("e_sec", "security")]));
    expect(a.answered).toBe(true);
    expect(a.claims.length).toBeGreaterThan(0);
    for (const c of a.claims) expect(c.evidenceIds.length).toBeGreaterThan(0);
  });

  it("reports the searched evidence kinds so a gap is explainable", () => {
    const a = answerFromInsight("who owns this?", profile({}, [E("e1", "codeowners"), E("e2", "repo")]));
    expect(a.searchedKinds).toEqual(expect.arrayContaining(["codeowners", "repo"]));
  });

  it("spans two facets for a question that is about both", () => {
    // "getting started" is an onboarding question, which is also a CI question;
    // both branches should contribute rather than only the first match.
    const a = answerFromInsight("how do I get started", profile({}, [E("e_ci", "workflow"), E("e_r", "readme")]));
    expect(a.claims.some((c) => /CI runs from/.test(c.text))).toBe(true);
    expect(a.claims.some((c) => /README/.test(c.text))).toBe(true);
  });
});
