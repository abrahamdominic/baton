import type { Classification, SnapshotInput } from "./types";

const BOT_HINT = /bot|\[bot\]|github-actions|dependabot|renovate|coderabbit|qodo|copilot/i;

export function isBotLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  return BOT_HINT.test(login);
}

/**
 * Deterministic state machine for a single pull request.
 *
 * Outputs one of the Baton states and answers the two questions developers
 * actually ask: _what is this PR blocked on_ and _whose turn is it_?
 *
 * This is a pure function; unit-testable and safe to run on every webhook.
 */
export function classifyPullRequest(input: SnapshotInput, prevState = ""): Classification {
  const now = input.now.getTime();

  if (input.githubState === "MERGED") {
    return terminal("merged", "PR was merged.", prevState);
  }
  if (input.githubState === "CLOSED") {
    return terminal("closed", "PR was closed without merging.", prevState);
  }
  if (input.isDraft) {
    return {
      state: "draft",
      action: "No action needed as long as the PR is a draft.",
      reasons: ["PR is a draft."],
      whoseTurn: "author",
      nudgable: false,
      hasFirstResponse: true,
      prevState,
    };
  }

  const humanReviews = input.reviews
    .filter((r) => !r.isBot)
    .sort((a, b) => {
      const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return bt - at; // newest first
    });

  const approvals = humanReviews.filter((r) => r.state === "APPROVED");
  const changeRequests = humanReviews.filter((r) => r.state === "CHANGES_REQUESTED");
  const commentedReviews = humanReviews.filter((r) => r.state === "COMMENTED");

  const lastChangeRequest = changeRequests[0] ?? null;
  // Treated as "no response" until a human (non-bot) engages.
  const hasFirstResponse = humanReviews.length > 0;

  const lastPushAt = input.headPushedAt ? new Date(input.headPushedAt).getTime() : null;
  const lastChangeRequestAt = lastChangeRequest?.submittedAt
    ? new Date(lastChangeRequest.submittedAt).getTime()
    : null;
  const authorFixedAfterChanges =
    lastChangeRequestAt !== null &&
    lastPushAt !== null &&
    lastPushAt > lastChangeRequestAt;

  const failing = input.checks.filter(
    (c) => c.conclusion === "FAILURE" || c.conclusion === "CANCELLED" || c.conclusion === "TIMED_OUT" || c.conclusion === "STARTUP_FAILURE",
  );
  const pending = input.checks.filter(
    (c) => c.conclusion === null || c.status === "QUEUED" || c.status === "IN_PROGRESS",
  );
  const conflicting = input.mergeable === "CONFLICTING";
  const mergeable = input.mergeable === "MERGEABLE";

  const reasons: string[] = [];

  // ------------------------------------------------------------------
  // 1. Conflicts dominate everything.
  // ------------------------------------------------------------------
  if (conflicting) {
    reasons.push("Branch conflicts with the base branch.");
    return {
      state: "conflicts",
      action:
        "Merge the base branch into this PR (or rebase) and resolve the conflicts, then push.",
      reasons,
      whoseTurn: "author",
      nudgable: true,
      hasFirstResponse,
      prevState,
    };
  }

  // ------------------------------------------------------------------
  // 2. Failing CI blocks review and merge confidence.
  // ------------------------------------------------------------------
  if (failing.length > 0) {
    reasons.push(`${failing.length} check(s) failing: ${failing.map((c) => c.name).slice(0, 3).join(", ")}`);
    return {
      state: "ci_failing",
      action: "Open the failed check, fix the failure, and push new commits.",
      reasons,
      whoseTurn: "author",
      nudgable: true,
      hasFirstResponse,
      prevState,
    };
  }

  // ------------------------------------------------------------------
  // 3. Pending checks only matter once a review decision exists.
  // ------------------------------------------------------------------
  if (approvals.length > 0 && pending.length > 0) {
    reasons.push("Approved, waiting on checks to finish.");
    return {
      state: "blocked_on_checks",
      action: "Wait for the pending checks; re-review once they finish.",
      reasons,
      whoseTurn: "author",
      nudgable: false,
      hasFirstResponse,
      prevState,
    };
  }

  // ------------------------------------------------------------------
  // 4. Review feedback is being processed.
  // ------------------------------------------------------------------
  if (lastChangeRequest && input.reviewDecision !== "APPROVED") {
    if (!authorFixedAfterChanges) {
      reasons.push(
        lastChangeRequestAt !== null
          ? `Changes requested ${days(lastChangeRequestAt, now)} ago by ${lastChangeRequest.authorLogin}.`
          : "Changes requested by a reviewer.",
      );
      return {
        state: "changes_required",
        action: "Respond to the requested changes (or explain why they should be reconsidered) and push.",
        reasons,
        whoseTurn: "author",
        nudgable: true,
        hasFirstResponse,
        prevState,
      };
    }
    reasons.push(
      `Author pushed fixes after the "${lastChangeRequest.authorLogin}" change request. A re-review is needed.`,
    );
    return {
      state: "awaiting_review_after_fix",
      action: `Re-review the latest changes (or approve or request changes). The author has responded to your feedback.`,
      reasons,
      whoseTurn: "reviewers",
      nudgable: true,
      hasFirstResponse,
      prevState,
    };
  }

  // ------------------------------------------------------------------
  // 5. Approved (or commented). Is it mergeable?
  // ------------------------------------------------------------------
  if (approvals.length > 0 || commentedReviews.length > 0) {
    const hasApproval = approvals.length > 0;
    const allChecksDone = !pending.some(() => true) && !failing.some(() => true);
    if (hasApproval && allChecksDone && mergeable) {
      reasons.push(`${approvals.length} approval(s), checks green, no conflicts.`);
      return {
        state: "ready_to_merge",
        action: "Merge it while it's green and conflict-free.",
        reasons,
        whoseTurn: "maintainer_or_author",
        nudgable: true,
        hasFirstResponse,
        prevState,
      };
    }
    if (hasApproval && !allChecksDone) {
      reasons.push("Approved, but checks have not all completed successfully yet.");
      return {
        state: "blocked_on_checks",
        action: "Wait for checks to finish before merging.",
        reasons,
        whoseTurn: "author",
        nudgable: false,
        hasFirstResponse,
        prevState,
      };
    }
    if (hasApproval && !mergeable) {
      reasons.push("Approved but the mergeability is currently unknown to GitHub.");
      return {
        state: "blocked_on_checks",
        action: "Wait for GitHub to compute mergeability.",
        reasons,
        whoseTurn: "author",
        nudgable: false,
        hasFirstResponse,
        prevState,
      };
    }
  }

  // ------------------------------------------------------------------
  // 6. Default: waiting for review.
  // ------------------------------------------------------------------
  if (input.requestedReviewerLogins.length > 0) {
    reasons.push(
      `Review requested from ${input.requestedReviewerLogins
        .slice(0, 3)
        .join(", ")}${input.requestedReviewerLogins.length > 3 ? "…" : ""}, no decision yet.`,
    );
  } else if (input.requestedTeamSlugs.length > 0) {
    reasons.push(`Review requested from team(s) ${input.requestedTeamSlugs.slice(0, 3).join(", ")}.`);
  } else {
    reasons.push("No reviewers have been requested for this PR yet.");
  }

  return {
    state: "awaiting_review",
    action:
      input.requestedReviewerLogins.length > 0 || input.requestedTeamSlugs.length > 0
        ? "Review it (or let the author know who should)."
        : "Assign a reviewer. An unassigned PR rarely gets reviewed.",
    reasons,
    whoseTurn: "reviewers",
    nudgable: true,
    hasFirstResponse,
    prevState,
  };
}

function terminal(
  state: "merged" | "closed",
  action: string,
  prevState: string,
): Classification {
  return {
    state,
    action,
    reasons: [action],
    whoseTurn: "none",
    nudgable: false,
    hasFirstResponse: true,
    prevState,
  };
}

function days(a: number, b: number): string {
  const d = Math.max(0, Math.round((b - a) / 86_400_000));
  return d === 1 ? "1 day" : `${d} days`;
}