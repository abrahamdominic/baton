/**
 * Repository profile derivation.
 *
 * aa.md §6 makes repository inspection a signature capability and lists what it
 * has to understand: structure, languages, frameworks, package managers,
 * dependencies, configuration, CI/CD, deployment configuration, database
 * configuration, API structure, testing, linting, formatting, security
 * configuration, dependency health, ownership patterns, frequently modified
 * files, high-churn areas, abandoned areas and documentation gaps.
 *
 * The previous profile answered a small fraction of that (README / CODEOWNERS /
 * license / CI present or not) and then displayed raw GitHub numbers. This
 * module turns the file listing Baton already fetches into the rest of the
 * profile.
 *
 * Two rules shape everything here:
 *
 * 1. It is a pure function of `(paths, commits)`. Every fact below is derived,
 *    not fetched, so the whole profile is unit-testable without a GitHub mock
 *    and cannot silently disagree with the tree it describes.
 * 2. Nothing is inferred beyond what the tree proves. If a repository has no
 *    lockfile, `packageManager` is null rather than "npm" -- guessing here is
 *    how a developer ends up trusting an answer that was never checked.
 */

export interface CommitTouch {
  /** Paths changed by the commit, as reported by the commits API. */
  files: string[];
  /** ISO timestamp of the commit. */
  date: string;
  author: string | null;
}

export interface ChurnArea {
  area: string;
  commits: number;
}

export interface TouchedFile {
  path: string;
  commits: number;
  lastTouchedAt: string;
}

export interface StaleArea {
  area: string;
  lastTouchedAt: string;
  daysSince: number;
}

export interface RepositoryProfile {
  packageManager: string | null;
  manifests: string[];
  frameworks: string[];
  dependencyCount: number | null;
  hasTypeScript: boolean;
  typeConfig: string | null;
  testFramework: string | null;
  testFileCount: number;
  hasTests: boolean;
  lintTool: string | null;
  formatTool: string | null;
  hasDocker: boolean;
  deploymentTargets: string[];
  hasEnvExample: boolean;
  orm: string | null;
  hasMigrations: boolean;
  apiStyle: string | null;
  monorepoTools: string[];
  hasDocsDir: boolean;
  securityTooling: string[];
  totalFileCount: number;
  highChurnAreas: ChurnArea[];
  frequentlyModifiedFiles: TouchedFile[];
  staleAreas: StaleArea[];
  commitSampleSize: number;
}

const PKG_MANAGERS: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["pipfile.lock", "pipenv"],
  ["Pipfile.lock", "pipenv"],
  ["requirements.txt", "pip"],
  ["go.sum", "go"],
  ["cargo.lock", "cargo"],
  ["gemfile.lock", "bundler"],
  ["composer.lock", "composer"],
];

const MANIFESTS = [
  "package.json",
  "go.mod",
  "cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
  "pubspec.yaml",
];

/** Framework signature -> human name. Matched on dependency names, not file layout. */
const FRAMEWORK_DEPS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@angular/core", "Angular"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["@nestjs/core", "NestJS"],
  ["hapi", "Hapi"],
  ["koa", "Koa"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["fastapi", "FastAPI"],
  ["rails", "Ruby on Rails"],
  ["sinatra", "Sinatra"],
  ["spring-boot-starter", "Spring Boot"],
  ["gin-gonic/gin", "Gin"],
  ["actix-web", "Actix"],
  ["laravel/framework", "Laravel"],
  ["phoenix", "Phoenix"],
];

const TEST_FRAMEWORKS: [string, string][] = [
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["playwright", "Playwright"],
  ["cypress", "Cypress"],
  ["mocha", "Mocha"],
  ["pytest", "pytest"],
  ["rspec", "RSpec"],
  ["phpunit", "PHPUnit"],
];

const LINT_TOOLS: [string, string][] = [
  ["eslint", "ESLint"],
  ["biome.json", "Biome"],
  ["ruff.toml", "Ruff"],
  [".golangci.yml", "golangci-lint"],
  [".golangci.yaml", "golangci-lint"],
  [".rubocop.yml", "RuboCop"],
  [".pre-commit-config.yaml", "pre-commit"],
];

const FORMAT_TOOLS: [string, string][] = [
  ["prettier", "Prettier"],
  [".prettierrc", "Prettier"],
  ["biome.json", "Biome"],
  ["rustfmt.toml", "rustfmt"],
  [".editorconfig", "EditorConfig"],
];

const ORMS: [string, string][] = [
  ["prisma/schema.prisma", "Prisma"],
  ["drizzle.config.ts", "Drizzle"],
  ["ormconfig.json", "TypeORM"],
  ["typeorm.json", "TypeORM"],
  ["db/schema.rb", "Active Record"],
  ["alembic.ini", "Alembic"],
  ["schema.sql", "Raw SQL schema"],
];

const DEPLOYMENT_TARGETS: [string, string][] = [
  ["vercel.json", "Vercel"],
  ["netlify.toml", "Netlify"],
  ["fly.toml", "Fly.io"],
  ["render.yaml", "Render"],
  ["app.yaml", "Google App Engine"],
  ["serverless.yml", "Serverless"],
  ["k8s/", "Kubernetes"],
  ["kubernetes/", "Kubernetes"],
  ["helm/", "Helm"],
  ["terraform/", "Terraform"],
  ["ansible/", "Ansible"],
  ["cloudbuild.yaml", "Google Cloud Build"],
  ["Procfile", "Procfile"],
  ["docker-compose", "Docker Compose"],
];

const SECURITY_TOOLING: [string, string][] = [
  ["dependabot.yml", "Dependabot"],
  ["dependabot.yaml", "Dependabot"],
  ["renovate.json", "Renovate"],
  [".snyk", "Snyk"],
  ["trivy.yaml", "Trivy"],
  ["codeql", "CodeQL"],
  ["gitleaks.toml", "Gitleaks"],
];

/**
 * Parse a `package.json` without throwing.
 *
 * Returns null for anything unparseable. A malformed manifest is a fact worth
 * recording ("we could not read the dependencies") and is handled by the caller
 * emitting an evidence row, rather than being silently treated as "no
 * dependencies".
 */
function parseJsonFile(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readDeps(pkg: unknown): string[] {
  if (typeof pkg !== "object" || pkg === null) return [];
  const obj = pkg as Record<string, unknown>;
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = obj[field];
    if (typeof block === "object" && block !== null) names.push(...Object.keys(block as object));
  }
  return names;
}

/**
 * Locate the concrete path a needle refers to, or `undefined`.
 *
 * A single matcher is used everywhere because these needles appear at wildly
 * different depths and with different conventions: `prisma/schema.prisma` is a
 * two-segment path, `dependabot.yml` lives under `.github/`, and
 * `eslint.config.js` only shares a prefix with the word "eslint". Matching only
 * on exact paths silently missed two of those three, which is how "no linter is
 * configured" and "no Dependabot" became false negatives.
 *
 * Strategies, in order: exact path, basename, directory prefix, and finally a
 * basename prefix so `vitest.config.ts` answers for the needle `vitest`.
 */
function findPath(paths: string[], needle: string): string | undefined {
  const n = needle.toLowerCase();
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower === n) return p;
  }
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    if (base === n) return p;
  }
  for (const p of paths) {
    if (p.toLowerCase().startsWith(`${n}/`)) return p;
  }
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    if (base.startsWith(n) && base.length > n.length) return p;
  }
  return undefined;
}

function matchFirst(paths: string[], table: [string, string][]): string | null {
  for (const [needle, label] of table) {
    if (findPath(paths, needle)) return label;
  }
  return null;
}

function matchAll(paths: string[], table: [string, string][]): string[] {
  const found = new Set<string>();
  for (const [needle, label] of table) {
    if (findPath(paths, needle)) found.add(label);
  }
  return [...found].sort();
}

function matchAllPaths(paths: string[], needles: string[]): string[] {
  const out: string[] = [];
  for (const needle of needles) {
    const hit = findPath(paths, needle);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

const TEST_PATH_RE =
  /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|test_[^/]+\.py$/i;

function areaOf(path: string): string {
  const segments = path.split("/");
  // Trunk-level files belong to the repository root rather than a fake area.
  return segments.length > 1 ? segments[0] : "(root)";
}

/**
 * Derive the full repository profile.
 *
 * @param paths  every blob path in the default branch tree
 * @param commits bounded recent-commit sample, oldest-last is not assumed
 * @param packageJsonRaw raw `package.json` contents when present, else null
 * @param now injectable clock so churn/staleness tests are deterministic
 */
export function deriveRepositoryProfile(
  paths: string[],
  commits: CommitTouch[],
  packageJsonRaw: string | null,
  now: Date = new Date(),
): RepositoryProfile {
  /** True when `p` is a directory (or the tree itself) rather than a file. */
  const hasDir = (p: string) =>
    paths.some((x) => {
      const lower = x.toLowerCase();
      return lower === p.toLowerCase() || lower.startsWith(`${p.toLowerCase()}/`);
    });

  const manifests = matchAllPaths(paths, MANIFESTS);
  const packageManager = matchFirst(paths, PKG_MANAGERS);

  let deps: string[] = [];
  let packageJsonReadable = false;
  if (packageJsonRaw !== null) {
    const parsed = parseJsonFile(packageJsonRaw);
    if (parsed !== null) {
      packageJsonReadable = true;
      deps = readDeps(parsed);
    }
  }

  // Frameworks are matched against the dependency list. When `package.json`
  // could not be read we deliberately return none rather than guessing from
  // directory names, because "there is a `src/`" does not mean there is React.
  const depSet = new Set(deps.map((d) => d.toLowerCase()));
  const frameworks = FRAMEWORK_DEPS.filter(([dep]) => depSet.has(dep)).map(([, label]) => label);

  const testFileCount = paths.filter((p) => TEST_PATH_RE.test(p)).length;
  const hasTests =
    testFileCount > 0 ||
    ["vitest", "jest", "playwright", "cypress", "pytest", "tox"].some((t) =>
      // `vitest` also matches `vitest.config.ts` and `vitest.workspace.ts`,
      // which is how a configured-but-unused runner is still recognised.
      Boolean(findPath(paths, t === "pytest" || t === "tox" ? `${t}.ini` : `${t}.config`)),
    );

  const apiStyle = frameworks.includes("Next.js")
    ? hasDir("src/app/api") || hasDir("app/api")
      ? "Next.js App Router API routes"
      : hasDir("src/pages/api") || hasDir("pages/api")
        ? "Next.js Pages API routes"
        : "Next.js (no API routes detected)"
    : frameworks.includes("Express")
      ? "Express routes"
      : frameworks.includes("Fastify")
        ? "Fastify routes"
        : frameworks.includes("NestJS")
          ? "NestJS controllers"
          : frameworks.includes("Django")
            ? "Django URLconf"
            : frameworks.includes("FastAPI")
              ? "FastAPI routers"
              : frameworks.includes("Ruby on Rails")
                ? "Rails controllers"
                : null;

  // A monorepo legitimately uses several of these at once (pnpm workspaces for
  // package linking, Turborepo for task running). Returning one arbitrarily
  // under-reported the tooling, so every detected tool is reported.
  const monorepoTools = matchAll(paths, [
    ["pnpm-workspace.yaml", "pnpm workspaces"],
    ["turbo.json", "Turborepo"],
    ["nx.json", "Nx"],
    ["lerna.json", "Lerna"],
    ["rush.json", "Rush"],
  ]);

  // --- Commit-derived facts -------------------------------------------------

  const areaCommits = new Map<string, number>();
  const fileCommits = new Map<string, { commits: number; last: string }>();
  const areaLast = new Map<string, string>();

  for (const c of commits) {
    for (const f of c.files) {
      if (!f) continue;
      const area = areaOf(f);
      areaCommits.set(area, (areaCommits.get(area) ?? 0) + 1);
      const prev = areaLast.get(area);
      if (!prev || c.date > prev) areaLast.set(area, c.date);

      const cur = fileCommits.get(f);
      fileCommits.set(f, {
        commits: (cur?.commits ?? 0) + 1,
        last: !cur || c.date > cur.last ? c.date : cur.last,
      });
    }
  }

  const highChurnAreas = [...areaCommits.entries()]
    .map(([area, n]) => ({ area, commits: n }))
    .sort((a, b) => b.commits - a.commits || a.area.localeCompare(b.area))
    .slice(0, 10);

  const frequentlyModifiedFiles = [...fileCommits.entries()]
    .map(([path, v]) => ({ path, commits: v.commits, lastTouchedAt: v.last }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, 10);

  // "Stale" is only claimed for areas the history actually proves went quiet.
  // An area missing from the sample is unknown, not stale, so it is excluded
  // rather than reported as abandoned.
  const staleAreas = [...areaLast.entries()]
    .map(([area, last]) => {
      const daysSince = Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000);
      return { area, lastTouchedAt: last, daysSince };
    })
    .filter((a) => a.daysSince >= 180)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 10);

  const dependencyCount = packageJsonReadable ? deps.length : null;

  return {
    packageManager,
    manifests,
    frameworks,
    dependencyCount,
    hasTypeScript: Boolean(findPath(paths, "tsconfig.json")),
    typeConfig: paths.find((p) => /(^|\/)tsconfig[\w.]*\.json$/i.test(p)) ?? null,
    testFramework: matchFirst(paths, TEST_FRAMEWORKS),
    testFileCount,
    hasTests,
    lintTool: matchFirst(paths, LINT_TOOLS),
    formatTool: matchFirst(paths, FORMAT_TOOLS),
    hasDocker:
      Boolean(findPath(paths, "Dockerfile")) ||
      Boolean(findPath(paths, "docker-compose")) ||
      hasDir("docker"),
    deploymentTargets: matchAll(paths, DEPLOYMENT_TARGETS),
    hasEnvExample: paths.some((p) => /(^|\/)\.env\.(example|sample|template)$/i.test(p)),
    orm: matchFirst(paths, ORMS),
    hasMigrations: hasDir("prisma/migrations") || hasDir("migrations") || hasDir("db/migrate"),
    apiStyle,
    monorepoTools,
    hasDocsDir: hasDir("docs"),
    securityTooling: matchAll(paths, SECURITY_TOOLING),
    totalFileCount: paths.length,
    highChurnAreas,
    frequentlyModifiedFiles,
    staleAreas,
    commitSampleSize: commits.length,
  };
}

/** `packageJsonReadable` is needed to distinguish "no deps" from "unreadable". */
export function isPackageJsonReadable(paths: string[], packageJsonRaw: string | null): boolean {
  return packageJsonRaw !== null && parseJsonFile(packageJsonRaw) !== null;
}

export interface StoredStructure {
  topLevel: string[];
  workflowNames: string[];
  profile: RepositoryProfile;
  /** Raw CODEOWNERS contents, or null. */
  codeowners: string | null;
}

/**
 * Read a stored `structure` JSON column into a shape consumers can rely on.
 *
 * Rows written before the profile existed have no `profile` key, so every
 * caller would otherwise need its own guard and a repository that predates the
 * upgrade would render with `undefined` scattered through the UI. Missing
 * profile resolves to `EMPTY_PROFILE`, which is falsy-safe: every consumer can
 * ask `profile.hasTests` and get `false` rather than a crash.
 */
export function readStructure(raw: string | null | undefined): StoredStructure {
  const empty: StoredStructure = { topLevel: [], workflowNames: [], profile: EMPTY_PROFILE, codeowners: null };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as (Partial<StoredStructure> & { codeowners?: unknown }) | null;
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      topLevel: Array.isArray(parsed.topLevel) ? parsed.topLevel : [],
      workflowNames: Array.isArray(parsed.workflowNames) ? parsed.workflowNames : [],
      profile: parsed.profile ?? EMPTY_PROFILE,
      codeowners: typeof parsed.codeowners === "string" ? parsed.codeowners : null,
    };
  } catch {
    return empty;
  }
}

/**
 * A profile with nothing known, used where a stored `structure` column predates
 * the profile (rows written before migration 0004) and as the shape every
 * consumer can rely on.
 */
export const EMPTY_PROFILE: RepositoryProfile = {
  packageManager: null,
  manifests: [],
  frameworks: [],
  dependencyCount: null,
  hasTypeScript: false,
  typeConfig: null,
  testFramework: null,
  testFileCount: 0,
  hasTests: false,
  lintTool: null,
  formatTool: null,
  hasDocker: false,
  deploymentTargets: [],
  hasEnvExample: false,
  orm: null,
  hasMigrations: false,
  apiStyle: null,
  monorepoTools: [],
  hasDocsDir: false,
  securityTooling: [],
  totalFileCount: 0,
  highChurnAreas: [],
  frequentlyModifiedFiles: [],
  staleAreas: [],
  commitSampleSize: 0,
};

/**
 * The subset of a profile that decides whether the stored revision should bump.
 *
 * Deliberately excludes churn, staleness and `commitSampleSize`. Those change on
 * effectively every collection run, and folding them in would bump the
 * repository revision on every sweep -- invalidating every stored briefing and
 * digest each time, which is the same as having no revision at all. Only the
 * structural facts, which change when a human changes the project, belong here.
 */
export function stableProfileKey(p: RepositoryProfile): string {
  return JSON.stringify({
    pm: p.packageManager,
    mf: p.manifests,
    fw: p.frameworks,
    dc: p.dependencyCount,
    ts: [p.hasTypeScript, p.typeConfig],
    test: [p.testFramework, p.testFileCount > 0, p.hasTests],
    lint: p.lintTool,
    fmt: p.formatTool,
    infra: [p.hasDocker, p.deploymentTargets, p.hasEnvExample],
    data: [p.orm, p.hasMigrations],
    api: p.apiStyle,
    mono: p.monorepoTools,
    docs: p.hasDocsDir,
    sec: p.securityTooling,
  });
}
