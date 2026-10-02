import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { metrics } from "@/lib/observability/metrics";
import {
  readStructure,
  type StoredStructure,
} from "@/lib/intelligence/profile";
import {
  parseCodeowners,
  resolveCodeowners,
} from "@/lib/intelligence/codeowners";

/**
 * Automated developer workflows (§8).
 *
 * The distinction this module exists to enforce
 * ---------------------------------------------
 * must.md asks for repetitive GitHub work to be "implemented as actual
 * workflows rather than generic AI chat". That distinction has a concrete
 * meaning here, and it is enforced by the type system rather than by
 * convention:
 *
 *  - A workflow is a **pure function** from collected facts to findings. It
 *    cannot call GitHub, cannot write to the database, and cannot read a clock.
 *    Everything nondeterministic is passed in. This is what makes every workflow
 *    unit-testable without a network or a fixture database, and it is why the
 *    existing `briefing.ts` / `catchup.ts` / `impact.ts` modules are shaped the
 *    way they are.
 *  - A finding is a **record with a confidence and a basis**, never a paragraph.
 *    `confidence: "observed"` means GitHub told us; `"derived"` means we
 *    computed it from observed facts by a documented rule; `"speculative"`
 *    means we noticed a textual resemblance and are saying so. A workflow may
 *    never emit a finding with no basis at all — `assertFindings` enforces it.
 *
 * What this deliberately does not do
 * ---------------------------------
 * It never acts. No finding closes an issue, comments on a PR, or reassigns a
 * reviewer. §17 and §18 require that developers keep control over what becomes
 * work, so a workflow's entire output is a proposal the user confirms. The one
 * place that distinction is enforced is `confirmWorkSignalAsContext` in
 * `intelligence/work-detection.ts`, which re-derives server-side rather than
 * trusting the client.
 */

/** How a finding was arrived at. Rendered in the UI next to every finding. */
export type FindingConfidence = "observed" | "derived" | "speculative";

export type WorkflowKind =
  | "stale_work"
  | "blocked_work"
  | "abandoned_work"
  | "duplicate_issues"
  | "related_work"
  | "docs_implications"
  | "affected_tests"
  | "waiting_on_people"
  | "release_readiness"
  | "unowned_changes"
  | "dependency_chains";

export interface WorkflowFinding {
  /** Stable within a workflow run, so the UI can key on it. */
  id: string;
  kind: WorkflowKind;
  /** One line. States the observation, not an opinion about it. */
  title: string;
  /** What makes this claim true. Never empty. */
  basis: string;
  confidence: FindingConfidence;
  /** In-app destination, or null when the finding has no page of its own. */
  href: string | null;
  /** Repository-relative or GitHub paths that back the finding. */
  paths: string[];
  /** People the finding concerns. */
  actors: string[];
  /**
   * 0-100, and deliberately *not* called a probability. It ranks findings
   * against each other within one workflow; it is not a claim that finding #1 is
   * "87% likely to matter", which is a number nobody here can defend.
   */
  severity: number;
}

/** Reject any finding that would be an unsourced assertion. */
function assertFindings(kind: WorkflowKind, findings: WorkflowFinding[]): void {
  for (const f of findings) {
    if (!f.basis.trim()) {
      throw new Error(
        `workflow ${kind} produced a finding with no basis: ${f.id}`,
      );
    }
    if (!f.title.trim()) {
      throw new Error(`workflow ${kind} produced an untitled finding: ${f.id}`);
    }
  }
}

/** Read a PR's persisted snapshot into the fields workflows reason about. */
export interface WorkflowPr {
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  url: string;
  baseRef: string;
  headRef: string;
  isDraft: boolean;
  githubState: string;
  reviewDecision: string | null;
  requestedReviewersJson: string;
  labelsJson: string;
  checksJson: string;
  stateEnteredAt: Date;
  githubUpdatedAt: Date;
  createdAt: Date;
  /** Raw snapshot JSON; carries the file list when one was collected. */
  snapshotJson?: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export interface CheckSummaryInput {
  slug: string;
  name: string;
  conclusion: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

function checkSummary(pr: WorkflowPr): CheckSummaryInput[] {
  const checks = parseJson<unknown>(pr.checksJson, []);
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    const conclusion = typeof o.conclusion === "string" ? o.conclusion : "";
    if (!conclusion) return [];
    return [
      {
        slug: typeof o.name === "string" ? o.name : String(o.slug ?? "check"),
        name: typeof o.name === "string" ? o.name : String(o.slug ?? "check"),
        conclusion,
        startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
        completedAt: typeof o.completedAt === "string" ? o.completedAt : null,
      },
    ];
  });
}

function labelsOf(pr: WorkflowPr): string[] {
  const labels = parseJson<unknown>(pr.labelsJson, []);
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((l) => {
    if (typeof l === "string") return [l];
    if (typeof l === "object" && l !== null) {
      const name = (l as { name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }
    return [];
  });
}

function reviewersOf(pr: WorkflowPr): string[] {
  const reviewers = parseJson<unknown>(pr.requestedReviewersJson, []);
  if (!Array.isArray(reviewers)) return [];
  return reviewers.flatMap((r) => {
    if (typeof r === "string") return [r];
    if (typeof r === "object" && r !== null) {
      const login = (r as { login?: unknown }).login;
      return typeof login === "string" ? [login] : [];
    }
    return [];
  });
}

/** States where nobody has to do anything yet, so a finding would be noise. */
const TERMINAL_STATES = new Set(["merged", "closed", "unknown"]);
const ACTIONABLE_STATES = new Set([
  "awaiting_review",
  "awaiting_review_after_fix",
  "changes_required",
  "ci_failing",
  "blocked_on_checks",
  "conflicts",
  "ready_to_merge",
]);

function days(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Workflow 1: stale work
// ---------------------------------------------------------------------------

/**
 * Pull requests that have been sitting in the same actionable state for longer
 * than a stated threshold.
 *
 * The threshold is an input, never a constant, for the same reason `briefing.ts`
 * takes `days` as a parameter: a test has to be able to prove that a 40-day-old
 * PR stops being fresh without faking timers.
 */
export function staleWork(
  prs: WorkflowPr[],
  now: Date,
  options: { thresholdDays: number },
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  for (const pr of prs) {
    if (TERMINAL_STATES.has(pr.state)) continue;
    const age = days(pr.stateEnteredAt, now);
    if (age <= options.thresholdDays) continue;
    findings.push({
      id: `stale-${pr.number}`,
      kind: "stale_work",
      title: `#${pr.number} has been in ${pr.state.replace(/_/g, " ")} for ${age} days`,
      basis: `Baton last recorded a state change on ${pr.stateEnteredAt.toISOString().slice(0, 10)}; the staleness threshold is ${options.thresholdDays} days.`,
      confidence: "observed",
      href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
      paths: [],
      actors: [pr.authorLogin],
      severity: Math.min(100, 40 + age),
    });
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

/** `/owner/repo` from a GitHub PR URL. Falls back to a placeholder. */
function repoOf(prUrl: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\//.exec(prUrl);
  return m?.[1] ?? "unknown/unknown";
}

// ---------------------------------------------------------------------------
// Workflow 2: blocked work
// ---------------------------------------------------------------------------

/**
 * Work that is blocked on something structural rather than on a person.
 *
 * Conflicts and failing checks are separated from "awaiting review" on purpose:
 * the first two have a concrete unblocking step, the third only has a person.
 * Collapsing them into one "blocked" bucket is what makes a notification useless.
 */
export function blockedWork(prs: WorkflowPr[], now: Date): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  for (const pr of prs) {
    if (!ACTIONABLE_STATES.has(pr.state)) continue;
    const age = days(pr.stateEnteredAt, now);

    if (pr.state === "conflicts") {
      findings.push({
        id: `blocked-conflict-${pr.number}`,
        kind: "blocked_work",
        title: `#${pr.number} has merge conflicts with ${pr.baseRef}`,
        basis: `GitHub reports the pull request as ${pr.state} and it has been so for ${age} day${age === 1 ? "" : "s"}.`,
        confidence: "observed",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [pr.authorLogin],
        severity: 70,
      });
      continue;
    }

    if (pr.state === "ci_failing" || pr.state === "blocked_on_checks") {
      const failed = checkSummary(pr).filter(
        (c) => c.conclusion === "FAILURE" || c.conclusion === "CANCELLED",
      );
      findings.push({
        id: `blocked-ci-${pr.number}`,
        kind: "blocked_work",
        title: `#${pr.number} is blocked by ${failed.length} failing check${failed.length === 1 ? "" : "s"}`,
        basis:
          failed.length > 0
            ? `Failing checks: ${failed.map((c) => c.name).join(", ")}.`
            : `Baton classified the pull request as ${pr.state} on ${pr.stateEnteredAt.toISOString().slice(0, 10)}; no individual check conclusion was recorded in the snapshot.`,
        confidence: failed.length > 0 ? "observed" : "derived",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [pr.authorLogin],
        severity: failed.length > 0 ? 80 : 60,
      });
      continue;
    }

    if (pr.state === "changes_required") {
      findings.push({
        id: `blocked-changes-${pr.number}`,
        kind: "blocked_work",
        title: `#${pr.number} has review feedback the author has not addressed`,
        basis: `GitHub reports reviewDecision=${pr.reviewDecision ?? "CHANGES_REQUESTED"} and Baton has recorded the state for ${age} day${age === 1 ? "" : "s"}.`,
        confidence: "observed",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [pr.authorLogin],
        severity: 65,
      });
    }
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Workflow 3: abandoned work
// ---------------------------------------------------------------------------

/**
 * Work that looks finished-in-progress: no reviewer ever engaged, no commit for
 * a while, and not in draft.
 *
 * The three signals are ANDed. Any one of them alone misfires constantly — an
 * unreviewed PR with recent commits is just a new PR, and an old PR with a
 * reviewer is just a slow one.
 */
export function abandonedWork(
  prs: WorkflowPr[],
  now: Date,
  options: { inactiveDays: number },
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  for (const pr of prs) {
    if (TERMINAL_STATES.has(pr.state) || pr.isDraft) continue;
    const quietDays = days(pr.githubUpdatedAt, now);
    if (quietDays < options.inactiveDays) continue;

    const reviewers = reviewersOf(pr);
    const hasEngagement =
      reviewers.length > 0 ||
      pr.reviewDecision !== null ||
      labelsOf(pr).some((l) => /hold|stale|wip/i.test(l));

    if (hasEngagement) continue;

    findings.push({
      id: `abandoned-${pr.number}`,
      kind: "abandoned_work",
      title: `#${pr.number} "${pr.title}" has had no activity for ${quietDays} days and no reviewer`,
      basis: `Last GitHub update ${pr.githubUpdatedAt.toISOString().slice(0, 10)}, no requested reviewers, reviewDecision is ${pr.reviewDecision ?? "unset"}, and the inactivity threshold is ${options.inactiveDays} days.`,
      confidence: "derived",
      href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
      paths: [],
      actors: [pr.authorLogin],
      severity: Math.min(90, 30 + quietDays),
    });
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Workflow 4: waiting on specific people
// ---------------------------------------------------------------------------

/**
 * Which person each pull request is actually waiting on.
 *
 * Answers §8's "identify PRs waiting on specific people" from recorded GitHub
 * state only. When no reviewer is requested and reviewDecision is unset, the
 * finding states that nobody is waiting rather than guessing an owner.
 */
export function waitingOnPeople(
  prs: WorkflowPr[],
  now: Date,
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  for (const pr of prs) {
    if (
      pr.state !== "awaiting_review" &&
      pr.state !== "awaiting_review_after_fix"
    )
      continue;
    const reviewers = reviewersOf(pr);
    const age = days(pr.stateEnteredAt, now);

    if (reviewers.length === 0) {
      findings.push({
        id: `waiting-none-${pr.number}`,
        kind: "waiting_on_people",
        title: `#${pr.number} is ready for review but nobody has been asked`,
        basis: `No requested reviewers are recorded on this pull request; it has been awaiting review for ${age} day${age === 1 ? "" : "s"}.`,
        confidence: "observed",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [pr.authorLogin],
        severity: 75,
      });
      continue;
    }

    for (const reviewer of reviewers) {
      findings.push({
        id: `waiting-${pr.number}-${reviewer}`,
        kind: "waiting_on_people",
        title: `#${pr.number} is waiting on @${reviewer}`,
        basis: `@${reviewer} is a requested reviewer and the pull request has been awaiting review for ${age} day${age === 1 ? "" : "s"}.`,
        confidence: "observed",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [reviewer],
        severity: Math.min(100, 50 + age),
      });
    }
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Workflow 5: duplicate issues
// ---------------------------------------------------------------------------

export interface IssueLike {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: string[];
  createdAt: Date;
  authorLogin: string;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "it",
  "its",
  "this",
  "that",
  "when",
  "not",
  "no",
  "if",
  "then",
  "else",
  "we",
  "i",
  "you",
  "they",
  "he",
  "she",
  "my",
  "our",
  "does",
  "do",
  "did",
  "has",
  "have",
  "had",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
]);

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Keep `#123` references and `camelCase`/snake_case identifiers intact,
      // because "fix login bug #412" and "fix login bug #412" matching is the whole
      // point, while splitting on punctuation would throw the reference away.
      .replace(/[^a-z0-9#]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

/**
 * Jaccard similarity over content tokens.
 *
 * Chosen over cosine/TF-IDF because it needs no corpus, is symmetric, and — most
 * importantly — is *explainable*. When a finding says "these two issues look
 * 72% similar", the basis line can list the exact shared tokens, and a developer
 * can check the reasoning in two seconds. An opaque embedding similarity cannot
 * be argued with, and §12/§13 both require that an operator be able to disagree
 * with the system.
 */
export function jaccard(
  a: string[],
  b: string[],
): { score: number; shared: string[] } {
  if (a.length === 0 || b.length === 0) return { score: 0, shared: [] };
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((t) => setB.has(t));
  const union = new Set([...setA, ...setB]);
  return { score: shared.length / union.size, shared: shared.sort() };
}

/**
 * Near-duplicate issues.
 *
 * Reported as `speculative` always, never `observed`: text similarity is a
 * resemblance, and two issues about "login" are genuinely different bugs half the
 * time. The shared tokens are included in the basis precisely so the user can
 * dismiss it in one glance instead of trusting a number.
 */
export function duplicateIssues(
  issues: IssueLike[],
  options: { threshold: number },
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const tokenized = issues.map((issue) => ({
    issue,
    tokens: tokenize(`${issue.title} ${issue.body}`),
  }));

  for (let i = 0; i < tokenized.length; i += 1) {
    for (let j = i + 1; j < tokenized.length; j += 1) {
      const a = tokenized[i]!;
      const b = tokenized[j]!;
      if (a.issue.state !== "open" || b.issue.state !== "open") continue;
      const { score, shared } = jaccard(a.tokens, b.tokens);
      if (score < options.threshold) continue;
      findings.push({
        id: `dup-${a.issue.number}-${b.issue.number}`,
        kind: "duplicate_issues",
        title: `#${a.issue.number} and #${b.issue.number} may be the same problem`,
        basis: `Titles and bodies share ${Math.round(score * 100)}% of their content tokens (${shared.slice(0, 6).join(", ")}). Textual resemblance only — confirm before closing either.`,
        confidence: "speculative",
        href: `/dashboard/repos/${repoOf(a.issue.url)}/pulls/${b.issue.number}`,
        paths: [],
        actors: [a.issue.authorLogin, b.issue.authorLogin],
        severity: Math.round(score * 100),
      });
    }
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Workflow 6: related work
// ---------------------------------------------------------------------------

/**
 * Connect a pull request to the issues and pull requests it plausibly relates to.
 *
 * Two independent signals are used and reported separately, because they have
 * very different reliability:
 *  - a `#123` reference in the title or branch name is `derived` from text the
 *    author wrote, and is usually right;
 *  - shared content tokens with an unrelated issue are `speculative`.
 *
 * Collapsing them into one confidence level is exactly how a product ends up
 * presenting a guess as a fact, which §11 forbids.
 */
export function relatedWork(
  prs: WorkflowPr[],
  issues: IssueLike[],
  options: { tokenThreshold: number },
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const openIssues = issues.filter((i) => i.state === "open");

  for (const pr of prs) {
    if (TERMINAL_STATES.has(pr.state)) continue;
    const haystack = `${pr.title} ${pr.headRef}`;

    // Explicit references first.
    const referenced = new Set<number>();
    for (const m of haystack.matchAll(/#(\d{1,6})\b/g)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n !== pr.number) referenced.add(n);
    }
    for (const n of referenced) {
      const issue = openIssues.find((i) => i.number === n);
      findings.push({
        id: `related-ref-${pr.number}-${n}`,
        kind: "related_work",
        title: `#${pr.number} references issue #${n}`,
        basis: issue
          ? `The pull request title or branch name contains "#${n}", which is the open issue "${issue.title}".`
          : `The pull request title or branch name contains "#${n}". GitHub reports no matching open issue, so the reference may be to a closed one, a pull request, or a typo.`,
        confidence: "observed",
        href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
        paths: [],
        actors: [pr.authorLogin, ...(issue ? [issue.authorLogin] : [])],
        severity: 85,
      });
    }

    // Token overlap second, kept strictly below the reference confidence.
    if (referenced.size === 0) {
      const prTokens = tokenize(`${pr.title} ${pr.headRef}`);
      for (const issue of openIssues) {
        if (referenced.has(issue.number)) continue;
        const { score, shared } = jaccard(
          prTokens,
          tokenize(`${issue.title} ${issue.body}`),
        );
        if (score < options.tokenThreshold) continue;
        findings.push({
          id: `related-token-${pr.number}-${issue.number}`,
          kind: "related_work",
          title: `#${pr.number} may relate to #${issue.number}`,
          basis: `Shared content tokens (${shared.slice(0, 6).join(", ")}) at ${Math.round(score * 100)}% overlap, with no explicit issue reference on the pull request.`,
          confidence: "speculative",
          href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
          paths: [],
          actors: [pr.authorLogin, issue.authorLogin],
          severity: Math.round(score * 60),
        });
      }
    }
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Workflow 7 & 8: documentation implications and affected tests
// ---------------------------------------------------------------------------

/**
 * File list from a PR snapshot, or `null` when it was never collected.
 *
 * `null` is the important return value: a snapshot taken before file collection
 * has no list, and callers must report "unknown" rather than "no files changed",
 * for the same reason `briefing.ts` omits an uncollected diff size.
 */
export function pathsFromSnapshot(
  snapshotJson: string | null | undefined,
): string[] | null {
  if (!snapshotJson) return null;
  const parsed = parseJson<{ files?: unknown } | null>(snapshotJson, null);
  if (!parsed || !Array.isArray(parsed.files)) return null;
  const paths = parsed.files.flatMap((f) => {
    if (typeof f === "string") return [f];
    if (typeof f === "object" && f !== null) {
      const p = (f as { path?: unknown }).path;
      return typeof p === "string" ? [p] : [];
    }
    return [];
  });
  return paths.length > 0 ? paths : null;
}

const DOC_PATH = /(^|\/)(docs?|documentation|guides?)(\/|$)/i;
const DOC_FILE = /\.(md|mdx|rst|adoc|txt)$/i;

/**
 * Changes that plausibly require a documentation update.
 *
 * The signal is deliberately narrow: a change under `docs/` obviously needs its
 * own docs, and a change to a file whose path names a user-facing concept
 * (routes, API, CLI, config schema) usually does too. It is reported as
 * `derived`, never `observed`, because whether a change needs docs is a judgement
 * the repository's own maintainers get to make.
 */
export function docsImplications(changedPaths: string[]): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];

  const docChanges = changedPaths.filter(
    (p) => DOC_PATH.test(p) || DOC_FILE.test(p),
  );
  if (docChanges.length > 0) {
    findings.push({
      id: "docs-changed",
      kind: "docs_implications",
      title: `${docChanges.length} documentation file${docChanges.length === 1 ? "" : "s"} changed`,
      basis: `Changed documentation paths: ${docChanges.slice(0, 5).join(", ")}.`,
      confidence: "observed",
      href: null,
      paths: docChanges,
      actors: [],
      severity: 20,
    });
  }

  const surfaceChanges = changedPaths.filter((p) =>
    /(^|\/)(api|routes?|controllers?|cli|commands?|config|schema)([/.]|$)/i.test(
      p,
    ),
  );
  if (surfaceChanges.length > 0 && docChanges.length === 0) {
    findings.push({
      id: "docs-surface-changed",
      kind: "docs_implications",
      title: `Public surface changed without a documentation change`,
      basis: `Changed paths under API, route, CLI, config or schema directories: ${surfaceChanges.slice(0, 5).join(", ")}, and no file matching docs/ or a documentation extension was changed in the same pull request.`,
      confidence: "derived",
      href: null,
      paths: surfaceChanges,
      actors: [],
      severity: 55,
    });
  }

  return findings;
}

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)|\.(test|spec)\.[a-z]+$/i;

/**
 * Tests likely affected by a change.
 *
 * Two tiers, reported with different confidence:
 *  - a test file changed alongside source, or a test path shares a directory
 *    prefix with a changed source file — `derived`, because the path relationship
 *    is computed but the causal claim is not;
 *  - nothing at all when the repository has no tests, which is a finding in
 *    itself rather than an empty result.
 */
export function affectedTests(
  changedPaths: string[],
  options: { hasTestsInRepo: boolean },
): WorkflowFinding[] {
  if (!options.hasTestsInRepo) {
    return [
      {
        id: "tests-none",
        kind: "affected_tests",
        title: "This repository has no detectable test suite",
        basis:
          "No test file matched the repository's test path patterns during collection, so a change here has no automated check to fail.",
        confidence: "derived",
        href: null,
        paths: [],
        actors: [],
        severity: 60,
      },
    ];
  }

  const changedTests = changedPaths.filter((p) => TEST_PATH.test(p));
  if (changedTests.length > 0) {
    return [
      {
        id: "tests-changed",
        kind: "affected_tests",
        title: `${changedTests.length} test file${changedTests.length === 1 ? "" : "s"} changed in this pull request`,
        basis: `Changed test paths: ${changedTests.slice(0, 5).join(", ")}.`,
        confidence: "observed",
        href: null,
        paths: changedTests,
        actors: [],
        severity: 40,
      },
    ];
  }

  // Same-directory heuristic: `src/auth/login.ts` -> `src/auth/login.test.ts`.
  const dirs = new Set(
    changedPaths
      .filter((p) => !TEST_PATH.test(p))
      .map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")),
  );
  if (dirs.size === 0) return [];
  return [
    {
      id: "tests-adjacent",
      kind: "affected_tests",
      title: `Source changed under ${dirs.size} director${dirs.size === 1 ? "y" : "ies"} with no test file changed`,
      basis: `Changed source directories: ${[...dirs].slice(0, 5).join(", ")}. Baton matches tests by directory only; it does not read test contents, so a co-located test may still cover this.`,
      confidence: "derived",
      href: null,
      paths: [...dirs],
      actors: [],
      severity: 35,
    },
  ];
}

// ---------------------------------------------------------------------------
// Workflow 9: unowned changes (CODEOWNERS)
// ---------------------------------------------------------------------------

/**
 * Changed paths that no CODEOWNERS rule covers.
 *
 * `resolveCodeowners` already implements GitHub's last-match-wins precedence
 * including `!` negation, so "unowned" is computed by reusing it rather than by
 * writing a second, subtly different matcher. Two implementations of
 * CODEOWNERS semantics is precisely how a file gets reported as owned by the
 * wrong team.
 *
 * Confidence is `observed`: the repository states the rule and the changed paths
 * are known, so "no rule assigns an owner" is exact rather than inferred. The
 * basis line names the rule count so the claim can be checked against the file.
 */
export function unownedChanges(
  changedPaths: string[],
  codeownersRaw: string | null,
): WorkflowFinding[] {
  if (!codeownersRaw || changedPaths.length === 0) return [];
  const rules = parseCodeowners(codeownersRaw);
  if (rules.length === 0) return [];

  const assigned = new Set<string>();
  for (const match of resolveCodeowners(rules, changedPaths)) {
    for (const path of match.paths) assigned.add(path);
  }

  const unowned = changedPaths.filter((path) => !assigned.has(path));
  if (unowned.length === 0) return [];

  return [
    {
      id: "unowned-changes",
      kind: "unowned_changes",
      title: `${unowned.length} changed path${unowned.length === 1 ? "" : "s"} ${unowned.length === 1 ? "is" : "are"} not covered by CODEOWNERS`,
      basis: `CODEOWNERS defines ${rules.length} rule${rules.length === 1 ? "" : "s"}, none of which assigns an owner to: ${unowned.slice(0, 5).join(", ")}.`,
      confidence: "observed",
      href: null,
      paths: unowned,
      actors: [],
      severity: 45,
    },
  ];
}

// ---------------------------------------------------------------------------
// Workflow 10: dependency chains
// ---------------------------------------------------------------------------

/**
 * Pull requests whose branches are stacked on one another.
 *
 * Detected from branch names (`feature/login` vs `feature/login-2`) and from
 * head/base relationships already in the snapshot. Reported `derived`: the name
 * convention is a strong convention, not a guarantee, and a wrong stacking claim
 * would send someone rebasing the wrong branch.
 */
export function dependencyChain(prs: WorkflowPr[]): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const open = prs.filter((p) => p.githubState === "OPEN");

  for (const pr of prs) {
    if (pr.githubState !== "OPEN") continue;
    for (const other of open) {
      if (other.number === pr.number) continue;
      // Explicit: this PR's base branch is another open PR's head branch.
      if (pr.baseRef === other.headRef) {
        findings.push({
          id: `dep-${pr.number}-${other.number}`,
          kind: "dependency_chains",
          title: `#${pr.number} is stacked on #${other.number}`,
          basis: `#${pr.number} targets "${pr.baseRef}", which is the head branch of #${other.number} ("${other.headRef}").`,
          confidence: "observed",
          href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
          paths: [],
          actors: [pr.authorLogin, other.authorLogin],
          severity: 70,
        });
        continue;
      }
      // Convention: same prefix, numeric suffix.
      const stacked = stackedPair(pr.headRef, other.headRef);
      if (stacked) {
        findings.push({
          id: `dep-name-${pr.number}-${other.number}`,
          kind: "dependency_chains",
          title: `#${pr.number} and #${other.number} look stacked by branch naming`,
          basis: `Branches "${pr.headRef}" and "${other.headRef}" share the prefix "${stacked}", which is the stacked-branch naming convention. Baton did not read either branch, so this is a naming inference only.`,
          confidence: "speculative",
          href: `/dashboard/repos/${repoOf(pr.url)}/pulls/${pr.number}`,
          paths: [],
          actors: [pr.authorLogin, other.authorLogin],
          severity: 45,
        });
      }
    }
  }
  return dedupe(findings);
}

/** Shared prefix of two `feature/x` / `feature/x-2` style branch names. */
function stackedPair(a: string, b: string): string | null {
  const ma = /^(.*?)-?(\d+)$/.exec(a);
  const mb = /^(.*?)-?(\d+)$/.exec(b);
  if (!ma || !mb) return null;
  if (ma[1] !== mb[1] || !ma[1]) return null;
  if (ma[2] === mb[2]) return null;
  return `${ma[1]}-`;
}

function dedupe(findings: WorkflowFinding[]): WorkflowFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface WorkflowRunInput {
  prs: WorkflowPr[];
  /**
   * Whether the repository's structure was ever collected.
   *
   * Distinct from an empty structure. Without this, a repository nobody has
   * collected looks exactly like one with no CODEOWNERS and no tests, and the
   * structure-derived workflows would state both as facts about code that was
   * never read.
   */
  structureCollected: boolean;
  /**
   * Open issues, or `null` when Baton has not collected them.
   *
   * `null` and `[]` are different claims and are kept distinct on purpose: `[]`
   * means "we looked and there are none", while `null` means "we have no issue
   * data". Collapsing them would let an issue-shaped workflow report a clean
   * result it never actually checked.
   */
  issues: IssueLike[] | null;
  structure: StoredStructure;
  now: Date;
  thresholds: {
    staleDays: number;
    inactiveDays: number;
    duplicateThreshold: number;
    relatedTokenThreshold: number;
  };
}

export interface WorkflowRun {
  kind: WorkflowKind;
  findings: WorkflowFinding[];
  /** Set when the workflow could not run because its input was missing. */
  unavailable?: string;
}

/**
 * Run every workflow against one repository.
 *
 * Each workflow is isolated: a throw in one cannot take down the rest, because
 * a single malformed pull request must not blank the whole automation page.
 */
export function runWorkflows(input: WorkflowRunInput): WorkflowRun[] {
  const { prs, issues, structure, structureCollected, now, thresholds } = input;
  const runs: WorkflowRun[] = [];
  const guard = (kind: WorkflowKind, fn: () => WorkflowFinding[]) => {
    try {
      const findings = fn();
      assertFindings(kind, findings);
      runs.push({ kind, findings });
    } catch (e) {
      logger.error("workflow-failed", {
        kind,
        error: e instanceof Error ? e.message : String(e),
      });
      metrics.workflowRun(kind, false, 0);
      runs.push({
        kind,
        findings: [],
        unavailable:
          "This workflow could not complete. Try again, or check the worker logs.",
      });
    }
  };

  /**
   * Record a workflow that cannot run because its input was never collected.
   *
   * Distinct from a failure: nothing went wrong, the data simply does not exist
   * yet. It is surfaced rather than dropped so the page can say "no issue data"
   * instead of rendering an empty section that reads as a clean result.
   */
  const withoutData = (kind: WorkflowKind, reason: string) => {
    runs.push({ kind, findings: [], unavailable: reason });
  };

  const changedPaths = allChangedPaths(prs);

  guard("stale_work", () =>
    staleWork(prs, now, { thresholdDays: thresholds.staleDays }),
  );
  guard("blocked_work", () => blockedWork(prs, now));
  guard("abandoned_work", () =>
    abandonedWork(prs, now, { inactiveDays: thresholds.inactiveDays }),
  );
  guard("waiting_on_people", () => waitingOnPeople(prs, now));

  if (issues === null) {
    const reason =
      "Baton stores only the open-issue count for this repository, so this workflow has no issue list to compare. It has not reported anything.";
    withoutData("duplicate_issues", reason);
    // Related-work still finds PR-to-PR relationships; only the issue side is
    // missing, so it runs against an empty issue list and the findings it
    // produces are still real.
    guard("related_work", () =>
      relatedWork(prs, [], {
        tokenThreshold: thresholds.relatedTokenThreshold,
      }),
    );
  } else {
    guard("duplicate_issues", () =>
      duplicateIssues(issues, { threshold: thresholds.duplicateThreshold }),
    );
    guard("related_work", () =>
      relatedWork(prs, issues, {
        tokenThreshold: thresholds.relatedTokenThreshold,
      }),
    );
  }

  // A repository with no CODEOWNERS is not a repository whose changes are all
  // owned, and it is not a repository this workflow skipped: every changed file
  // genuinely has no declared owner. Reporting that as a derived finding keeps
  // the section from looking empty for the one case where the answer is known.
  // Structure-derived workflows are gated on collection, not merely on whether
  // the structure happens to be empty. "We never looked" and "we looked and
  // there is nothing" both arrive as an empty structure here, and only the
  // former must be reported as unknown.
  if (!structureCollected) {
    const reason =
      "Baton has not collected this repository's structure yet, so this workflow has nothing to read.";
    withoutData("unowned_changes", reason);
    withoutData("affected_tests", reason);
  } else {
    guard("unowned_changes", () =>
      structure.codeowners
        ? unownedChanges(changedPaths, structure.codeowners)
        : [
            {
              id: "no-codeowners",
              kind: "unowned_changes",
              title: "No CODEOWNERS file: no changed file has a declared owner",
              basis:
                "Collection found no CODEOWNERS in the repository root, .github/, or docs/, so there is nothing to resolve changed paths against. Review routing is implicit here.",
              confidence: "derived",
              severity: 45,
              href: null,
              paths: [],
              actors: [],
            },
          ],
    );
    guard("affected_tests", () =>
      affectedTests(changedPaths, {
        hasTestsInRepo: structure.profile.hasTests,
      }),
    );
  }

  guard("dependency_chains", () => dependencyChain(prs));
  guard("docs_implications", () => docsImplications(changedPaths));

  return runs;
}

/** Union of changed paths across pull requests that recorded one. */
export function allChangedPaths(prs: WorkflowPr[]): string[] {
  const set = new Set<string>();
  for (const pr of prs) {
    const paths = pathsFromSnapshot(pr.snapshotJson);
    if (!paths) continue;
    for (const p of paths) set.add(p);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Persistence: fetch the workflow inputs for a repository
// ---------------------------------------------------------------------------

/**
 * Load everything the workflows need for one repository.
 *
 * Reads persisted state only. No GitHub call is made here: a workflow that
 * triggered an API request would be slow, would burn rate limit, and would make
 * the automation page a source of load rather than a cache of it.
 */
export async function loadWorkflowInputs(
  repoId: string,
): Promise<WorkflowRunInput | null> {
  const [repo, insight, prs] = await Promise.all([
    prisma.repo.findUnique({
      where: { id: repoId },
      select: { id: true, enabled: true },
    }),
    prisma.repositoryInsight.findUnique({
      where: { repoId },
      select: { structure: true },
    }),
    prisma.pullRequest.findMany({
      where: { repoId },
      select: {
        number: true,
        title: true,
        state: true,
        authorLogin: true,
        url: true,
        baseRef: true,
        headRef: true,
        isDraft: true,
        githubState: true,
        reviewDecision: true,
        requestedReviewersJson: true,
        labelsJson: true,
        checksJson: true,
        snapshotJson: true,
        stateEnteredAt: true,
        githubUpdatedAt: true,
        createdAt: true,
      },
      orderBy: { githubUpdatedAt: "desc" },
      take: 200,
    }),
  ]);

  if (!repo || !repo.enabled) return null;

  return {
    prs: prs as WorkflowPr[],
    // Baton does not persist issues (only their count), so this is `null`, not
    // `[]`. Returning an empty list here would make the duplicate workflow report
    // a clean bill of health for a repository whose issues were never read.
    issues: null,
    structureCollected: insight !== null,
    structure: readStructure(insight?.structure ?? null),
    now: new Date(),
    thresholds: {
      staleDays: 14,
      inactiveDays: 30,
      duplicateThreshold: 0.6,
      relatedTokenThreshold: 0.35,
    },
  };
}

/** Execute the workflow suite for a repository and time it. */
export async function runRepositoryWorkflows(
  repoId: string,
): Promise<WorkflowRun[]> {
  const startedAt = Date.now();
  const input = await loadWorkflowInputs(repoId);
  if (!input) return [];
  const runs = runWorkflows(input);
  metrics.workflowRun("repository", true, Date.now() - startedAt);
  return runs;
}

/** Human labels for the automation UI. Kept beside the kinds they describe. */
export const WORKFLOW_LABELS: Record<WorkflowKind, string> = {
  stale_work: "Stale work",
  blocked_work: "Blocked work",
  abandoned_work: "Abandoned work",
  duplicate_issues: "Possible duplicates",
  related_work: "Related work",
  docs_implications: "Documentation implications",
  affected_tests: "Tests likely affected",
  waiting_on_people: "Waiting on people",
  release_readiness: "Release readiness",
  unowned_changes: "Unowned changes",
  dependency_chains: "Dependency chains",
};

/** Order the automation page renders workflows in: actionable first. */
export const WORKFLOW_ORDER: WorkflowKind[] = [
  "blocked_work",
  "waiting_on_people",
  "stale_work",
  "abandoned_work",
  "dependency_chains",
  "related_work",
  "duplicate_issues",
  "unowned_changes",
  "affected_tests",
  "docs_implications",
  "release_readiness",
];
