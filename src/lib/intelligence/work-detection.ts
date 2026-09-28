import { prisma } from "../db";
import type { SessionUser } from "../auth/session";

/**
 * Work detection (aa.md §17).
 *
 * "Instead of relying entirely on manually created tasks, Baton should infer
 * work signals from GitHub activity ... Do not automatically convert everything
 * into tasks. Give developers control over confirmation."
 *
 * So this module never writes anything. It reads activity Baton has already
 * recorded and proposes *candidates*; the developer confirms one and only then
 * is a `WorkContext` created. The alternative — writing a task per detected
 * signal — is exactly what the requirement rules out, and it is also the
 * behaviour that makes a tool like this untrustworthy: nobody wants an inbox
 * they did not consent to.
 *
 * Every signal is a statement Baton can prove from a stored row. `confidence`
 * is honest about the strength of that proof: `high` means the row itself says
 * so, `medium` means Baton is inferring from an elapsed-time threshold, which is
 * a heuristic and is labelled as one.
 */

export type SignalConfidence = "high" | "medium";

export interface WorkSignal {
  id: string;
  kind: string;
  title: string;
  detail: string;
  href: string;
  confidence: SignalConfidence;
  ageDays: number;
  evidence: { kind: string; label: string; url: string | null }[];
  /** Serialised into `WorkContext.payload` when the developer confirms it. */
  payload: Record<string, unknown>;
}

interface PrRow {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  authorLogin: string;
  headRef: string;
  baseRef: string;
  reviewDecision: string | null;
  requestedReviewersJson: string;
  stateEnteredAt: Date;
  githubUpdatedAt: Date;
}

/** A pull request with no recorded activity for this long is worth surfacing. */
const STALL_DAYS = 7;
/** Drafts get a longer runway: they are unfinished work by design. */
const DRAFT_STALL_DAYS = 21;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function daysSince(d: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

export const LIVE_PR_STATES = [
  "awaiting_review",
  "awaiting_review_after_fix",
  "changes_required",
  "ci_failing",
  "conflicts",
  "approved",
  "draft",
  "approved_after_fix",
] as const;

/**
 * The same tenant rule `nextActionsFor` uses: a repository is visible when the
 * user owns the installation, or is a member of the owning organization or
 * team. Kept identical so the two surfaces cannot disagree about access.
 */
async function authorizedRepoId(user: SessionUser, repoId: string): Promise<{ owner: string; name: string } | null> {
  const repo = await prisma.repo.findFirst({
    where: {
      id: repoId,
      OR: [
        { installation: { userId: user.id } },
        { installation: { organizationLinks: { some: { organization: { members: { some: { userId: user.id } } } } } } },
        { installation: { teamLinks: { some: { team: { members: { some: { userId: user.id } } } } } } },
      ],
    },
    select: { id: true, owner: true, name: true },
  });
  return repo ? { owner: repo.owner, name: repo.name } : null;
}

/**
 * Pure classifier over pull-request rows.
 *
 * Split out from the database read so the rules that decide what a developer is
 * told can be tested exhaustively without a fixture, and so a test can assert
 * that a signal is *not* produced for a healthy pull request.
 */
export function classifyWorkSignals(
  prs: PrRow[],
  viewerLogin: string,
  repo: { owner: string; name: string },
  now: Date = new Date(),
): WorkSignal[] {
  const viewer = viewerLogin.toLowerCase();
  const signals: WorkSignal[] = [];
  const href = (n: number) => `/dashboard/repos/${repo.owner}/${repo.name}/pulls/${n}`;

  for (const pr of prs) {
    const isAuthor = pr.authorLogin.toLowerCase() === viewer;
    const reviewers = parseJson<unknown>(pr.requestedReviewersJson, []);
    const reviewerLogins = (Array.isArray(reviewers) ? reviewers : []).map((r) => String(r).toLowerCase());
    const awaitingViewer = reviewerLogins.includes(viewer);

    const stateAge = daysSince(pr.stateEnteredAt, now);
    const idleDays = daysSince(pr.githubUpdatedAt, now);
    const title = `#${pr.number} ${pr.title}`;
    const base = { prNumber: pr.number, branch: pr.headRef, baseRef: pr.baseRef, state: pr.state };

    // --- Work the developer is personally blocking -----------------------
    if (!isAuthor && awaitingViewer && (pr.state === "awaiting_review" || pr.state === "awaiting_review_after_fix")) {
      signals.push({
        id: `pr-${pr.number}-review`,
        kind: "review_requested",
        title: `You were asked to review ${title}`,
        detail: `Requested as a reviewer ${stateAge} day${stateAge === 1 ? "" : "s"} ago.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [
          { kind: "pr", label: `GitHub lists you as a requested reviewer on #${pr.number}`, url: pr.url },
        ],
        payload: { ...base, awaitingViewer: true },
      });
    }

    if (isAuthor && pr.state === "changes_required") {
      signals.push({
        id: `pr-${pr.number}-changes`,
        kind: "changes_requested",
        title: `${title} has changes requested`,
        detail: `You authored this and a reviewer asked for changes ${stateAge} day${stateAge === 1 ? "" : "s"} ago.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [
          {
            kind: "pr",
            label: pr.reviewDecision === "CHANGES_REQUESTED" ? "Review decision is CHANGES_REQUESTED" : "Baton classified this as changes requested",
            url: pr.url,
          },
        ],
        payload: { ...base },
      });
    }

    if (isAuthor && pr.state === "ci_failing") {
      signals.push({
        id: `pr-${pr.number}-ci`,
        kind: "ci_failing",
        title: `CI is failing on ${title}`,
        detail: `You authored this and its required checks have been failing for ${stateAge} day${stateAge === 1 ? "" : "s"}.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [{ kind: "pr", label: `Recorded check runs for #${pr.number} are failing`, url: pr.url }],
        payload: { ...base },
      });
    }

    if (isAuthor && pr.state === "conflicts") {
      signals.push({
        id: `pr-${pr.number}-conflicts`,
        kind: "conflicts",
        title: `${title} has merge conflicts`,
        detail: `You authored this and it has been conflicting with ${pr.baseRef} for ${stateAge} day${stateAge === 1 ? "" : "s"}.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [{ kind: "pr", label: `#${pr.number} conflicts with its base branch`, url: pr.url }],
        payload: { ...base },
      });
    }

    if (isAuthor && pr.reviewDecision === "APPROVED" && pr.state !== "ci_failing" && pr.state !== "conflicts") {
      signals.push({
        id: `pr-${pr.number}-approved`,
        kind: "approved_waiting",
        title: `${title} is approved but not merged`,
        detail: `You authored this, it is approved, and it is still open ${stateAge} day${stateAge === 1 ? "" : "s"} after approval.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [{ kind: "pr", label: `Review decision on #${pr.number} is APPROVED`, url: pr.url }],
        payload: { ...base },
      });
    }

    if (isAuthor && pr.state === "approved_after_fix") {
      // A PR that was approved and then received another push is no longer
      // approved -- it needs a fresh review before it can merge, but nothing
      // on GitHub asks for one. This is the state that gets forgotten, because
      // the green approval is still visible in the PR list.
      signals.push({
        id: `pr-${pr.number}-needs-rereview`,
        kind: "needs_rereview",
        title: `${title} was approved but has since been changed`,
        detail: `You authored this, it was approved, and a later push means the approval no longer covers the current diff. It has been open ${stateAge} day${stateAge === 1 ? "" : "s"}.`,
        href: href(pr.number),
        confidence: "high",
        ageDays: stateAge,
        evidence: [
          {
            kind: "pr",
            label: `Baton classified #${pr.number} as approved-then-changed, so the earlier approval no longer applies`,
            url: pr.url,
          },
        ],
        payload: { ...base },
      });
    }

    // --- Inactivity: explicitly an inference ------------------------------
    // Time alone does not prove abandonment, so these are `medium` confidence
    // and the copy says "no recorded activity" rather than "abandoned".
    const stallAfter = pr.isDraft ? DRAFT_STALL_DAYS : STALL_DAYS;
    if (isAuthor && idleDays >= stallAfter && !pr.isDraft) {
      signals.push({
        id: `pr-${pr.number}-stalled`,
        kind: "stalled_author",
        title: `${title} has been quiet for ${idleDays} days`,
        detail: `You authored this and GitHub has recorded no update since ${pr.githubUpdatedAt.toISOString().slice(0, 10)}.`,
        href: href(pr.number),
        confidence: "medium",
        ageDays: idleDays,
        evidence: [
          { kind: "pr", label: `Last GitHub update on #${pr.number} was ${idleDays} days ago`, url: pr.url },
        ],
        payload: { ...base, idleDays },
      });
    }

    if (isAuthor && pr.isDraft && idleDays >= DRAFT_STALL_DAYS) {
      signals.push({
        id: `pr-${pr.number}-draft-stalled`,
        kind: "draft_stalled",
        title: `Draft ${title} has been open ${idleDays} days`,
        detail: `Drafts are unfinished work by design, but this one has had no recorded activity for ${idleDays} days.`,
        href: href(pr.number),
        confidence: "medium",
        ageDays: idleDays,
        evidence: [
          { kind: "pr", label: `#${pr.number} is a draft, last updated ${idleDays} days ago`, url: pr.url },
        ],
        payload: { ...base, idleDays },
      });
    }
  }

  // Provenance of the signal (personal involvement vs. elapsed time) decides
  // the order, so the things a developer is directly blocking come first and
  // the time-based guesses never outrank a concrete request.
  const weight = (s: WorkSignal) =>
    s.confidence === "high" ? (s.kind === "review_requested" ? 0 : 1) : 2;

  return signals
    .sort((a, b) => weight(a) - weight(b) || b.ageDays - a.ageDays || a.id.localeCompare(b.id))
    .slice(0, 12);
}

/** Load and classify. Returns `[]` for a repository the user cannot see. */
export async function detectWorkSignals(user: SessionUser, repoId: string): Promise<WorkSignal[]> {
  const repo = await authorizedRepoId(user, repoId);
  if (!repo) return [];

  const [prs, login] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { repoId, githubState: "OPEN", state: { in: [...LIVE_PR_STATES] } },
      select: {
        number: true,
        title: true,
        url: true,
        state: true,
        isDraft: true,
        authorLogin: true,
        headRef: true,
        baseRef: true,
        reviewDecision: true,
        requestedReviewersJson: true,
        stateEnteredAt: true,
        githubUpdatedAt: true,
      },
      orderBy: { stateEnteredAt: "asc" },
      take: 100,
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { login: true } }),
  ]);

  return classifyWorkSignals(prs as PrRow[], login?.login ?? "", repo);
}

/**
 * Re-derive one signal by id and persist it as a `WorkContext`.
 *
 * The client sends only an id. The signal is recomputed server-side from the
 * database and the current time, so a stale or hand-crafted client payload
 * cannot invent a context pointing at a pull request the developer was never
 * involved in, and the saved label/details are always the ones Baton can prove.
 */
export async function confirmWorkSignalAsContext(
  user: SessionUser,
  repoId: string,
  signalId: string,
): Promise<{ ok: true; contextId: string } | { ok: false; error: string }> {
  const signals = await detectWorkSignals(user, repoId);
  const signal = signals.find((s) => s.id === signalId);
  if (!signal) return { ok: false, error: "That work signal is no longer current." };

  const ctx = await prisma.workContext.create({
    data: {
      userId: user.id,
      repoId,
      label: signal.title,
      kind: "pr",
      targetUrl: signal.href,
      payload: JSON.stringify({ ...signal.payload, signalKind: signal.kind, confidence: signal.confidence }),
    },
  });
  return { ok: true, contextId: ctx.id };
}
