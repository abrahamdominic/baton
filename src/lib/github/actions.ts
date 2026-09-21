import type { Octokit } from "@octokit/rest";
import { config } from "../env-boot";
import { logger } from "../logger";
import type { BatonState } from "../engine/types";
import { BATON_LABELS, STATE_META } from "../engine/types";

export const STATUS_MARKER = "<!-- baton-status -->";
export const NUDGE_MARKER = "<!-- baton-nudge -->";

export interface CommentInfo {
  id: number;
  nodeId?: string;
  body: string;
}

async function listComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CommentInfo[]> {
  const out: CommentInfo[] = [];
  let page = 1;
  for (;;) {
    const res = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    });
    out.push(...res.data.map((c) => ({ id: c.id, nodeId: c.node_id, body: c.body ?? "" })));
    if (res.data.length < 100) break;
    page += 1;
  }
  return out;
}

/** Find a Baton-managed comment by its marker. */
export async function findBatonComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string,
): Promise<CommentInfo | null> {
  const comments = await listComments(octokit, owner, repo, prNumber);
  return comments.find((c) => c.body?.includes(marker)) ?? null;
}

export async function updateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await octokit.issues.updateComment({ owner, repo, comment_id: commentId, body });
}

export async function createComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<number> {
  const res = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return res.data.id;
}

/**
 * Keep a single live "status card" on the PR: create if missing, update in place
 * if it exists, and repair it if the comment was deleted by editing it again.
 */
export async function upsertStatusComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  knownCommentId: number | null,
): Promise<number> {
  try {
    if (knownCommentId) {
      await updateComment(octokit, owner, repo, knownCommentId, body);
      return knownCommentId;
    }
  } catch (e: any) {
    if (e?.status !== 404) throw e;
    // comment was removed; fall through and recreate
  }
  const existing = await findBatonComment(octokit, owner, repo, prNumber, STATUS_MARKER);
  if (existing) {
    try {
      await updateComment(octokit, owner, repo, existing.id, body);
      return existing.id;
    } catch {
      // race: fall through to create
    }
  }
  return createComment(octokit, owner, repo, prNumber, body);
}

const LABEL_COLORS: Record<string, string> = {
  "baton:awaiting-review": "1F6FEB",
  "baton:re-review": "8250DF",
  "baton:changes-required": "BF8700",
  "baton:ci-failing": "CF222E",
  "baton:conflicts": "CF222E",
  "baton:ready-to-merge": "1A7F37",
};

export async function ensureLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
): Promise<void> {
  try {
    await octokit.issues.createLabel({
      owner,
      repo,
      name,
      color: LABEL_COLORS[name] ?? "6E7781",
      description: `Auto-managed by Baton (${config.SITE_URL})`,
    });
  } catch (e: any) {
    if (e?.status !== 422) throw e; // label already exists
  }
}

/**
 * Apply exactly one Baton state label and remove any other Baton labels.
 * Idempotent and cheap to call on every state change.
 */
export async function syncStateLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  state: BatonState,
): Promise<void> {
  const meta = STATE_META[state];
  const desired = meta.labelName;

  const res = await octokit.issues.get({
    owner,
    repo,
    issue_number: prNumber,
  });
  const currentLabels: string[] = (res.data.labels ?? []).map((l) =>
    typeof l === "string" ? l : (l?.name ?? ""),
  );
  const batonLabelsNow = currentLabels.filter((l) => BATON_LABELS.includes(l));

  const toRemove = batonLabelsNow.filter((l) => l !== desired);
  if (toRemove.length > 0) {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: prNumber,
      name: toRemove.join(","),
    });
  }
  if (desired && !currentLabels.includes(desired)) {
    await ensureLabel(octokit, owner, repo, desired);
    await octokit.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [desired] });
  }
}

/** A permanent, non-spammy text one-liner used in archive/logs for the pr_snapshot action. */
export function summarizeState(state: BatonState): string {
  return STATE_META[state].label;
}

export function logGithubFailure(
  what: string,
  owner: string,
  repo: string,
  e: unknown,
  prNumber?: number,
) {
  const err = e as { status?: number; message?: string };
  logger.warn("github-api-failure", {
    what,
    owner,
    repo,
    pr_number: prNumber,
    status: err?.status,
    message: err?.message,
  });
}