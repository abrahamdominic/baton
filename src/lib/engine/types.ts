export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export interface ReviewInfo {
  state: ReviewState;
  authorLogin: string;
  submittedAt: string | null;
  isBot: boolean;
}

export interface CheckRunInfo {
  name: string;
  status: string; // QUEUED | IN_PROGRESS | COMPLETED
  conclusion: string | null; // SUCCESS | FAILURE | CANCELLED | TIMED_OUT | NEUTRAL | SKIPPED | ...
  appSlug: string | null;
}

export interface SnapshotInput {
  prNumber: number;
  title: string;
  url: string;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  isDraft: boolean;
  githubState: "OPEN" | "CLOSED" | "MERGED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  createdAt: string;
  updatedAt: string;
  headPushedAt: string | null;
  labels: string[];
  reviews: ReviewInfo[];
  requestedReviewerLogins: string[];
  requestedTeamSlugs: string[];
  checks: CheckRunInfo[];
  now: Date;
}

export type BatonState =
  | "draft"
  | "awaiting_review"
  | "awaiting_review_after_fix"
  | "changes_required"
  | "ci_failing"
  | "blocked_on_checks"
  | "conflicts"
  | "ready_to_merge"
  | "merged"
  | "closed";

export type WhoseTurn =
  | "reviewers"
  | "author"
  | "maintainer_or_author"
  | "none";

export interface Classification {
  state: BatonState;
  /** Human-readable next action. */
  action: string;
  /** Short reason list explaining the classification. */
  reasons: string[];
  /** Who has to act to unblock this PR. */
  whoseTurn: WhoseTurn;
  /** Which states a nudge is possible for. */
  nudgable: boolean;
  /** Whether the PR has received any human response yet (for first-response nudges). */
  hasFirstResponse: boolean;
  /** Previously-stored state (for transition detection). Empty string when unknown. */
  prevState: string;
}

export interface StateMeta {
  key: BatonState;
  label: string;
  short: string;
  /** GitHub label applied when this state is active. Empty = no label. */
  labelName: string;
  tone: "neutral" | "info" | "warn" | "danger" | "success";
  ordering: number;
}

export const STATE_META: Record<BatonState, StateMeta> = {
  draft: {
    key: "draft",
    label: "Draft",
    short: "In draft — not ready for review",
    labelName: "",
    tone: "neutral",
    ordering: 0,
  },
  awaiting_review: {
    key: "awaiting_review",
    label: "Waiting for review",
    short: "No approval, no review requests answered yet",
    labelName: "baton:awaiting-review",
    tone: "info",
    ordering: 1,
  },
  awaiting_review_after_fix: {
    key: "awaiting_review_after_fix",
    label: "Fix pushed — waiting on re-review",
    short: "Author addressed feedback; reviewer hasn't come back",
    labelName: "baton:re-review",
    tone: "info",
    ordering: 2,
  },
  changes_required: {
    key: "changes_required",
    label: "Changes required",
    short: "A reviewer asked for changes; ball is on the author",
    labelName: "baton:changes-required",
    tone: "warn",
    ordering: 3,
  },
  ci_failing: {
    key: "ci_failing",
    label: "CI failing",
    short: "At least one check is failing",
    labelName: "baton:ci-failing",
    tone: "danger",
    ordering: 4,
  },
  blocked_on_checks: {
    key: "blocked_on_checks",
    label: "Checks pending",
    short: "Waiting on checks to finish",
    labelName: "",
    tone: "neutral",
    ordering: 5,
  },
  conflicts: {
    key: "conflicts",
    label: "Merge conflicts",
    short: "Branch conflicts with the base — needs a sync",
    labelName: "baton:conflicts",
    tone: "danger",
    ordering: 6,
  },
  ready_to_merge: {
    key: "ready_to_merge",
    label: "Ready to merge",
    short: "Approved, green, no conflicts — just needs the merge",
    labelName: "baton:ready-to-merge",
    tone: "success",
    ordering: 7,
  },
  merged: {
    key: "merged",
    label: "Merged",
    short: "Merged",
    labelName: "",
    tone: "success",
    ordering: 8,
  },
  closed: {
    key: "closed",
    label: "Closed",
    short: "Closed without merging",
    labelName: "",
    tone: "neutral",
    ordering: 9,
  },
};

export const ORDERED_STATES: BatonState[] = (
  Object.values(STATE_META) as StateMeta[]
)
  .sort((a, b) => a.ordering - b.ordering)
  .map((m) => m.key);

export const BATON_STATE_META = STATE_META;

/** All label names Baton may create/remove. */
export const BATON_LABELS = Object.values(STATE_META).map((m) => m.labelName).filter(Boolean);