import type { RepoSetting } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { config } from "../env-boot";
import { installationClients, logRateLimit } from "../github/app";
import {
  createComment,
  syncStateLabel,
  upsertStatusComment,
} from "../github/actions";
import { ensureRepoRegistered } from "../github/install";
import { fetchPrSnapshot } from "../github/queries";
import { classifyPullRequest } from "./classification";
import { statusCommentBody } from "./message";
import { decideNudge, parseNudgeBuckets } from "./nudges";
import { applyOrgPolicyToSetting } from "./thresholds";
import { createNotification } from "../notifications";
import type { SnapshotInput } from "./types";

// AI review assistants that set "FAILURE" conclusions on their own checks and
// would otherwise mislead the CI-failing classification.
const REVIEW_TOOL_CHECK_SLUGS = new Set([
  "coderabbitai",
  "qodo-ai",
  "qodo",
  "pr-agent",
  "greptile",
  "bitsquad",
]);

function filterReviewToolChecks(input: SnapshotInput): SnapshotInput {
  return {
    ...input,
    checks: input.checks.filter((c) => !(c.appSlug && REVIEW_TOOL_CHECK_SLUGS.has(c.appSlug.toLowerCase()))),
  };
}

export interface RefreshOutcome {
  state: string;
  ignored: boolean;
  nudged: boolean;
  statusCommentId: number | null;
  actions: string[];
}

/**
 * Process one PR: fetch the live snapshot, run the state machine, persist the
 * snapshot, and perform GitHub-native actions (status card, label, nudge).
 */
export async function processPrRefresh(payload: {
  installationId: number;
  owner: string;
  repo: string;
  number: number;
}): Promise<RefreshOutcome> {
  const { installationId, owner, repo, number } = payload;
  const outcome: RefreshOutcome = {
    state: "unknown",
    ignored: false,
    nudged: false,
    statusCommentId: null,
    actions: [],
  };

  const resolved = await ensureRepoRegistered(installationId, owner, repo);
  if (!resolved) {
    outcome.ignored = true;
    return outcome;
  }
  const { repo: repoRow } = resolved;

  // Re-check disabled state after (re)registration.
  if (!repoRow.enabled) {
    outcome.ignored = true;
    return outcome;
  }

  const rawSetting: RepoSetting = await prisma.repoSetting.upsert({
    where: { repoId: repoRow.id },
    create: { repoId: repoRow.id },
    update: {},
  });

  // Organization-wide policies (Organization plan) supply default thresholds
  // for repos the owner hasn't individually customized. Best-effort: a missing
  // link just leaves the repo on its own setting.
  const appInstallation = await prisma.appInstallation
    .findFirst({
      where: { installationId: Number(installationId) },
      select: { id: true },
    })
    .catch(() => null);
  const orgLink = appInstallation
    ? await prisma.organizationInstallation
        .findUnique({
          where: { installationId: appInstallation.id },
          select: { organization: { select: { policy: true } } },
        })
        .catch(() => null)
    : null;
  const setting: RepoSetting = applyOrgPolicyToSetting(
    rawSetting,
    orgLink?.organization?.policy ?? null,
  );

  const existing = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId: repoRow.id, number } },
  });

  const now = new Date();
  const { gql } = await installationClients(installationId);
  const snapshot = await fetchPrSnapshot(gql, owner, repo, number, now);

  if (!snapshot) {
    // PR no longer exists; mark any stored record closed-ish and stop.
    if (existing) {
      await prisma.pullRequest.update({
        where: { id: existing.id },
        data: { githubState: "CLOSED", state: "closed", updatedAt: now },
      });
    }
    outcome.state = "unknown";
    outcome.ignored = true;
    return outcome;
  }

  logRateLimit(owner, repo, snapshot.rateLimitRemaining);

  const input = filterReviewToolChecks(snapshot.input);
  const prevState = existing?.state ?? "";
  const classification = classifyPullRequest(input, prevState);

  const sameState = existing && existing.state === classification.state;
  const stateEnteredAt = sameState && existing
    ? existing.stateEnteredAt
    : now;

  const activeHours =
    (now.getTime() - stateEnteredAt.getTime()) / 3_600_000;

  const requestedReviewerLogins = input.requestedReviewerLogins;

  const pr = await prisma.pullRequest.upsert({
    where: { repoId_number: { repoId: repoRow.id, number } },
    create: {
      repoId: repoRow.id,
      number,
      ghNodeId: String(snapshot.rawNodeId ?? ""),
      title: input.title,
      url: input.url,
      authorLogin: input.authorLogin,
      headRef: input.headRef,
      headSha: input.headSha,
      baseRef: input.baseRef,
      isDraft: input.isDraft,
      githubState: input.githubState,
      state: classification.state,
      mergeableState: input.mergeable,
      reviewDecision: input.reviewDecision,
      requestedReviewersJson: JSON.stringify(requestedReviewerLogins),
      labelsJson: JSON.stringify(input.labels),
      checksJson: JSON.stringify(input.checks),
      snapshotJson: JSON.stringify(snapshot.raw),
      stateEnteredAt,
      githubUpdatedAt: new Date(input.updatedAt),
      firstResponseAt: existing?.firstResponseAt ?? null,
      statusCommentId: existing?.statusCommentId ?? null,
      nudgeBucketsJson: existing?.nudgeBucketsJson ?? "[]",
    },
    update: {
      title: input.title,
      url: input.url,
      authorLogin: input.authorLogin,
      headRef: input.headRef,
      headSha: input.headSha,
      baseRef: input.baseRef,
      isDraft: input.isDraft,
      githubState: input.githubState,
      state: classification.state,
      mergeableState: input.mergeable,
      reviewDecision: input.reviewDecision,
      requestedReviewersJson: JSON.stringify(requestedReviewerLogins),
      labelsJson: JSON.stringify(input.labels),
      checksJson: JSON.stringify(input.checks),
      snapshotJson: JSON.stringify(snapshot.raw),
      stateEnteredAt,
      githubUpdatedAt: new Date(input.updatedAt),
    },
  });

  const { rest } = await installationClients(installationId);
  const knownCommentId = pr.statusCommentId ? Number(pr.statusCommentId) : null;
  let statusCommentId = knownCommentId;

  // ------------------------------------------------------------------
  // GitHub-native surfacing (only when the repo opts in).
  // ------------------------------------------------------------------
  if (setting.statusCommentEnabled) {
    const actorLabels = actorList(classification, input, owner);
    const body = statusCommentBody({
      prUrl: input.url,
      repoBoardUrl: `${config.SITE_URL}/dashboard/repos/${owner}/${repo}`,
      owner,
      repo,
      number,
      classification,
      stateDurationLabel: durationLabel(activeHours),
      actorLabels,
    });
    try {
      statusCommentId = await upsertStatusComment(
        rest,
        owner,
        repo,
        number,
        body,
        statusCommentId,
      );
      outcome.actions.push("status_comment");
    } catch (e) {
      logger.warn("status-comment-failed", { owner, repo, number, error: String(e) });
    }
  }

  if (setting.labelsEnabled && (classification.state !== "draft")) {
    try {
      await syncStateLabel(rest, owner, repo, number, classification.state);
      outcome.actions.push("label");
    } catch (e) {
      logger.warn("label-sync-failed", { owner, repo, number, error: String(e) });
    }
  }

  // ------------------------------------------------------------------
  // Targeted nudges (once per threshold, max N per state).
  // ------------------------------------------------------------------
  const buckets = parseNudgeBuckets(pr.nudgeBucketsJson);
  const nudge = decideNudge({
    setting,
    classification,
    stateActiveHours: activeHours,
    existingBuckets: buckets,
    input,
  });
  if (nudge.shouldNudge && nudge.body) {
    try {
      const commentId = await createComment(rest, owner, repo, number, nudge.body);
      outcome.nudged = true;
      outcome.actions.push("nudge");
      await prisma.action.create({
        data: {
          repoId: repoRow.id,
          prId: pr.id,
          type: "nudge",
          targetJson: JSON.stringify({ state: classification.state }),
          ghReference: String(commentId),
        },
      });
      // Only a delivered comment may consume quota. Recording the bucket after a
      // failed send (permissions, locked repo, rate limit) permanently burned one
      // of maxNudgesPerState, so a single transient error meant the PR was never
      // nudged at all.
      const updatedBuckets = [
        ...buckets.filter((b) => b.key !== nudge.bucketKey),
        { key: nudge.bucketKey, firedAt: new Date().toISOString() },
      ];
      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: { nudgeBucketsJson: JSON.stringify(updatedBuckets) },
      });
      await notifyNudgeMentionedUsers({
        body: nudge.body,
        owner,
        repo,
        number,
        prId: pr.id,
      });
    } catch (e) {
      logger.warn("nudge-failed", { owner, repo, number, error: String(e) });
    }
  }

  if (statusCommentId && statusCommentId !== knownCommentId) {
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { statusCommentId: BigInt(statusCommentId) },
    });
  }

  await prisma.action.create({
    data: {
      repoId: repoRow.id,
      prId: pr.id,
      type: "pr_snapshot",
      targetJson: JSON.stringify({
        state: classification.state,
        prevState,
        reasons: classification.reasons,
      }),
    },
  });

  if (classification.state === "merged" || classification.state === "closed") {
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { nudgeBucketsJson: "[]" },
    });
  }

  outcome.state = classification.state;
  return outcome;
}

/**
 * Angular-bracket-free `@login` mentions in a delivered nudge body, i.e. the
 * exact human reviewers/author the comment turned the PR over to. Parsing the
 * delivered body (instead of re-deriving the decision) guarantees the inbox
 * notifies the same people the GitHub comment actually mentions.
 */
function nudgeMentionLogins(body: string): string[] {
  const logins = new Set<string>();
  const re = /(?:^|\s)@([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const login = m[1];
    if (login && login.toLowerCase() !== "baton") logins.add(login);
  }
  return [...logins];
}

async function notifyNudgeMentionedUsers(input: {
  body: string;
  owner: string;
  repo: string;
  number: number;
  prId: string;
}): Promise<void> {
  const logins = nudgeMentionLogins(input.body);
  if (logins.length === 0) return;
  const recipients = await prisma.user.findMany({
    where: { login: { in: logins } },
    select: { id: true },
  });
  for (const r of recipients) {
    // one notification per (user, review, pr); re-arms when already read.
    await createNotification(prisma, {
      userId: r.id,
      actorId: null,
      type: "review",
      resourceType: "pr",
      resourceId: input.prId,
      contextJson: {
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        prId: input.prId,
      },
    });
  }
}

/** Process an installation registration job. */
export async function processInstallRegister(installationId: number): Promise<{
  repos: number;
}> {
  const { registerInstallation } = await import("../github/install");
  const result = await registerInstallation(installationId);
  // A newly registered installation has no intelligence, so queue a collection
  // for each repository it brought in. A failure here must not fail the
  // registration job: the repositories are already recorded, and the scheduled
  // sweep would collect them anyway.
  try {
    await scheduleIntelForInstallation(installationId);
  } catch (e) {
    logger.error("repo-intel-schedule-after-register-failed", { installationId, error: String(e) });
  }
  return { repos: result.repositories.length };
}

/**
 * Queue intelligence collection for every enabled repository of an
 * installation, most-stale first.
 *
 * Used after a new installation is registered and by the scheduled sweep. A
 * per-installation cap bounds the work a single sweep can enqueue, so a large
 * org cannot flood the queue ahead of real-time PR work.
 */
export async function scheduleIntelForInstallation(
  installationId: number,
  options: { limit?: number } = {},
): Promise<number> {
  const limit = Math.min(options.limit ?? 40, 200);
  const { enqueueRepoIntel } = await import("./jobs");

  const repos = await prisma.repo.findMany({
    where: { enabled: true, installation: { installationId } },
    select: {
      owner: true,
      name: true,
      insight: { select: { collectedAt: true } },
    },
    // Repositories with no profile come first, then the least recently
    // collected, so a sweep always attacks the stalest intelligence.
    orderBy: { insight: { collectedAt: "asc" } },
    take: limit,
  });

  let queued = 0;
  for (const r of repos) {
    try {
      await enqueueRepoIntel(installationId, r.owner, r.name);
      queued += 1;
    } catch (e) {
      // One unreachable repository must not abandon the rest of the sweep; the
      // enqueue itself is awaited so a durable write failure is visible here
      // rather than vanishing into an unhandled rejection.
      logger.error("repo-intel-enqueue-failed", {
        installationId,
        owner: r.owner,
        repo: r.name,
        error: String(e),
      });
    }
  }
  logger.info("repo-intel-scheduled", { installationId, queued, considered: repos.length });
  return queued;
}

/**
 * Process a repository-intelligence collection job.
 *
 * The repository is resolved by `owner/name` under the given installation and
 * the existing `Repo` row is required: intelligence is attached to a repository
 * Baton already tracks, so a job for an unknown repository is a no-op rather
 * than something that creates rows from a job payload.
 *
 * Failures propagate so the queue's retry and backoff apply. Collecting the same
 * repository twice is safe, because persistence is an upsert keyed on `repoId`.
 */
export async function processRepoIntel(input: {
  installationId: number;
  owner: string;
  repo: string;
}): Promise<{ insightId: string; changed: boolean } | null> {
  const { collectRepositoryIntelligence, saveRepositoryIntelligence } = await import(
    "../intelligence/collect"
  );

  const row = await prisma.repo.findFirst({
    where: {
      owner: input.owner,
      name: input.repo,
      installation: { installationId: input.installationId },
    },
    select: { id: true, enabled: true },
  });
  if (!row) {
    logger.info("repo-intel-skipped-unknown-repo", {
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
    });
    return null;
  }
  if (!row.enabled) {
    logger.info("repo-intel-skipped-disabled-repo", { repoRowId: row.id });
    return null;
  }

  const collected = await collectRepositoryIntelligence(input.installationId, input.owner, input.repo);
  return saveRepositoryIntelligence(row.id, collected);
}

function actorList(
  classification: { whoseTurn: string },
  input: SnapshotInput,
  owner: string,
): string[] {
  switch (classification.whoseTurn) {
    case "reviewers":
      return [
        ...input.requestedReviewerLogins
          .filter((l) => !/[bot]/i.test(l))
          .slice(0, 4)
          .map((l) => `@${l}`),
        ...input.requestedTeamSlugs.slice(0, 2).map((t) => `@${owner}/${t}`),
      ].filter(Boolean);
    case "author":
    case "maintainer_or_author":
      return [`@${input.authorLogin}`];
    default:
      return [];
  }
}

function durationLabel(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.max(0, Math.round(hours))}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return days === 1 ? `1 day${rem ? ` ${rem}h` : ""}` : `${days} days${rem ? ` ${rem}h` : ""}`;
}