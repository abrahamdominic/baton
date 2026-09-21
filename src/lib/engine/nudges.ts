import type { RepoSetting } from "@prisma/client";
import { config } from "../env-boot";
import type { BatonState, Classification, SnapshotInput } from "./types";
import { STATE_META } from "./types";

export const NUDGE_MARKER = "<!-- baton-nudge -->";

export interface NudgeBucket {
  key: string;
  firedAt: string;
}

export function parseNudgeBuckets(json: string): NudgeBucket[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

export function thresholdHoursFor(
  setting: RepoSetting,
  state: BatonState,
): number | null {
  switch (state) {
    case "awaiting_review":
      return setting.firstResponseHours;
    case "awaiting_review_after_fix":
      return setting.reviewFollowUpHours;
    case "changes_required":
      return setting.changesRequiredHours;
    case "ci_failing":
      return setting.ciFailHours;
    case "conflicts":
      return setting.conflictHours;
    case "ready_to_merge":
      return setting.readyToMergeHours;
    default:
      return null;
  }
}

export interface NudgeContext {
  setting: RepoSetting;
  classification: Classification;
  stateActiveHours: number;
  existingBuckets: NudgeBucket[];
  input: SnapshotInput;
}

export interface NudgeDecision {
  shouldNudge: boolean;
  bucketKey: string;
  countToDate: number;
  body: string | null;
}

/**
 * Decide whether Baton should post a targeted nudge comment now.
 *
 * Rules:
 *  - only nudgable states,
 *  - only when the state has outlived the configured threshold,
 *  - only up to `maxNudgesPerState` times per state,
 *  - never refire before the threshold has elapsed again,
 *  - the first-response nudge only fires when the PR has no human reply yet.
 */
export function decideNudge(ctx: NudgeContext): NudgeDecision {
  const { setting, classification, stateActiveHours, existingBuckets, input } = ctx;
  const state = classification.state;

  let shouldNudge = false;
  let body: string | null = null;

  if (setting.nudgesEnabled && classification.nudgable) {
    const threshold = thresholdHoursFor(setting, state);
    if (threshold !== null) {
      if (state === "awaiting_review" && classification.hasFirstResponse) {
        // only the first-response nudge applies to awaiting_review
        shouldNudge = false;
      } else {
        const bucketKey = `nudge:${state}`;
        const fired = existingBuckets.filter((b) => b.key === bucketKey);
        const count = fired.length;
        if (count < setting.maxNudgesPerState) {
          const lastFiredAt = fired.length
            ? Math.max(...fired.map((b) => new Date(b.firedAt).getTime()))
            : 0;
          const elapsedSinceLast = (Date.now() - lastFiredAt) / 3_600_000;
          if (stateActiveHours >= threshold && (lastFiredAt === 0 || elapsedSinceLast >= threshold)) {
            shouldNudge = true;
            body = nudgeBody(setting, state, classification, input);
          }
        }
      }
    }
  }

  const bucketKey = `nudge:${state}`;
  return {
    shouldNudge,
    bucketKey,
    countToDate: existingBuckets.filter((b) => b.key === bucketKey).length,
    body,
  };
}

function reviewerMention(login: string): string {
  return `@${login}`;
}

function nudgeBody(
  setting: RepoSetting,
  state: BatonState,
  classification: Classification,
  input: SnapshotInput,
): string {
  const meta = STATE_META[state];
  const humans = (logins: string[]) => logins.filter((l) => !/[bot]/i.test(l));

  let head: string;
  let mentions = "";
  let details = "";

  const repoPath = `${setting.repoId}`; // not used; kept for shape
  void repoPath;

  switch (state) {
    case "awaiting_review": {
      const targets = humans(input.requestedReviewerLogins);
      head = `This PR is still waiting for its **first review** (${classification.reasons[0] ?? "no decision yet"}).`;
      mentions =
        targets.length > 0
          ? `\n\nTurning it over to ${targets.slice(0, 3).map(reviewerMention).join(", ")} — the author replied to everything so far, so the fastest path is a decision: approve, request changes, or make clear it stays on hold.`
          : `\n\nIt has no assigned reviewers yet. Assigning someone (even a team) turns a silent queue item into an actual review.`;
      break;
    }
    case "awaiting_review_after_fix": {
      head = `The author pushed fixes in response to the requested changes, but the re-review hasn't happened yet.`;
      mentions = `\n\n@${(classification.reasons
        .find((r) => r.includes("author pushed fixes"))?.match(/the "(\S+)" change request/) ?? [])?.[1] ??
        ""}`;
      if (!mentions.includes("@") || mentions === "@") {
        const lastReviewer = humans(input.reviews.map((r) => r.authorLogin)).at(0);
        mentions = lastReviewer ? `\n\n@${lastReviewer}` : "";
      }
      details = `\n\nA quick re-review either closes the loop or keeps the author's work parked for another ${setting.reviewFollowUpHours}h cycle.`;
      break;
    }
    case "changes_required": {
      head = `Reviewer feedback is waiting on the author.`;
      mentions = `\n\n@${input.authorLogin} — this PR has requested changes that haven't been answered yet.`;
      details = `\n\nIf the feedback is wrong, a reply explaining why is still faster for everyone than silence.`;
      break;
    }
    case "ci_failing": {
      const failing = input.checks
        .filter((c) => ["FAILURE", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE"].includes(c.conclusion ?? ""))
        .slice(0, 4);
      head = `CI is failing on this PR.`;
      mentions = `\n\n@${input.authorLogin} — the failing check(s): ${failing.map((c) => `\`${c.name}\``).join(", ")}.`;
      details = `\n\nFailing CI blocks this from ever looking mergeable; a fix push restarts the whole pipeline.`;
      break;
    }
    case "conflicts": {
      head = `This PR has **merge conflicts** with \`${input.baseRef}\`.`;
      mentions = `\n\n@${input.authorLogin} — merge (or rebase) ${input.headRef} and resolve the conflicts.`;
      details = `\n\nConflicted PRs can't be reviewed or merged with confidence, and the drift only grows the longer it waits.`;
      break;
    }
    case "ready_to_merge": {
      head = `This PR is **approved, green, and conflict-free** — it's just not merged.`;
      mentions = `\n\n@${input.authorLogin} — it's been ${Math.max(1, Math.round(setting.readyToMergeHours / 24))} days of this.`;
      details = `\n\nAn approved PR that sits unmerged is a second review with a different name: whoever eventually merges it re-reads context that's already gone stale. Merge it or close it.`;
      break;
    }
    default:
      head = `Check in on this PR.`;
  }

  return [
    NUDGE_MARKER,
    `### ${meta.label}`,
    "",
    head,
    mentions,
    details,
    "",
    `<sub>Polite, time-boxed nudge from [Baton](${config.SITE_URL}) — it sends at most ${setting.maxNudgesPerState} reminder(s) per state. [Disable in repo settings](${config.SITE_URL}/dashboard).</sub>`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}