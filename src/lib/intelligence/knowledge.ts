import { createHash } from "node:crypto";
import { prisma } from "../db";
import { logger } from "../logger";
import type { RepositoryProfile } from "./profile";

/**
 * Repository knowledge memory (skill.md §15).
 *
 * The intelligence snapshot answers "what is true right now". This answers the
 * question that snapshot structurally cannot: *why is it like this, and was it
 * ever different?*
 *
 * Three rules keep it from becoming the wiki product the spec warns against:
 *
 *  1. **Everything is derived from collected evidence.** `deriveKnowledge` is a
 *     pure function of the profile, the tree, and the evidence ids already
 *     recorded. There is no prose generator and no language model, so a claim
 *     can always be opened and checked at its cited path.
 *  2. **Claims are identified by their content, not by when they were seen.**
 *     Re-observing the same hot directory updates one row and increments
 *     `observations`; it never appends a near-duplicate. That is what makes the
 *     table safe to recompute on every scheduled sweep.
 *  3. **Retirement is delayed.** A claim that stops appearing is marked
 *     `missingSince` first and only retired once it has been absent for
 *     `RETIRE_AFTER_DAYS`. One failed GitHub call must not erase what was
 *     learned, and an intermittent 500 is the normal case, not the exception.
 *
 * Human-recorded decisions share the table via `source = "recorded"` and are
 * exempt from the retirement rule: a maintainer writing down "we keep sessions
 * stateless because of the OAuth app limitation" should not lose that because a
 * file was renamed.
 */

export type KnowledgeKind =
  | "architecture"
  | "workflow"
  | "module"
  | "ownership"
  | "deployment"
  | "failure_pattern"
  | "documentation"
  | "hot_area"
  | "decision";

export type KnowledgeSource = "observed" | "inferred" | "recorded";

export interface KnowledgeEntry {
  kind: KnowledgeKind;
  /** Content-derived identity. Two observations of the same claim share it. */
  stableKey: string;
  title: string;
  detail: string;
  source: KnowledgeSource;
  /** `RepoEvidence` ids backing the claim. Empty only for `recorded`. */
  evidenceIds: string[];
  path?: string | null;
  /** 0-100 confidence that this claim still holds. */
  strength: number;
}

export interface KnowledgeFact {
  id: string;
  kind: KnowledgeKind;
  stableKey: string;
  title: string;
  detail: string;
  source: KnowledgeSource;
  evidenceIds: string[];
  path: string | null;
  strength: number;
  observations: number;
  revision: number;
  status: "active" | "retired";
  lastChangedAt: Date;
  lastSeenAt: Date;
  missingSince: Date | null;
  createdAt: Date;
}

export interface KnowledgeInput {
  profile: RepositoryProfile;
  /** Evidence ids currently recorded for this repository, by kind. */
  evidenceByKind: Map<string, string[]>;
  codeowners: string | null;
  defaultBranch: string | null;
  // Insight-level facts that are not part of the tree profile.
  hasReadme: boolean;
  hasCiWorkflows: boolean;
  /** From the insight row; used for release and cadence knowledge. */
  lastReleaseTag: string | null;
  lastReleaseAt: Date | null;
  mergedLast30Days: number | null;
  openPullRequests: number;
  /** Recent failure states observed on this repository's pull requests. */
  ciFailureCount: number;
  ciFailureRate: number | null;
  /** Injectable clock so churn strengths are deterministic under test. */
  now?: Date;
}

/**
 * How long a derived claim may go unobserved before it is retired.
 *
 * Two collection cycles of slack. Long enough that a transient GitHub failure
 * cannot silently drop knowledge; short enough that a genuinely deleted
 * directory does not haunt the repository forever.
 */
export const RETIRE_AFTER_DAYS = 14;

/** Stable, content-addressed identity for a claim. */
function stableKeyFor(kind: KnowledgeKind, subject: string): string {
  const hash = createHash("sha256").update(`${kind}\0${subject}`).digest("hex").slice(0, 16);
  return `${kind}:${hash}`;
}

function pickEvidence(input: KnowledgeInput, kinds: string[]): string[] {
  const out: string[] = [];
  for (const k of kinds) out.push(...(input.evidenceByKind.get(k) ?? []));
  return Array.from(new Set(out)).slice(0, 6);
}

/**
 * Derive every claim the current evidence supports.
 *
 * Pure: the only inputs are the profile and the recorded evidence ids, so the
 * whole derivation is unit-testable without a database or a network call.
 *
 * A claim is emitted only when its supporting evidence exists. That is the same
 * discipline `briefing.ts` and `answer.ts` use, and for the same reason: a
 * memory entry with no citation is a rumour.
 */
export function deriveKnowledge(input: KnowledgeInput): KnowledgeEntry[] {
  const { profile } = input;
  const entries: KnowledgeEntry[] = [];

  const push = (e: Omit<KnowledgeEntry, "stableKey"> & { subject?: string }) => {
    if (e.evidenceIds.length === 0 && e.source !== "recorded") return;
    const { subject, ...rest } = e;
    entries.push({ ...rest, stableKey: stableKeyFor(e.kind, subject ?? e.title) });
  };

  // --- Architecture -------------------------------------------------------
  if (profile.hasTypeScript) {
    push({
      kind: "architecture",
      subject: "typescript",
      title: "Type-checked TypeScript codebase",
      detail: `Type checking runs through ${profile.typeConfig ?? "tsconfig.json"}, so a type error fails the build rather than surfacing at runtime.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      path: profile.typeConfig ?? "tsconfig.json",
      strength: 80,
    });
  }
  if (profile.orm) {
    push({
      kind: "architecture",
      subject: `orm:${profile.orm}`,
      title: `Database access through ${profile.orm}`,
      detail: profile.hasMigrations
        ? "Schema changes are versioned as migrations, so the shape of the database is reviewable in the pull request that changes it."
        : "Schema is defined in code but no migration directory was found, so schema changes are not reviewable in isolation.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 85,
    });
  }
  if (profile.frameworks.length > 0) {
    push({
      kind: "architecture",
      subject: `frameworks:${profile.frameworks.join(",")}`,
      title: `Built on ${profile.frameworks.join(", ")}`,
      detail: `Declared in the project manifest. Changes to these libraries have the widest blast radius in the repository.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      path: "package.json",
      strength: 70,
    });
  }
  if (profile.apiStyle) {
    push({
      kind: "architecture",
      subject: `api:${profile.apiStyle}`,
      title: `HTTP surface: ${profile.apiStyle}`,
      detail: "API entry points are the highest-fan-out surface in the codebase; changing one is a cross-module edit.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 65,
    });
  }
  if (profile.packageManager) {
    push({
      kind: "architecture",
      subject: `pkgmgr:${profile.packageManager}`,
      title: `${profile.packageManager} manages dependencies`,
      detail: `Installs, lockfiles and CI caches all assume ${profile.packageManager}. Mixing package managers produces lockfiles that disagree with each other.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 75,
    });
  }

  // --- Workflows ----------------------------------------------------------
  if (profile.testFramework) {
    push({
      kind: "workflow",
      subject: `test:${profile.testFramework}`,
      title: `Tests run with ${profile.testFramework}`,
      detail: `Test commands are defined by the repository, not by CI, so they run identically locally and in ${input.hasCiWorkflows ? "GitHub Actions" : "whatever pipeline the team runs"}.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile", "workflow"]),
      strength: 80,
    });
  } else if (profile.testFileCount > 0) {
    push({
      kind: "failure_pattern",
      subject: "tests-without-runner",
      title: "Test files exist but no test runner is configured",
      detail: `${profile.testFileCount} test file${profile.testFileCount === 1 ? "" : "s"} were found without a configured runner in the repository root, so a change can break tests without anything reporting it.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 90,
    });
  }
  if (profile.lintTool) {
    push({
      kind: "workflow",
      subject: `lint:${profile.lintTool}`,
      title: `Linting enforced with ${profile.lintTool}`,
      detail: "Style and correctness rules are mechanical, so a lint failure needs no judgement call.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 70,
    });
  }
  if (input.hasCiWorkflows) {
    push({
      kind: "workflow",
      subject: "ci:github-actions",
      title: "CI runs on GitHub Actions",
      detail: "The gate that decides whether a pull request can merge. It is the first thing to check when a build is red, and the last thing to trust blindly.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["workflow"]),
      strength: 85,
    });
  }
  if (profile.hasMigrations) {
    push({
      kind: "workflow",
      subject: "migrations",
      title: "Schema changes ship as migrations",
      detail: "A change to a database model is a reviewable artifact, so it can be diffed and reverted independently of application code.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 75,
    });
  }

  // --- Deployment ---------------------------------------------------------
  if (profile.deploymentTargets.length > 0) {
    push({
      kind: "deployment",
      subject: `deploy:${profile.deploymentTargets.join(",")}`,
      title: `Deployed to ${profile.deploymentTargets.join(", ")}`,
      detail: "Deployment is defined in the repository, so a release is reproducible from the default branch rather than from a remembered sequence of steps.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 80,
    });
  }
  if (profile.hasDocker) {
    push({
      kind: "deployment",
      subject: "container",
      title: "Ships as a container image",
      detail: "The build is defined by a Dockerfile, so local and production environments converge on the same artifact.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      path: "Dockerfile",
      strength: 70,
    });
  }
  if (profile.hasEnvExample) {
    push({
      kind: "deployment",
      subject: "env-example",
      title: "Environment contract is published",
      detail: "An example environment file exists, so required configuration is discoverable without reading the source.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 60,
    });
  }

  // --- Documentation ------------------------------------------------------
  if (profile.hasDocsDir) {
    push({
      kind: "documentation",
      subject: "docs-dir",
      title: "Documentation lives in docs/",
      detail: "Behaviour changes are expected to land here alongside the code.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      path: "docs",
      strength: 65,
    });
  }
  if (input.hasReadme) {
    push({
      kind: "documentation",
      subject: "readme",
      title: "README is the documented entry point",
      detail: "Setup instructions in the default branch are the source of truth for a new contributor.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["readme"]),
      path: "README.md",
      strength: 55,
    });
  } else {
    push({
      kind: "failure_pattern",
      subject: "no-readme",
      title: "No README in the default branch",
      detail: "There is no documented way to run this project, so every new contributor has to be walked through setup by hand.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["structure"]),
      strength: 80,
    });
  }

  // --- Ownership ----------------------------------------------------------
  if (input.codeowners) {
    push({
      kind: "ownership",
      subject: "codeowners",
      title: "Ownership declared in CODEOWNERS",
      detail: "Review routing follows the repository's own rules, so an unreviewed change is a process failure rather than an oversight.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["codeowners"]),
      path: "CODEOWNERS",
      strength: 80,
    });
  }

  // --- Hot areas (highest change frequency) --------------------------------
  // Scaled by sample size: "hot" in a 200-commit sample is a different claim
  // from "hot" in 3 commits, and reporting them the same would be dishonest.
  // Share alone cannot carry that weight, because share is *highest* in a tiny
  // sample -- two of three commits is a 67% share, which is not a hot area at
  // all. So the raw share sets the ceiling and the sample size discounts it,
  // with a floor that keeps a small-sample observation visible but clearly
  // weaker than a large-sample one.
  const sample = Math.max(1, profile.commitSampleSize);
  const sampleConfidence = 0.4 + 0.6 * Math.min(1, sample / 100);
  const MIN_HOT_SHARE = 0.05;
  const discounted = (share: number, ceiling: number) =>
    Math.min(ceiling, Math.round(share * ceiling * sampleConfidence));

  for (const area of profile.highChurnAreas.slice(0, 5)) {
    const share = area.commits / sample;
    if (share < MIN_HOT_SHARE) continue;
    push({
      kind: "hot_area",
      subject: `churn:${area.area}`,
      title: `${area.area} is the most-changed area`,
      detail: `Changed in ${area.commits} of ${profile.commitSampleSize} sampled commits. Conflicts and regressions concentrate here, so a change touching ${area.area} deserves a wider review than its diff size suggests.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["churn"]),
      path: area.area === "(root)" ? null : area.area,
      strength: discounted(share, 95),
    });
  }
  for (const f of profile.frequentlyModifiedFiles.slice(0, 3)) {
    // Same floor as directories: a file touched once in 100 commits is not a
    // hot spot, it is a file that happened to be in the sample.
    const share = f.commits / sample;
    if (share < MIN_HOT_SHARE) continue;
    const lastTouched = Date.parse(f.lastTouchedAt);
    const daysSince = Number.isFinite(lastTouched)
      ? Math.max(0, Math.floor(((input.now ?? new Date()).getTime() - lastTouched) / 86_400_000))
      : null;
    push({
      kind: "hot_area",
      subject: `file:${f.path}`,
      title: `${f.path} changes constantly`,
      detail:
        `Modified in ${f.commits} sampled commit${f.commits === 1 ? "" : "s"}` +
        (daysSince === null
          ? "."
          : `, most recently ${daysSince === 1 ? "1 day" : `${daysSince} days`} ago.`) +
        " Treat edits here as high-risk even when the diff is small.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["churn"]),
      path: f.path,
      strength: discounted(share, 90),
    });
  }

  // --- Recurring failure patterns -----------------------------------------
  if (input.ciFailureCount >= 3) {
    const rate =
      input.ciFailureRate === null
        ? ""
        : ` (${Math.round(input.ciFailureRate * 100)}% of recent pull requests)`;
    push({
      kind: "failure_pattern",
      subject: "ci-failing",
      title: "CI failures recur on this repository",
      detail: `${input.ciFailureCount} pull requests have failed checks${rate}. When a new failure appears here, check whether it matches the existing pattern before assuming a new cause.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["workflow", "check"]),
      strength: 80,
    });
  }
  if (input.mergedLast30Days === 0 && input.openPullRequests > 0) {
    push({
      kind: "failure_pattern",
      subject: "no-merges",
      title: "Open work with no recent merges",
      detail: `${input.openPullRequests} pull request${input.openPullRequests === 1 ? " is" : "s are"} open and nothing merged in the last 30 days. The bottleneck is review capacity or CI, not contribution.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["repo"]),
      strength: 85,
    });
  }
  if (profile.securityTooling.length > 0) {
    push({
      kind: "failure_pattern",
      subject: `security:${profile.securityTooling.join(",")}`,
      title: `Dependency security managed with ${profile.securityTooling.join(", ")}`,
      detail: "Known-vulnerable dependency updates arrive as automated pull requests, so they are a recurring maintenance event rather than an incident.",
      source: "observed",
      evidenceIds: pickEvidence(input, ["profile"]),
      strength: 70,
    });
  }

  // --- Release cadence ----------------------------------------------------
  if (input.lastReleaseTag && input.lastReleaseAt) {
    push({
      kind: "workflow",
      subject: `release:${input.lastReleaseTag}`,
      title: `Latest release is ${input.lastReleaseTag}`,
      detail: `Published ${input.lastReleaseAt.toISOString().slice(0, 10)} on ${input.defaultBranch ?? "the default branch"}.`,
      source: "observed",
      evidenceIds: pickEvidence(input, ["release"]),
      strength: 60,
    });
  }

  // De-duplicate on the derived key. Two rules can legitimately produce the same
  // title (for example a project with both a Dockerfile and a deployment config
  // declaring a target), and storing both would make the same fact look like two.
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.stableKey) ? false : (seen.add(e.stableKey), true)));
}

/**
 * Reconcile derived knowledge with what is stored.
 *
 * Observed claims are upserted by `stableKey`. Claims that were not re-derived
 * get `missingSince` stamped, and are retired once that has been set for longer
 * than `RETIRE_AFTER_DAYS`. Recorded claims are never touched here: they are not
 * recomputed, so they cannot be "missing" from a derivation that never produced
 * them.
 *
 * Runs in a transaction so a concurrent reader never sees a half-applied
 * reconciliation.
 */
export async function syncKnowledge(
  insightId: string,
  repoId: string,
  revision: number,
  entries: KnowledgeEntry[],
): Promise<{ inserted: number; updated: number; retired: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - RETIRE_AFTER_DAYS * 86_400_000);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.repoKnowledge.findMany({
      where: { repoId, source: { not: "recorded" } },
      select: {
        id: true,
        stableKey: true,
        title: true,
        detail: true,
        status: true,
        missingSince: true,
      },
    });
    const byKey = new Map(existing.map((r) => [r.stableKey, r]));

    let inserted = 0;
    let updated = 0;
    const seenKeys = new Set<string>();

    for (const entry of entries) {
      seenKeys.add(entry.stableKey);
      const prior = byKey.get(entry.stableKey);
      const contentChanged =
        !prior || prior.title !== entry.title || prior.detail !== entry.detail;

      if (!prior) {
        await tx.repoKnowledge.create({
          data: {
            repoId,
            insightId,
            kind: entry.kind,
            stableKey: entry.stableKey,
            title: entry.title,
            detail: entry.detail,
            source: entry.source,
            evidence: JSON.stringify(entry.evidenceIds),
            path: entry.path ?? null,
            strength: entry.strength,
            observations: 1,
            revision,
            status: "active",
            lastSeenAt: now,
            lastChangedAt: now,
            missingSince: null,
          },
        });
        inserted++;
        continue;
      }

      await tx.repoKnowledge.update({
        where: { id: prior.id },
        data: {
          kind: entry.kind,
          title: entry.title,
          detail: entry.detail,
          evidence: JSON.stringify(entry.evidenceIds),
          path: entry.path ?? null,
          strength: entry.strength,
          // Re-seeing an unchanged claim is the signal that it still holds.
          observations: { increment: 1 },
          lastSeenAt: now,
          missingSince: null,
          status: "active",
          // Only a content change bumps the row revision. An observation count
          // moving under an unchanged claim is not news to a reader.
          ...(contentChanged ? { revision, lastChangedAt: now } : {}),
        },
      });
      if (contentChanged) updated++;
    }

    let retired = 0;
    for (const row of existing) {
      if (seenKeys.has(row.stableKey)) continue;
      if (row.missingSince && row.missingSince <= cutoff) {
        await tx.repoKnowledge.update({
          where: { id: row.id },
          data: { status: "retired" },
        });
        retired++;
      } else if (!row.missingSince) {
        // First miss. Grace period starts now, not now-minus-retire-days, so a
        // claim that vanished between two adjacent sweeps still gets a full
        // runway before it is retired.
        await tx.repoKnowledge.update({
          where: { id: row.id },
          data: { missingSince: now },
        });
      }
    }

    if (inserted + updated + retired > 0) {
      logger.info("repo-knowledge-synced", {
        repoId,
        insightId,
        inserted,
        updated,
        retired,
      });
    }
    return { inserted, updated, retired };
  });
}

/**
 * Live knowledge for a repository, strongest first.
 *
 * `includeRetired` exists so the UI can show *that* something was retired and
 * why, which is the difference between "Baton forgot" and "this is gone".
 */
export async function loadKnowledge(
  repoId: string,
  options: { kind?: KnowledgeKind; includeRetired?: boolean; limit?: number } = {},
): Promise<KnowledgeFact[]> {
  const rows = await prisma.repoKnowledge.findMany({
    where: {
      repoId,
      status: options.includeRetired ? undefined : "active",
      ...(options.kind ? { kind: options.kind } : {}),
    },
    orderBy: [{ strength: "desc" }, { lastChangedAt: "desc" }],
    take: Math.min(options.limit ?? 100, 300),
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as KnowledgeKind,
    stableKey: r.stableKey,
    title: r.title,
    detail: r.detail,
    source: r.source as KnowledgeSource,
    evidenceIds: parseIds(r.evidence),
    path: r.path,
    strength: r.strength,
    observations: r.observations,
    revision: r.revision,
    status: r.status as "active" | "retired",
    lastChangedAt: r.lastChangedAt,
    lastSeenAt: r.lastSeenAt,
    missingSince: r.missingSince,
    createdAt: r.createdAt,
  }));
}

export interface KnowledgeSummary {
  total: number;
  byKind: { kind: KnowledgeKind; count: number }[];
  /** Entries confirmed by repeated observation, which is what makes them memory. */
  reinforced: number;
  retired: number;
  lastUpdatedAt: Date | null;
}

export async function summariseKnowledge(repoId: string): Promise<KnowledgeSummary> {
  const [grouped, retired, newest] = await Promise.all([
    prisma.repoKnowledge.groupBy({
      by: ["kind"],
      where: { repoId, status: "active" },
      _count: { _all: true },
    }),
    prisma.repoKnowledge.count({ where: { repoId, status: "retired" } }),
    prisma.repoKnowledge.findFirst({
      where: { repoId, status: "active" },
      orderBy: { lastChangedAt: "desc" },
      select: { lastChangedAt: true },
    }),
  ]);

  const active = grouped.reduce((n, g) => n + g._count._all, 0);
  // Reinforcement needs a separate read only for the count, and it is the one
  // number worth having: "seen 12 times without changing" is the definition of a
  // durable fact.
  const reinforced = await prisma.repoKnowledge.count({
    where: { repoId, status: "active", observations: { gte: 3 } },
  });

  return {
    total: active,
    byKind: grouped
      .map((g) => ({ kind: g.kind as KnowledgeKind, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    reinforced,
    retired,
    lastUpdatedAt: newest?.lastChangedAt ?? null,
  };
}

/**
 * Record a human-written decision.
 *
 * This is the one write path that stores prose a machine did not observe, which
 * is why `source` is pinned to `recorded` and the claim is exempt from
 * retirement. A decision does not become false because a file moved.
 */
export async function recordDecision(input: {
  userId: string;
  repoId: string;
  insightId: string;
  title: string;
  detail: string;
}): Promise<KnowledgeFact> {
  const title = input.title.trim().slice(0, 160);
  const detail = input.detail.trim().slice(0, 2_000);
  if (!title || !detail) throw new Error("a decision needs both a title and a detail");

  const stableKey = stableKeyFor("decision", title.toLowerCase());
  const now = new Date();

  const row = await prisma.repoKnowledge.upsert({
    where: { repoId_stableKey: { repoId: input.repoId, stableKey } },
    create: {
      repoId: input.repoId,
      insightId: input.insightId,
      kind: "decision",
      stableKey,
      title,
      detail,
      source: "recorded",
      evidence: JSON.stringify([]),
      strength: 100,
      observations: 1,
      status: "active",
      lastChangedAt: now,
      lastSeenAt: now,
    },
    update: { detail, lastChangedAt: now, lastSeenAt: now, status: "active", missingSince: null },
  });

  logger.info("repo-knowledge-decision-recorded", {
    userId: input.userId,
    repoId: input.repoId,
    stableKey,
  });
  return {
    id: row.id,
    kind: "decision",
    stableKey: row.stableKey,
    title: row.title,
    detail: row.detail,
    source: "recorded",
    evidenceIds: [],
    path: null,
    strength: row.strength,
    observations: row.observations,
    revision: row.revision,
    status: "active",
    lastChangedAt: row.lastChangedAt,
    lastSeenAt: row.lastSeenAt,
    missingSince: null,
    createdAt: row.createdAt,
  };
}

/** Drop a recorded decision. Derived knowledge cannot be deleted this way. */
export async function forgetDecision(userId: string, repoId: string, id: string): Promise<boolean> {
  const res = await prisma.repoKnowledge.deleteMany({
    where: { id, repoId, source: "recorded" },
  });
  if (res.count === 0) {
    logger.warn("repo-knowledge-forget-rejected", { userId, repoId, id });
    return false;
  }
  return true;
}

function parseIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}