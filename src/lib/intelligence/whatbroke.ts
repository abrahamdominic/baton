import { prisma } from "../db";
import type { DigestBullet } from "./briefing";

/**
 * "What Broke?" — explain a failing pull request from recorded check data.
 *
 * This answers *which checks failed and what GitHub says about them*, nothing
 * more. It does not speculate about the cause of a failure from a test name,
 * because a test called `test_login_returns_401` does not tell you why it is
 * failing now when it passed on the base branch, and guessing would be worse
 * than silence for a developer deciding whether to merge.
 *
 * The raw annotations and output links GitHub already recorded are surfaced so
 * the developer goes straight to the log rather than through Baton.
 */

export interface CheckSummary {
  name: string;
  status: string;
  conclusion: string | null;
  appSlug: string | null;
  detailsUrl?: string | null;
  summary?: string | null;
}

/** Conclusions that mean the check passed or was not a failure. */
const NOT_FAILURES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", null]);

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Summarise a check run into a sentence a developer can act on.
 *
 * The log URL is the actionable part; a bare "tests failed" is not. When GitHub
 * recorded a `detailsUrl` we say so explicitly rather than leaving the
 * developer to go hunting for the run. When it did not, that absence is
 * reported as an absence instead of being papered over with invented detail.
 */
function describeFailure(check: CheckSummary): string {
  const parts = [`${check.name} reported ${(check.conclusion ?? "an unknown result").toLowerCase()}`];
  if (check.summary) parts.push(check.summary);
  parts.push(
    check.detailsUrl
      ? "the run log is linked from this view"
      : "GitHub recorded no log link for this run, so check the provider's own dashboard",
  );
  return `${parts.join(": ")}.`;
}

export interface WhatBrokeResult {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  hasProfile: boolean;
  bullets: DigestBullet[];
  failedChecks: CheckSummary[];
  pendingChecks: CheckSummary[];
  passedChecks: CheckSummary[];
}

/**
 * Build the "What Broke?" view for a pull request from persisted data only.
 *
 * Returns `null` when the pull request is not visible to the caller, so an
 * unauthorized read is indistinguishable from a missing one.
 *
 * This is the authorizing entry point. Callers that have already resolved and
 * authorized the repository must use `whatBrokeForRepo` instead, so the
 * visibility rule lives in exactly one place — a second, subtly different copy
 * of it is how a private repository ends up readable one route and 404 on
 * another.
 */
export async function whatBroke(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<WhatBrokeResult | null> {
  const repoRow = await prisma.repo.findFirst({
    where: {
      owner,
      name: repo,
      OR: [
        { installation: { userId } },
        { installation: { organizationLinks: { some: { organization: { members: { some: { userId } } } } } } },
        { installation: { teamLinks: { some: { team: { members: { some: { userId } } } } } } },
      ],
    },
    select: { id: true },
  });
  if (!repoRow) return null;
  return whatBrokeForRepo(repoRow.id, prNumber);
}

/**
 * Same as `whatBroke`, but for a repository the caller has *already*
 * authorized. Performs no visibility check of its own.
 */
export async function whatBrokeForRepo(
  repoId: string,
  prNumber: number,
): Promise<WhatBrokeResult | null> {
  const repoRow = await prisma.repo.findFirst({
    where: { id: repoId },
    select: {
      id: true,
      insight: {
        select: {
          id: true,
          revision: true,
          hasCiWorkflows: true,
          languages: true,
          structure: true,
          evidence: { select: { id: true }, where: { kind: { in: ["workflow", "languages", "structure"] } } },
        },
      },
    },
  });
  if (!repoRow) return null;

  const pr = await prisma.pullRequest.findFirst({
    where: { repoId: repoRow.id, number: prNumber },
    select: { number: true, title: true, url: true, checksJson: true, state: true },
  });
  if (!pr) return null;

  const checks = parseJson<CheckSummary[]>(pr.checksJson, []);
  const failed = checks.filter((c) => !NOT_FAILURES.has(c.conclusion ?? null) && c.status === "COMPLETED");
  const pending = checks.filter((c) => c.status !== "COMPLETED");
  const passed = checks.filter((c) => c.conclusion === "SUCCESS");

  const bullets: DigestBullet[] = [];
  const evIds = repoRow.insight?.evidence.map((e) => e.id) ?? [];

  if (checks.length === 0) {
    bullets.push({
      text:
        "No check runs are recorded for this pull request, so there is nothing to report. Either no CI is configured, or it has not been reported yet.",
      evidenceIds: evIds,
      tone: "risk",
    });
  } else {
    for (const c of failed) {
      bullets.push({ text: describeFailure(c), evidenceIds: evIds, tone: "risk" });
    }
    for (const c of pending) {
      bullets.push({
        text: `${c.name} is still ${c.status.toLowerCase().replace(/_/g, " ")}; it has not passed or failed yet.`,
        evidenceIds: evIds,
        tone: "fact",
      });
    }
    if (failed.length === 0 && pending.length === 0) {
      bullets.push({
        text: `All ${passed.length} recorded check${passed.length === 1 ? "" : "s"} passed.`,
        evidenceIds: evIds,
        tone: "positive",
      });
    }

    // Grouping by app is what makes a list actionable: one failing suite from
    // one provider is a different problem from three unrelated failures.
    const byApp = new Map<string, number>();
    for (const c of failed) {
      const key = c.appSlug ?? "unknown";
      byApp.set(key, (byApp.get(key) ?? 0) + 1);
    }
    for (const [app, n] of [...byApp.entries()].sort((a, b) => b[1] - a[1])) {
      bullets.push({
        text: `${n} failing check${n === 1 ? "" : "s"} from ${app === "unknown" ? "an unidentified provider" : app}.`,
        evidenceIds: evIds,
        tone: "fact",
      });
    }
  }

  // Context that changes how a failure should be read.
  if (repoRow.insight && !repoRow.insight.hasCiWorkflows) {
    bullets.push({
      text: "This repository has no GitHub Actions workflows in its default branch, so these checks come from an external service.",
      evidenceIds: evIds,
      tone: "fact",
    });
  }

  return {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    hasProfile: Boolean(repoRow.insight),
    bullets,
    failedChecks: failed,
    pendingChecks: pending,
    passedChecks: passed,
  };
}
