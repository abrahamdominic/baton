import { prisma } from "../db";

/**
 * Grounded question answering over collected repository intelligence.
 *
 * The contract, and the reason this file contains no language model:
 *
 *  - An answer is a list of **claims**.
 *  - Every claim carries at least one `RepoEvidence` id.
 *  - A claim with no evidence is not rendered.
 *  - When nothing in the collected evidence bears on the question, the answer
 *    says so explicitly and returns no claims.
 *
 * That means the worst case is "I have no evidence for that", never a confident
 * invention. It is also why the retrieval is transparent: a developer can open
 * the cited file and check the answer themselves.
 *
 * This is retrieval plus deterministic composition. It is not a chatbot, and it
 * is not marketed as one.
 */

export type InsightQuestionKind =
  | "ownership"
  | "onboarding"
  | "ci"
  | "structure"
  | "language"
  | "maintenance"
  | "release";

export interface AnswerClaim {
  text: string;
  evidenceIds: string[];
}

export interface GroundedAnswer {
  question: string;
  /** Which evidence-backed facets of the profile were consulted. */
  intent: InsightQuestionKind;
  answered: boolean;
  claims: AnswerClaim[];
  /** Evidence that was searched and rejected, so a gap is explainable. */
  searchedKinds: string[];
}

interface InsightWithEvidence {
  id: string;
  repoId: string;
  description: string | null;
  topics: string;
  languages: string;
  hasReadme: boolean;
  hasCodeowners: boolean;
  hasContributing: boolean;
  hasCiWorkflows: boolean;
  hasSecurityPolicy: boolean;
  hasLicense: boolean;
  defaultBranch: string | null;
  openPullRequests: number;
  openIssues: number;
  mergedLast30Days: number | null;
  contributorCount: number;
  topContributors: string;
  lastReleaseTag: string | null;
  lastReleaseAt: Date | null;
  structure: string;
  evidence: { id: string; kind: string; label: string; rank: number }[];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Map free text to the facet the question is about.
 *
 * Keyword based on purpose. When nothing matches, `null` is returned and the
 * caller answers with the profile as a whole rather than guessing a facet —
 * guessing would risk answering an ownership question with a language fact.
 *
 * Matching is on **word boundaries**, not substrings. Substring matching is
 * actively dangerous for short tokens: a plain `includes("ci")` classifies
 * "what is the airspeed *veloci*ty" as a CI question, and the product would then
 * answer a physics question with CI facts. Every pattern below is a word or
 * phrase terminated by a non-word character.
 */
export function detectIntent(question: string): InsightQuestionKind | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  // A phrase matches when it is surrounded by spaces, so "ci" cannot match the
  // middle of "velocity" but "github actions" still matches as a unit.
  const has = (...phrases: string[]) => phrases.some((p) => q.includes(` ${p} `));

  if (has("who reviews", "who should review", "who reviews this", "who owns", "ownership", "codeowner", "codeowners", "who approve", "reviewer routing")) {
    return "ownership";
  }
  if (has("onboard", "onboarding", "getting started", "get started", "new developer", "new joiner", "how do i start", "first day", "contributing", "contribute")) {
    return "onboarding";
  }
  if (has("ci", "continuous integration", "workflow", "workflows", "pipeline", "test run", "github action", "github actions", "build failing", "what broke", "whats broke")) {
    return "ci";
  }
  if (has("structure", "layout", "directory", "directories", "folder", "folders", "where is", "organise", "organize", "organised", "organized")) {
    return "structure";
  }
  if (has("language", "languages", "stack", "written in", "tech stack", "framework")) {
    return "language";
  }
  if (has("release", "releases", "version", "changelog", "shipped", "publish", "published")) {
    return "release";
  }
  if (has("maintain", "maintained", "maintenance", "active", "stale", "abandon", "abandoned", "bus factor", "who works", "busfactor")) {
    return "maintenance";
  }
  return null;
}

export async function loadInsight(repoRowId: string): Promise<InsightWithEvidence | null> {
  return prisma.repositoryInsight.findUnique({
    where: { repoId: repoRowId },
    include: {
      evidence: { select: { id: true, kind: true, label: true, rank: true }, orderBy: { rank: "asc" } },
    },
  });
}

/**
 * Answer a question from a loaded profile.
 *
 * Pure: no database access, so every branch is unit-testable without a fixture.
 * The caller is responsible for persisting the question.
 */
export function answerFromInsight(
  question: string,
  insight: InsightWithEvidence | null,
): GroundedAnswer {
  if (!insight) {
    return {
      question,
      intent: "structure",
      answered: false,
      claims: [],
      searchedKinds: [],
    };
  }

  const intent = detectIntent(question);
  const byKind = new Map<string, string[]>();
  for (const e of insight.evidence) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e.id);
    byKind.set(e.kind, list);
  }
  const ids = (...kinds: string[]) => kinds.flatMap((k) => byKind.get(k) ?? []);
  const claims: AnswerClaim[] = [];

  const push = (text: string, evidenceIds: string[]) => {
    if (evidenceIds.length > 0) claims.push({ text, evidenceIds });
  };

  // Every facet below is additive, so a question that spans two topics gets both
  // answered rather than whichever one matched first.
  if (intent === "ownership" || intent === "maintenance") {
    const owners = ids("codeowners");
    if (owners.length > 0) {
      push(
        "This repository declares code owners in CODEOWNERS, so the owning team is defined in the repository rather than by convention.",
        owners,
      );
    }
    const top = parseJson<{ login: string; commits: number }[]>(insight.topContributors, []);
    const contrib = ids("contributors");
    if (top.length > 0) {
      push(
        `Recent commit volume is led by ${top.slice(0, 3).map((c) => `${c.login} (${c.commits})`).join(", ")}.`,
        contrib,
      );
      if (insight.contributorCount <= 2) {
        push(
          `Only ${insight.contributorCount} contributor${insight.contributorCount === 1 ? " has" : "s have"} committed recently, so knowledge is concentrated and worth writing down.`,
          contrib,
        );
      }
    }
  }

  if (intent === "ci" || intent === "onboarding") {
    const ci = ids("workflow");
    const structure = parseJson<{ topLevel: string[]; workflowNames: string[] }>(insight.structure, {
      topLevel: [],
      workflowNames: [],
    });
    if (structure.workflowNames.length > 0) {
      push(
        `CI runs from ${structure.workflowNames.length} workflow${structure.workflowNames.length === 1 ? "" : "s"}: ${structure.workflowNames.join(", ")}.`,
        ci,
      );
    } else {
      push(
        "No GitHub Actions workflows are present in the default branch, so there is no repository-defined CI to reproduce locally.",
        ids("structure", "workflow"),
      );
    }
  }

  if (intent === "onboarding" || intent === "structure") {
    const readme = ids("readme");
    if (insight.hasReadme) {
      push("A README is present in the default branch and is the documented starting point.", readme);
    }
    if (insight.hasContributing) {
      push(
        "A CONTRIBUTING guide is present, so the expected contribution workflow is written down.",
        ids("contributing"),
      );
    } else {
      push(
        "There is no CONTRIBUTING guide, so the contribution workflow is not documented and has to be learned from maintainers.",
        ids("structure"),
      );
    }
    const topLevel = parseJson<{ topLevel: string[] }>(insight.structure, { topLevel: [] }).topLevel;
    if (topLevel.length > 0) {
      push(
        `The trunk of the default branch contains ${topLevel.slice(0, 12).join(", ")}.`,
        ids("structure"),
      );
    }
  }

  if (intent === "language") {
    const langs = parseJson<{ name: string; percent: number }[]>(insight.languages, []);
    const langEvidence = ids("languages");
    if (langs.length > 0) {
      push(
        `The codebase is ${langs.slice(0, 3).map((l) => `${Math.round(l.percent)}% ${l.name}`).join(", ")}.`,
        langEvidence,
      );
    } else {
      push("GitHub reports no detected language bytes for this repository.", langEvidence);
    }
  }

  if (intent === "release") {
    if (insight.lastReleaseTag) {
      push(
        `The latest release is ${insight.lastReleaseTag}${insight.lastReleaseAt ? `, published ${insight.lastReleaseAt.toISOString().slice(0, 10)}` : ""}.`,
        ids("release"),
      );
    } else {
      push("No GitHub release has been published for this repository.", ids("repo"));
    }
    // Only state the shipping cadence when GitHub actually reported it. A null
    // here is "the search API could not see this repository", and answering
    // "0 pull requests have merged" would be a fabricated fact.
    if (insight.mergedLast30Days !== null) {
      push(
        `${insight.mergedLast30Days} pull request${insight.mergedLast30Days === 1 ? " has" : "s have"} merged in the last 30 days, which is the observable shipping cadence.`,
        ids("repo"),
      );
    }
  }

  // A question with no recognised facet still gets the factual summary, but only
  // the parts that have evidence behind them.
  if (claims.length === 0) {
    const topics = parseJson<string[]>(insight.topics, []);
    const repoEvidence = ids("repo");
    if (insight.description) {
      push(insight.description, repoEvidence);
    }
    if (topics.length > 0) {
      push(`GitHub topics for this repository: ${topics.join(", ")}.`, repoEvidence);
    }
    if (insight.hasSecurityPolicy) {
      push("A published security policy exists.", ids("security"));
    }
    if (insight.hasLicense) {
      push("The project ships a license file.", ids("license"));
    }
  }

  return {
    question,
    intent: intent ?? "structure",
    answered: claims.length > 0,
    claims,
    searchedKinds: [...byKind.keys()],
  };
}

export async function askQuestion(
  userId: string,
  repoRowId: string,
  question: string,
): Promise<GroundedAnswer> {
  const insight = await loadInsight(repoRowId);
  const answer = answerFromInsight(question, insight);

  // Only persisted when there is a profile to ground it in; a question against an
  // un-indexed repository has nothing to record and would just be noise.
  if (insight) {
    await prisma.insightQuestion.create({
      data: {
        userId,
        insightId: insight.id,
        question,
        answer: JSON.stringify(answer),
      },
    });
  }
  return answer;
}
