import { Badge } from "@/components/ui";
import { IconAlertCircle, IconBranch } from "@/components/icons";
import type { RepositoryProfile } from "@/lib/intelligence/profile";

/**
 * Renders the derived repository profile (aa.md §6).
 *
 * Every value here is read off the collected file tree and commit sample. The
 * panel separates three states that are easy to conflate and that a developer
 * acts on differently:
 *
 * - a fact ("Tests run with Vitest")
 * - the absence of a fact ("No test files were found")
 * - an unknown ("Change history was not readable")
 *
 * Rendering the third as the second would send someone to fix a repository that
 * Baton simply could not read.
 */
export function ProjectProfilePanel({ profile }: { profile: RepositoryProfile }) {
  const facts: { label: string; value: string }[] = [];

  if (profile.packageManager) facts.push({ label: "Package manager", value: profile.packageManager });
  if (profile.manifests.length > 0) {
    facts.push({ label: "Manifests", value: profile.manifests.join(", ") });
  }
  if (profile.frameworks.length > 0) {
    facts.push({ label: "Frameworks", value: profile.frameworks.join(", ") });
  }
  if (profile.dependencyCount !== null) {
    facts.push({ label: "Direct dependencies", value: String(profile.dependencyCount) });
  }
  if (profile.apiStyle) facts.push({ label: "HTTP surface", value: profile.apiStyle });
  if (profile.hasTypeScript) facts.push({ label: "Type safety", value: profile.typeConfig ?? "tsconfig.json" });
  if (profile.orm) facts.push({ label: "Data access", value: profile.orm });
  if (profile.hasMigrations) facts.push({ label: "Schema changes", value: "Tracked as migrations" });
  if (profile.lintTool) facts.push({ label: "Linting", value: profile.lintTool });
  if (profile.formatTool) facts.push({ label: "Formatting", value: profile.formatTool });
  if (profile.monorepoTools.length > 0) {
    facts.push({ label: "Monorepo tooling", value: profile.monorepoTools.join(", ") });
  }
  if (profile.deploymentTargets.length > 0) {
    facts.push({ label: "Deployment", value: profile.deploymentTargets.join(", ") });
  }
  if (profile.hasDocker) facts.push({ label: "Container build", value: "Dockerfile present" });
  if (profile.securityTooling.length > 0) {
    facts.push({ label: "Dependency security", value: profile.securityTooling.join(", ") });
  }
  facts.push({ label: "Files in default branch", value: String(profile.totalFileCount) });

  const churnKnown = profile.commitSampleSize > 0;

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
      <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
        <h2 className="text-sm font-semibold text-white">Derived Project Profile</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Read directly from the repository tree
          {churnKnown ? ` and the last ${profile.commitSampleSize} commits` : ""}.
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col">
            <dt className="font-mono text-[10px] uppercase tracking-wide text-ink-500">{f.label}</dt>
            <dd className="truncate text-xs text-ink-200" title={f.value}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-0 border-t border-white/[0.05] sm:grid-cols-3">
        <div className="p-4">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Test setup</span>
          {profile.testFramework ? (
            <p className="mt-1 text-xs text-ink-200">
              Runs on <span className="text-brand-300">{profile.testFramework}</span>
              {profile.testFileCount > 0 ? (
                <span className="text-ink-400"> &middot; {profile.testFileCount} test files</span>
              ) : null}
            </p>
          ) : profile.hasTests ? (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-warn-300">
              <IconAlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Test files exist but no runner is configured in the repository root.
            </p>
          ) : (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-signal-300">
              <IconAlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              No test files found in the default branch.
            </p>
          )}
        </div>

        <div className="border-t border-white/[0.05] p-4 sm:border-l sm:border-t-0">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Highest churn</span>
          {churnKnown && profile.highChurnAreas.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {profile.highChurnAreas.slice(0, 3).map((a) => (
                <li key={a.area} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-ink-300" title={a.area}>
                    {a.area}
                  </span>
                  <Badge tone="neutral">{a.commits}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-500">
              {churnKnown ? "No commits in the sample touched a shared area." : "Change history was not readable."}
            </p>
          )}
        </div>

        <div className="border-t border-white/[0.05] p-4 sm:border-l sm:border-t-0">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Quiet areas</span>
          {churnKnown && profile.staleAreas.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {profile.staleAreas.slice(0, 3).map((a) => (
                <li key={a.area} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-ink-300" title={a.area}>
                    {a.area}
                  </span>
                  <Badge tone="warn">{a.daysSince}d</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-500">
              {churnKnown ? "No area in the sample has been quiet for six months." : "Change history was not readable."}
            </p>
          )}
        </div>
      </div>

      {profile.hasEnvExample ? null : (
        <p className="flex items-start gap-2 border-t border-white/[0.05] px-5 py-3 text-[11px] text-ink-400">
          <IconBranch className="mt-0.5 h-3 w-3 shrink-0" />
          No example environment file is published, so required configuration has to be confirmed with a maintainer.
        </p>
      )}
    </section>
  );
}
