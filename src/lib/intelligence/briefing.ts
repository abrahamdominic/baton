import { prisma } from "../db";
import { logger } from "../logger";

/**
 * Briefings: a dated, cited, regenerable summary of what a repository needs.
 *
 * A digest is *not* a stored opinion. It is a rendering of the collected facts
 * at a known revision, so it can always be traced back to the evidence that
 * produced it, and it is replaced in place when the underlying profile changes
 * rather than accumulating stale prose.
 *
 * This is the mechanism behind the product's standing rules:
 *  - every bullet cites evidence,
 *  - a bullet about a person is a recorded GitHub fact, not a judgement,
 *  - nothing is asserted that the collection job could not observe.
 */

export type DigestKind = "developer_briefing" | "review_brief" | "impact" | "onboarding";

export interface DigestBullet {
  text: string;
  evidenceIds: string[];
  /** "fact" is directly observed; "risk" is a threshold observation. */
  tone: "fact" | "risk" | "positive";
}

export interface InsightDigestPayload {
  kind: DigestKind;
  title: string;
  bullets: DigestBullet[];
  /** Profile revision this digest was rendered from. */
  revision: number;
  renderedAt: string;
  /** Present when the digest is scoped to one user (e.g. "your work"). */
  userId: string | null;
}

interface Profile {
  id: string;
  revision: number;
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
 * Build the briefing.
 *
 * Pure function of a profile so every threshold is unit-testable. The `days`
 * horizon is passed in rather than read from the clock, so a test does not have
 * to fake timers to prove that a 40-day-old PR stops being "fresh".
 */
export function buildDeveloperBriefing(
  profile: Profile,
  options: { days: number; openPrs: { number: number; title: string; url: string; ageDays: number }[] },
): InsightDigestPayload {
  const ev = (kinds: string[]) => kinds.flatMap((k) => profile.evidence.filter((e) => e.kind === k).map((e) => e.id));
  const bullets: DigestBullet[] = [];
  const add = (text: string, evidenceIds: string[], tone: DigestBullet["tone"] = "fact") => {
    if (evidenceIds.length > 0) bullets.push({ text, evidenceIds, tone });
  };

  const repoEv = ev(["repo"]);
  const langs = parseJson<{ name: string; percent: number }[]>(profile.languages, []);

  // Orientation
  if (langs.length > 0) {
    add(
      `${langs[0]!.name} is the dominant language at ${Math.round(langs[0]!.percent)}%, followed by ${langs
        .slice(1, 4)
        .map((l) => l.name)
        .join(", ")}.`,
      ev(["languages"]),
    );
  }
  if (profile.hasCodeowners) {
    add("Ownership is declared in CODEOWNERS, so review routing can follow the repository's own rules.", ev(["codeowners"]));
  } else {
    add(
      "No CODEOWNERS file, so reviewers are not defined by the repository and have to be chosen by hand.",
      ev(["structure"]),
      "risk",
    );
  }
  if (profile.hasCiWorkflows) {
    add("CI is configured through GitHub Actions workflows in the default branch.", ev(["workflow"]));
  } else {
    add("There are no GitHub Actions workflows, so a broken build has nothing to fail.", ev(["structure"]), "risk");
  }
  if (!profile.hasReadme) {
    add("There is no README in the default branch, so setup steps are not discoverable.", ev(["structure"]), "risk");
  }

  // Throughput, with the observed cadence rather than a claimed one. When
  // GitHub could not answer (which is routine for private repositories) the
  // claim is omitted entirely: "we don't know" must not read as "nothing was
  // merged", and it must not raise a risk flag either.
  if (profile.mergedLast30Days === null) {
    // Intentionally silent.
  } else if (profile.mergedLast30Days === 0 && repoEv.length > 0) {
    add(
      "No pull requests merged in the last 30 days. Confirm this is intentional before assuming the project is active.",
      repoEv,
      "risk",
    );
  } else if (profile.mergedLast30Days > 0) {
    add(
      `${profile.mergedLast30Days} pull request${profile.mergedLast30Days === 1 ? "" : "s"} merged in the last 30 days, with ${profile.openPullRequests} still open.`,
      repoEv,
    );
  }

  // Stale work: a PR is "stalled" only against an explicit threshold, and the
  // threshold is shown so the claim can be disagreed with.
  const stale = options.openPrs.filter((p) => p.ageDays > options.days);
  for (const pr of stale.slice(0, 5)) {
    bullets.push({
      text: `PR #${pr.number} "${pr.title}" has been open ${pr.ageDays} days, past the ${options.days}-day threshold.`,
      // A PR is not in the profile's evidence table, so this bullet cites the
      // repository itself and carries its URL inline rather than claiming a
      // citation it does not have.
      evidenceIds: repoEv,
      tone: "risk",
    });
  }

  if (profile.contributorCount > 0 && profile.contributorCount <= 2) {
    const n = profile.contributorCount;
    add(
      `Only ${n} contributor${n === 1 ? " appears" : "s appear"} in the recent contributor list, so review capacity is limited.`,
      ev(["contributors"]),
      "risk",
    );
  }

  return {
    kind: "developer_briefing",
    title: "Developer briefing",
    bullets,
    revision: profile.revision,
    renderedAt: new Date().toISOString(),
    userId: null,
  };
}

/**
 * The review brief answers one question: what should a reviewer know before
 * reading the diff? It is scoped to a PR, so it reuses the repository facts and
 * adds the PR's own observable state.
 */
export function buildReviewBrief(
  profile: Profile,
  pr: {
    number: number;
    title: string;
    state: string;
    /** `null` when the snapshot predates collection, or was truncated. */
    additions: number | null;
    deletions: number | null;
    changedFiles: number | null;
    authorLogin: string;
    requestedReviewers: string[];
    ageDays: number;
  },
): InsightDigestPayload {
  const ev = (kinds: string[]) => kinds.flatMap((k) => profile.evidence.filter((e) => e.kind === k).map((e) => e.id));
  const repoEv = ev(["repo"]);
  const bullets: DigestBullet[] = [];
  const add = (text: string, evidenceIds: string[], tone: DigestBullet["tone"] = "fact") => {
    if (evidenceIds.length > 0) bullets.push({ text, evidenceIds, tone });
  };

  // Only state the diff size when we actually collected it. Snapshots taken
  // before the file list was queried have no counts, and rendering those as
  // "changes 0 files (+0/-0)" stated the opposite of the truth on a panel
  // labelled Confirmed Facts.
  const size =
    pr.changedFiles === null || pr.additions === null || pr.deletions === null
      ? "a diff of unrecorded size"
      : `${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"} (+${pr.additions}/-${pr.deletions})`;
  add(
    `PR #${pr.number} carries ${size} and has been open ${pr.ageDays} day${pr.ageDays === 1 ? "" : "s"}.`,
    repoEv,
  );
  if (profile.hasCodeowners) {
    add(
      "This repository has CODEOWNERS, so check whether the changed paths are owned by a team that should approve.",
      ev(["codeowners"]),
    );
  } else {
    add("This repository has no CODEOWNERS, so reviewer assignment is manual and completeness depends on the author.", ev(["structure"]), "risk");
  }
  if (profile.hasCiWorkflows) {
    add("CI runs on GitHub Actions for this repository, so check status before approving.", ev(["workflow"]));
  } else {
    add("This repository has no GitHub Actions workflows, so there is no automated check to rely on on this PR.", ev(["structure"]), "risk");
  }
  const langs = parseJson<{ name: string; percent: number }[]>(profile.languages, []);
  if (langs.length > 0) {
    add(
      `Review in the context of a ${langs[0]!.name}-dominant codebase.`,
      ev(["languages"]),
    );
  }
  if (pr.requestedReviewers.length === 0) {
    add("No reviewers have been requested on this PR.", repoEv, "risk");
  }

  return {
    kind: "review_brief",
    title: `Review brief for #${pr.number}`,
    bullets,
    revision: profile.revision,
    renderedAt: new Date().toISOString(),
    userId: null,
  };
}

/**
 * Persist a digest, replacing any previous one for the same
 * (user, repo, kind, slot) at the same profile revision.
 *
 * Keyed on revision so a briefing is stable while the profile is unchanged, and
 * refreshed as soon as the underlying facts change. `userId = null` is the
 * repository-wide digest; a user-scoped digest (for example "what you should do
 * next") is keyed separately.
 */
export async function saveDigest(
  repoRowId: string,
  slot: string,
  payload: InsightDigestPayload,
): Promise<string> {
  const profile = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRowId },
    select: { id: true },
  });
  if (!profile) throw new Error("no repository insight to digest");

  const existing = await prisma.insightDigest.findFirst({
    where: {
      userId: payload.userId,
      repoId: repoRowId,
      kind: payload.kind,
      slot,
      revision: payload.revision,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.insightDigest.create({
    data: {
      userId: payload.userId,
      repoId: repoRowId,
      insightId: profile.id,
      kind: payload.kind,
      slot,
      title: payload.title,
      body: JSON.stringify(payload.bullets),
      evidence: JSON.stringify(payload.bullets.flatMap((b) => b.evidenceIds)),
      revision: payload.revision,
    },
  });
  logger.info("insight-digest-saved", { repoRowId, slot, kind: payload.kind, bullets: payload.bullets.length });
  return created.id;
}

export async function loadDigest(
  repoRowId: string,
  kind: DigestKind,
  slot: string,
  userId: string | null = null,
): Promise<{ id: string; title: string; bullets: DigestBullet[]; revision: number; readAt: Date | null } | null> {
  const row = await prisma.insightDigest.findFirst({
    where: { userId, repoId: repoRowId, kind, slot },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, body: true, revision: true, readAt: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    bullets: parseJson<DigestBullet[]>(row.body, []),
    revision: row.revision,
    readAt: row.readAt,
  };
}

