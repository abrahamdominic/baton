import { logger } from "../logger";
import {
  deriveRepositoryProfile,
  isPackageJsonReadable,
  stableProfileKey,
  type CommitTouch,
  type RepositoryProfile,
} from "./profile";
import { prisma } from "../db";
import { getInstallationOctokit } from "../github/app";

/**
 * Collection of repository intelligence.
 *
 * The rule this module exists to enforce: **Baton never asserts a fact about a
 * repository that it cannot cite.** Every value written here comes from a real
 * GitHub API response, and every value is accompanied by a `RepoEvidence` row
 * recording where it was read from, at which ref, and when.
 *
 * There is deliberately no text generation in this file. A "summary" produced
 * by a language model would be unciteable and could invent facts, which is the
 * opposite of what this product is for. The intelligence is the structured
 * facts plus their provenance; phrasing happens at render time from those facts.
 */

export interface EvidenceInput {
  kind: string;
  label: string;
  path?: string | null;
  ref?: string | null;
  excerpt?: string | null;
  url?: string | null;
  rank?: number;
}

export interface LanguageSlice {
  name: string;
  bytes: number;
  percent: number;
}

export interface ContributorSlice {
  login: string;
  commits: number;
}

export interface CollectedIntelligence {
  description: string | null;
  homepage: string | null;
  topics: string[];
  languages: LanguageSlice[];
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
  topContributors: ContributorSlice[];
  lastReleaseTag: string | null;
  lastReleaseAt: Date | null;
  structure: {
    topLevel: string[];
    workflowNames: string[];
    profile: RepositoryProfile;
    /**
     * Raw CODEOWNERS contents. Capped because the file is normally a few
     * dozen lines and an unbounded blob would end up in every profile row.
     * `null` means "no CODEOWNERS found"; absent (pre-upgrade rows) is handled
     * by `readStructure`.
     */
    codeowners: string | null;
  };
  evidence: EvidenceInput[];
}

/** Evidence ranks: lower sorts first when a claim needs several sources. */
const RANK = {
  codeowners: 10,
  readme: 20,
  security: 25,
  license: 25,
  contributing: 30,
  workflow: 30,
  languages: 40,
  structure: 45,
  release: 50,
  contributors: 60,
  profile: 65,
  churn: 58,
  repo: 70,
} as const;

const STRUCTURE_FILES = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
  "SECURITY.md",
  ".github/SECURITY.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "README.md",
  "readme.md",
  "README.rst",
];

/**
 * Fetch the repository tree once and derive every structural fact from it.
 *
 * One recursive-tree call answers "is there a README / CODEOWNERS / CI?" for the
 * whole repository, instead of a probe request per file, which matters because
 * these run for every connected repository on a schedule.
 */
async function readStructure(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  ref: string,
  evidence: EvidenceInput[],
  webBase: string,
): Promise<{ topLevel: string[]; workflowNames: string[]; has: Record<string, string | undefined>; paths: string[] }> {
  let paths: string[] = [];
  try {
    const res = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "1",
    });
    paths = (res.data.tree ?? [])
      .filter((n) => n.type === "blob")
      .map((n) => n.path ?? "");
  } catch (e) {
    // An empty or unreadable tree is a real state (fresh repo, or a token
    // without `contents: read`), not a fatal error. Record why and move on so
    // the rest of the profile is still collected.
    logger.warn("repo-intel-tree-failed", { owner, repo, ref, error: String(e) });
    evidence.push({
      kind: "structure",
      label: `Could not read the tree at ${ref}`,
      ref,
      excerpt: "GitHub did not return a file listing for this ref, so structural facts are unavailable.",
      url: `${webBase}/tree/${ref}`,
      rank: RANK.structure,
    });
    return { topLevel: [], workflowNames: [], has: {}, paths: [] };
  }

  const lower = new Map<string, string>();
  for (const p of paths) lower.set(p.toLowerCase(), p);

  const has: Record<string, string | undefined> = {};
  for (const candidate of STRUCTURE_FILES) {
    const match = lower.get(candidate.toLowerCase());
    if (match && has[match] === undefined) has[match] = match;
  }

  // Trunk *directories*, not trunk files. Callers use this to answer "where
  // does the code live" (onboarding's architecture map, impact analysis' "is
  // this path inside the structure we recorded"), so listing `README.md` and
  // `package.json` here answered a question nobody asked and left every
  // directory-shaped lookup permanently empty.
  const topLevel = [
    ...new Set(
      paths
        .filter((p) => p.includes("/"))
        .map((p) => p.split("/")[0])
        .filter((segment) => segment.length > 0 && !segment.startsWith("."))
        .sort(),
    ),
  ].slice(0, 40);

  const workflowNames = paths
    .filter((p) => p.startsWith(".github/workflows/") && /\.(ya?ml)$/i.test(p))
    .map((p) => p.split("/").pop() ?? p)
    .sort();

  // Cite the concrete files that establish each structural fact. README is
  // intentionally left to the caller: it matches `readme.*` in any extension,
  // and citing it here as well produced two identical `readme` evidence rows
  // for one fact, so every claim that cited "readme" rendered a duplicate chip.
  const cite = (prefix: string, kind: string, label: string, rank: number) => {
    const match = Object.values(has).find((p) => p?.toLowerCase().startsWith(prefix));
    if (match) {
      evidence.push({
        kind,
        label,
        path: match,
        ref,
        url: `${webBase}/blob/${ref}/${match}`,
        rank,
      });
    }
  };
  cite("codeowners", "codeowners", "Ownership rules are enforced in-repo", RANK.codeowners);
  cite("security.md", "security", "There is a published security policy", RANK.security);
  // `LICENSE`, `LICENSE.md` and `LICENSE.txt` are all a real license; matching
  // the bare name only meant `hasLicense` could be true with no license evidence.
  cite("license", "license", "The project ships a license", RANK.license);
  cite("contributing.md", "contributing", "There is a contributing guide", RANK.contributing);

  if (workflowNames.length > 0) {
    evidence.push({
      kind: "workflow",
      label: `CI is defined by ${workflowNames.length} workflow${workflowNames.length === 1 ? "" : "s"}`,
      path: ".github/workflows",
      ref,
      url: `${webBase}/tree/${ref}/.github/workflows`,
      rank: RANK.workflow,
    });
  }

  return { topLevel, workflowNames, has, paths };
}

/**
 * Turn profile facts into citable evidence rows.
 *
 * aa.md §7 requires answers to be grounded and to show their source files, so
 * every structural claim needs an evidence row with a real GitHub URL. Claims
 * with no proof are dropped rather than emitted with a null path, because an
 * unciteable claim is exactly what the product promises not to produce.
 */
function emitProfileEvidence(
  profile: RepositoryProfile,
  ctx: {
    owner: string;
    repo: string;
    ref: string | null;
    webBase: string;
    paths: string[];
    packageJsonReadable: boolean;
    evidence: EvidenceInput[];
  },
): void {
  const { ref, webBase, paths, evidence } = ctx;
  if (!ref) return;

  const find = (re: RegExp): string | undefined => paths.find((p) => re.test(p));
  const blob = (p: string) => `${webBase}/blob/${ref}/${p}`;

  const push = (kind: string, label: string, path?: string, rank = RANK.profile) => {
    evidence.push({
      kind,
      label,
      path: path ?? null,
      ref,
      url: path ? blob(path) : webBase,
      rank,
    });
  };

  if (profile.packageManager) {
    const lock = find(
      new RegExp(
        `^(${["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "package-lock.json", "poetry.lock", "uv.lock", "Pipfile.lock", "requirements.txt", "go.sum", "cargo.lock", "gemfile.lock", "composer.lock"].join("|")})$`,
        "i",
      ),
    );
    push("profile", `Dependencies are managed with ${profile.packageManager}`, lock);
  }

  if (ctx.packageJsonReadable) {
    if (profile.dependencyCount !== null) {
      push(
        "profile",
        `package.json declares ${profile.dependencyCount} direct dependenc${profile.dependencyCount === 1 ? "y" : "ies"}`,
        "package.json",
      );
    }
  } else if (paths.some((p) => p.toLowerCase() === "package.json")) {
    // Say the manifest exists but could not be read, rather than letting the
    // profile silently report zero dependencies.
    push("profile", "package.json exists but could not be parsed, so dependencies are unknown", "package.json");
  }

  for (const fw of profile.frameworks) {
    push("profile", `Built with ${fw}`, "package.json");
  }

  if (profile.apiStyle) push("profile", `HTTP surface: ${profile.apiStyle}`, find(/(^|\/)api\//i) ?? undefined);

  if (profile.hasTypeScript) push("profile", "The project is type-checked with TypeScript", profile.typeConfig ?? "tsconfig.json");

  if (profile.testFramework) {
    push("profile", `Tests run with ${profile.testFramework}`, find(new RegExp(profile.testFramework, "i")));
  } else if (profile.hasTests) {
    push("profile", `${profile.testFileCount} test file${profile.testFileCount === 1 ? "" : "s"} found, but no test runner is configured in the repository root`);
  } else {
    push("profile", "No test files were found in the default branch");
  }

  if (profile.lintTool) push("profile", `Linting is configured with ${profile.lintTool}`);
  if (profile.formatTool) push("profile", `Formatting is configured with ${profile.formatTool}`);

  if (profile.orm) {
    push("profile", `Database access goes through ${profile.orm}`, find(/(^|\/)(prisma\/schema\.prisma|drizzle\.config\.ts|ormconfig\.json|db\/schema\.rb|alembic\.ini|schema\.sql)$/i) ?? undefined);
  }
  if (profile.hasMigrations) push("profile", "Database schema changes are tracked as migrations", find(/migrations?\//i));

  for (const target of profile.deploymentTargets) push("profile", `Deployment is configured for ${target}`);
  if (profile.hasDocker) push("profile", "The project builds through a container image", find(/^dockerfile/i) ?? undefined);
  if (profile.hasEnvExample) {
    push("profile", "The repository publishes an example environment file", find(/\.env\.(example|sample|template)$/i));
  }
  for (const tool of profile.securityTooling) push("profile", `Dependency security is managed with ${tool}`);
  for (const tool of profile.monorepoTools) {
    push("profile", `This is a monorepo; its workspace tooling includes ${tool}`);
  }
  if (profile.hasDocsDir) push("profile", "The project keeps documentation in a docs/ directory", "docs");

  // Churn and staleness, from the bounded commit sample.
  if (profile.commitSampleSize === 0) {
    evidence.push({
      kind: "churn",
      label: "Change history was not readable, so churn and stale-area analysis is unavailable",
      ref,
      url: `${webBase}/commits/${ref}`,
      rank: RANK.churn,
    });
  } else {
    for (const area of profile.highChurnAreas.slice(0, 3)) {
      evidence.push({
        kind: "churn",
        label: `${area.area} changed in ${area.commits} of the last ${profile.commitSampleSize} sampled commits`,
        path: area.area === "(root)" ? null : area.area,
        ref,
        url: `${webBase}/commits/${ref}/${area.area}`,
        rank: RANK.churn,
      });
    }
    for (const f of profile.frequentlyModifiedFiles.slice(0, 3)) {
      evidence.push({
        kind: "churn",
        label: `${f.path} was modified in ${f.commits} sampled commit${f.commits === 1 ? "" : "s"}`,
        path: f.path,
        ref,
        url: blob(f.path),
        rank: RANK.churn,
      });
    }
    for (const area of profile.staleAreas.slice(0, 3)) {
      evidence.push({
        kind: "stale",
        label: `${area.area} has not been touched in the sampled history (last change ${area.daysSince} days ago)`,
        path: area.area === "(root)" ? null : area.area,
        ref,
        url: `${webBase}/commits/${ref}/${area.area}`,
        rank: RANK.churn,
      });
    }
  }
}

/**
 * The commits-list response includes a `files` array per commit, but
 * `@octokit/rest` v21 does not surface it on the generated type, so the shape
 * is narrowed here rather than cast to `any` at each use.
 */
interface CommitListEntry {
  commit?: { author?: { date?: string | null } | null } | null;
  author?: { login?: string | null } | null;
  files?: { filename?: string }[] | null;
}

/** Bounded recent-commit sample used for churn, staleness and ownership facts. */
const COMMIT_SAMPLE_PAGES = 2;
const COMMIT_PAGE_SIZE = 100;

/**
 * Read `package.json` so the profile can name frameworks and count dependencies.
 *
 * Returns null when there is no manifest or it cannot be read. The distinction
 * matters: "no package.json" and "package.json is malformed" lead to different
 * evidence, and neither is the same as "this repository has no dependencies".
 */
async function readPackageJson(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  ref: string,
): Promise<string | null> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path: "package.json", ref });
    const data = res.data as { content?: string; encoding?: string } | unknown[];
    if (Array.isArray(data) || !data || typeof data !== "object") return null;
    const raw = (data as { content?: string }).content;
    if (typeof raw !== "string") return null;
    return Buffer.from(raw, (data as { encoding?: string }).encoding === "base64" ? "base64" : "utf8").toString("utf8");
  } catch (e) {
    // A repository without package.json is the common case, not an error worth
    // a warn-level line on every collection run.
    logger.debug("repo-intel-package-json-unavailable", { owner, repo, error: String(e) });
    return null;
  }
}

/** Read a single text file's contents, or null when it cannot be read. */
async function readTextFile(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const res = await octokit.rest.repos.getContent({ owner, repo, path, ref });
  const data = res.data as { content?: string; encoding?: string } | unknown[];
  if (Array.isArray(data) || !data || typeof data !== "object") return null;
  const raw = (data as { content?: string }).content;
  if (typeof raw !== "string") return null;
  return Buffer.from(raw, (data as { encoding?: string }).encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

/**
 * Bounded sample of recent commits with the files each touched.
 *
 * This is one `listCommitsForRepo` walk (2 pages = 200 commits), not a
 * per-file history request, because "which areas change most" and "which areas
 * have gone quiet" are answerable from a recent sample while per-file history
 * would issue hundreds of API calls per repository on a schedule.
 *
 * Returns an empty sample when commits are unreadable, which downstream treats
 * as "churn unknown" rather than "this repository is not active".
 */
async function readCommitSample(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  sha: string,
): Promise<CommitTouch[]> {
  const out: CommitTouch[] = [];
  try {
    for (let page = 1; page <= COMMIT_SAMPLE_PAGES; page++) {
      const res = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha,
        per_page: COMMIT_PAGE_SIZE,
        page,
      });
      const rows = (res.data ?? []) as unknown as CommitListEntry[];
      for (const c of rows) {
        const date = c.commit?.author?.date ?? null;
        if (!date) continue;
        out.push({
          files: (c.files ?? [])
            .map((f: { filename?: string }) => f.filename)
            .filter((n: unknown): n is string => typeof n === "string"),
          date,
          author: c.author?.login ?? null,
        });
      }
      if (rows.length < COMMIT_PAGE_SIZE) break;
    }
  } catch (e) {
    logger.warn("repo-intel-commits-failed", { owner, repo, error: String(e) });
    return [];
  }
  return out;
}

function toPercentSlices(
  raw: Record<string, number> | undefined,
): LanguageSlice[] {
  const entries = Object.entries(raw ?? {})
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, b]) => n + b, 0);
  if (total === 0) return [];
  return entries.slice(0, 8).map(([name, bytes]) => ({
    name,
    bytes,
    // One decimal place is enough to rank languages and keeps the row stable.
    percent: Math.round((bytes / total) * 1000) / 10,
  }));
}

/**
 * Collect everything Baton knows how to state about a repository, from GitHub.
 *
 * Fails loudly rather than writing a partial-but-plausible profile: a half
 * populated profile with no evidence is worse than no profile, because the UI
 * would present absence of data as a fact about the project.
 */
export async function collectRepositoryIntelligence(
  installationId: number,
  owner: string,
  repo: string,
): Promise<CollectedIntelligence> {
  const octokit = await getInstallationOctokit(installationId);
  const webBase = `https://github.com/${owner}/${repo}`;
  const evidence: EvidenceInput[] = [];

  const metaRes = await octokit.rest.repos.get({ owner, repo });
  const meta = metaRes.data;
  const defaultBranch = meta.default_branch || null;

  evidence.push({
    kind: "repo",
    label: "Repository metadata as reported by the GitHub API",
    url: webBase,
    excerpt: meta.description ?? undefined,
    rank: RANK.repo,
  });

  const structure = defaultBranch
    ? await readStructure(octokit, owner, repo, defaultBranch, evidence, webBase)
    : { topLevel: [], workflowNames: [], has: {}, paths: [] };

  // A README is only claimed when the tree actually contained one.
  const readmePath = Object.values(structure.has).find((p) => p?.toLowerCase().startsWith("readme"));
  if (readmePath) {
    evidence.push({
      kind: "readme",
      label: "README present in the default branch",
      path: readmePath,
      ref: defaultBranch,
      url: `${webBase}/blob/${defaultBranch}/${readmePath}`,
      rank: RANK.readme,
    });
  }

  let languages: LanguageSlice[] = [];
  try {
    const langRes = await octokit.rest.repos.listLanguages({ owner, repo });
    languages = toPercentSlices(langRes.data as Record<string, number>);
    if (languages.length > 0) {
      evidence.push({
        kind: "languages",
        label: `Primary language: ${languages[0]!.name} (${languages[0]!.percent}%)`,
        url: `${webBase}?tab=linguist`,
        rank: RANK.languages,
      });
    }
  } catch (e) {
    logger.warn("repo-intel-languages-failed", { owner, repo, error: String(e) });
  }

  // Counts. `search` is unreliable for private repositories, so the authoritative
  // open counts come from the repository's own paginated endpoints.
  const [openPrs, openIssues, mergedRecent, contributors, releases] = await Promise.all([
    octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 1 }),
    octokit.rest.issues.listForRepo({ owner, repo, state: "open", per_page: 1 }),
    countMergedLast30Days(octokit, owner, repo),
    countContributors(octokit, owner, repo, evidence, webBase),
    latestRelease(octokit, owner, repo, evidence, webBase),
  ]);

  const openPullRequests = readTotal(openPrs.headers as Record<string, unknown>);
  const openIssueRows = readTotal(openIssues.headers as Record<string, unknown>);

  // --- Repository profile (aa.md §6) ---------------------------------------
  // Derived from the tree already fetched, plus one bounded commit walk. Both
  // are best-effort: a repository we cannot read is reported as unknown rather
  // than as "this project has no dependencies / no tests".
  const [packageJsonRaw, commitSample] = await Promise.all([
    defaultBranch ? readPackageJson(octokit, owner, repo, defaultBranch) : Promise.resolve(null),
    defaultBranch ? readCommitSample(octokit, owner, repo, defaultBranch) : Promise.resolve([] as CommitTouch[]),
  ]);

  const profile = deriveRepositoryProfile(structure.paths, commitSample, packageJsonRaw);

  // The CODEOWNERS *contents*, not just its existence. "This repository has a
  // CODEOWNERS file" cannot answer "who should review this pull request", which
  // is the question aa.md §8/§11 actually asks.
  // Exact basename, not a suffix test: `endsWith("codeowners")` would happily
  // accept a file called `NOTCODEOWNERS` and then attribute the repository's
  // review ownership to whatever that file happens to contain.
  const codeownersPath = Object.values(structure.has).find((p) => {
    if (!p) return false;
    const base = p.slice(p.lastIndexOf("/") + 1);
    return base.toLowerCase() === "codeowners";
  });
  const codeownersRaw =
    codeownersPath && defaultBranch
      ? await readTextFile(octokit, owner, repo, defaultBranch, codeownersPath).catch(() => null)
      : null;
  const codeowners = codeownersRaw ? codeownersRaw.slice(0, 20_000) : null;
  emitProfileEvidence(profile, {
    owner,
    repo,
    ref: defaultBranch,
    webBase,
    paths: structure.paths,
    packageJsonReadable: isPackageJsonReadable(structure.paths, packageJsonRaw),
    evidence,
  });

  return {
    description: meta.description ?? null,
    homepage: meta.homepage || null,
    topics: (meta.topics ?? []).slice(0, 20),
    languages,
    hasReadme: Boolean(readmePath),
    hasCodeowners: Object.values(structure.has).some((p) => p?.toLowerCase().endsWith("codeowners")),
    hasContributing: Object.values(structure.has).some((p) => p?.toLowerCase().endsWith("contributing.md")),
    hasCiWorkflows: structure.workflowNames.length > 0,
    hasSecurityPolicy: Object.values(structure.has).some((p) => p?.toLowerCase().endsWith("security.md")),
    hasLicense: Object.values(structure.has).some((p) => p?.toLowerCase().startsWith("license")),
    defaultBranch,
    openPullRequests,
    // GitHub's issues endpoint includes pull requests; subtract the open PRs so
    // the number a developer reads is actual issues.
    openIssues: Math.max(0, openIssueRows - openPullRequests),
    mergedLast30Days: mergedRecent,
    contributorCount: contributors.total,
    topContributors: contributors.top,
    lastReleaseTag: releases.tag,
    lastReleaseAt: releases.at,
    structure: { topLevel: structure.topLevel, workflowNames: structure.workflowNames, profile, codeowners },
    evidence,
  };
}

function readTotal(headers: Record<string, unknown>): number {
  const link = headers["link"];
  if (typeof link !== "string") return 0;
  // The last page number in `rel="last"` is the authoritative total.
  const m = link.match(/[?&]page=(\d+)[^>]*rel="last"/);
  if (m) return Number(m[1]) || 0;
  // No `rel="last"` means GitHub did not tell us the total. The old fallback
  // matched the *first* `page=`, which is the `rel="next"` cursor (2), so
  // "2 open pull requests" was a real number derived from a page index.
  // Report unknown-as-zero rather than invent a count.
  return 0;
}

async function countMergedLast30Days(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
): Promise<number | null> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  try {
    const res = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged merged:>=${since}`,
      per_page: 1,
    });
    return res.data.total_count || 0;
  } catch (e) {
    // The search API does not reliably index private repositories, so this
    // fails routinely and is not a bug. Returning 0 here recorded "this project
    // merged nothing in 30 days" and the briefing escalated it as a risk. The
    // count is genuinely unknown, so say so.
    logger.warn("repo-intel-merged-count-unavailable", { owner, repo, error: String(e) });
    return null;
  }
}

async function countContributors(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  evidence: EvidenceInput[],
  webBase: string,
): Promise<{ total: number; top: ContributorSlice[] }> {
  try {
    const res = await octokit.rest.repos.listContributors({ owner, repo, per_page: 20, anon: "false" });
    const rows = res.data ?? [];
    const top = rows
      .filter((c) => c.login)
      .map((c) => ({ login: c.login as string, commits: c.contributions ?? 0 }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 8);
    if (top.length > 0) {
      evidence.push({
        kind: "contributors",
        label: `${top.length} recent contributors, led by ${top[0]!.login}`,
        url: `${webBase}/graphs/contributors`,
        rank: RANK.contributors,
      });
    }
    return { total: rows.length, top };
  } catch (e) {
    logger.warn("repo-intel-contributors-failed", { owner, repo, error: String(e) });
    return { total: 0, top: [] };
  }
}

async function latestRelease(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  owner: string,
  repo: string,
  evidence: EvidenceInput[],
  webBase: string,
): Promise<{ tag: string | null; at: Date | null }> {
  try {
    const res = await octokit.rest.repos.listReleases({ owner, repo, per_page: 1 });
    const rel = res.data?.[0];
    if (!rel) return { tag: null, at: null };
    evidence.push({
      kind: "release",
      label: `Latest release ${rel.tag_name}`,
      url: rel.html_url ?? `${webBase}/releases`,
      rank: RANK.release,
    });
    return {
      tag: rel.tag_name ?? null,
      at: rel.published_at ? new Date(rel.published_at) : null,
    };
  } catch (e) {
    logger.warn("repo-intel-releases-failed", { owner, repo, error: String(e) });
    return { tag: null, at: null };
  }
}

/** The subset of a profile that decides whether it changed. */
function fingerprint(c: CollectedIntelligence): string {
  return JSON.stringify({
    d: c.description,
    t: c.topics,
    l: c.languages.map((x) => `${x.name}:${x.percent}`),
    s: [c.hasReadme, c.hasCodeowners, c.hasCiWorkflows, c.hasSecurityPolicy, c.hasLicense, c.hasContributing],
    n: [c.openPullRequests, c.openIssues, c.mergedLast30Days, c.contributorCount],
    r: c.lastReleaseTag,
    w: c.structure.workflowNames,
    // Only the structural profile. Churn/staleness change every run and would
    // otherwise bump the revision on every sweep, invalidating all digests.
    p: c.structure.profile ? stableProfileKey(c.structure.profile) : null,
  });
}

/**
 * Persist a freshly collected profile, replacing its evidence.
 *
 * Evidence rows are rewritten rather than accumulated: a citation should point
 * at what is true now, and an unbounded evidence table would grow without limit
 * on every scheduled run.
 */
export async function saveRepositoryIntelligence(
  repoRowId: string,
  collected: CollectedIntelligence,
): Promise<{ insightId: string; changed: boolean }> {
  const existing = await prisma.repositoryInsight.findUnique({
    where: { repoId: repoRowId },
    select: {
      id: true,
      revision: true,
      description: true,
      topics: true,
      languages: true,
      hasReadme: true,
      hasCodeowners: true,
      hasContributing: true,
      hasCiWorkflows: true,
      hasSecurityPolicy: true,
      hasLicense: true,
      openPullRequests: true,
      openIssues: true,
      mergedLast30Days: true,
      contributorCount: true,
      lastReleaseTag: true,
      structure: true,
    },
  });

  const changed = existing ? storedFingerprint(existing) !== fingerprint(collected) : true;
  const revision = changed ? (existing?.revision ?? 0) + 1 : (existing?.revision ?? 1);

  const insight = existing
    ? await prisma.repositoryInsight.update({
        where: { id: existing.id },
        data: {
          description: collected.description,
          homepage: collected.homepage,
          topics: JSON.stringify(collected.topics),
          languages: JSON.stringify(collected.languages),
          hasReadme: collected.hasReadme,
          hasCodeowners: collected.hasCodeowners,
          hasContributing: collected.hasContributing,
          hasCiWorkflows: collected.hasCiWorkflows,
          hasSecurityPolicy: collected.hasSecurityPolicy,
          hasLicense: collected.hasLicense,
          defaultBranch: collected.defaultBranch,
          openPullRequests: collected.openPullRequests,
          openIssues: collected.openIssues,
          mergedLast30Days: collected.mergedLast30Days,
          contributorCount: collected.contributorCount,
          topContributors: JSON.stringify(collected.topContributors),
          lastReleaseTag: collected.lastReleaseTag,
          lastReleaseAt: collected.lastReleaseAt,
          structure: JSON.stringify(collected.structure),
          revision,
          collectedAt: new Date(),
        },
      })
    : await prisma.repositoryInsight.create({
        data: {
          repoId: repoRowId,
          description: collected.description,
          homepage: collected.homepage,
          topics: JSON.stringify(collected.topics),
          languages: JSON.stringify(collected.languages),
          hasReadme: collected.hasReadme,
          hasCodeowners: collected.hasCodeowners,
          hasContributing: collected.hasContributing,
          hasCiWorkflows: collected.hasCiWorkflows,
          hasSecurityPolicy: collected.hasSecurityPolicy,
          hasLicense: collected.hasLicense,
          defaultBranch: collected.defaultBranch,
          openPullRequests: collected.openPullRequests,
          openIssues: collected.openIssues,
          mergedLast30Days: collected.mergedLast30Days,
          contributorCount: collected.contributorCount,
          topContributors: JSON.stringify(collected.topContributors),
          lastReleaseTag: collected.lastReleaseTag,
          lastReleaseAt: collected.lastReleaseAt,
          structure: JSON.stringify(collected.structure),
        },
      });

  await prisma.repoEvidence.deleteMany({ where: { insightId: insight.id } });
  if (collected.evidence.length > 0) {
    await prisma.repoEvidence.createMany({
      data: collected.evidence.map((e) => ({
        insightId: insight.id,
        repoId: repoRowId,
        kind: e.kind,
        label: e.label,
        path: e.path ?? null,
        ref: e.ref ?? null,
        excerpt: e.excerpt ?? null,
        url: e.url ?? null,
        rank: e.rank ?? 100,
      })),
    });
  }

  logger.info("repo-intel-saved", {
    repoRowId,
    revision,
    changed,
    evidence: collected.evidence.length,
  });
  return { insightId: insight.id, changed };
}

/**
 * The same fingerprint, computed from the stored columns rather than from a
 * fresh collection. `topics`/`languages`/`structure` are JSON strings in the
 * database, so they are normalised back to the shape `fingerprint` expects
 * before comparing — otherwise every run would look like a change.
 */
function storedFingerprint(row: {
  description: string | null;
  topics: string;
  languages: string;
  hasReadme: boolean;
  hasCodeowners: boolean;
  hasContributing: boolean;
  hasCiWorkflows: boolean;
  hasSecurityPolicy: boolean;
  hasLicense: boolean;
  openPullRequests: number;
  openIssues: number;
  mergedLast30Days: number | null;
  contributorCount: number;
  lastReleaseTag: string | null;
  structure: string;
}): string {
  return fingerprint({
    description: row.description,
    topics: parseJson<string[]>(row.topics, []),
    languages: parseJson<LanguageSlice[]>(row.languages, []),
    hasReadme: row.hasReadme,
    hasCodeowners: row.hasCodeowners,
    hasContributing: row.hasContributing,
    hasCiWorkflows: row.hasCiWorkflows,
    hasSecurityPolicy: row.hasSecurityPolicy,
    hasLicense: row.hasLicense,
    openPullRequests: row.openPullRequests,
    openIssues: row.openIssues,
    mergedLast30Days: row.mergedLast30Days,
    contributorCount: row.contributorCount,
    lastReleaseTag: row.lastReleaseTag,
    structure: parseJson<{
      topLevel: string[];
      workflowNames: string[];
      profile?: RepositoryProfile;
      codeowners?: string | null;
    }>(
      row.structure,
      { topLevel: [], workflowNames: [], codeowners: null },
    ) as { topLevel: string[]; workflowNames: string[]; profile: RepositoryProfile; codeowners: string | null },
    // Fields outside change detection.
    homepage: null,
    defaultBranch: null,
    topContributors: [],
    lastReleaseAt: null,
    evidence: [],
  } as CollectedIntelligence);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}
