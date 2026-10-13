import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  WORKFLOW_LABELS,
  WORKFLOW_ORDER,
  runWorkflows,
  type WorkflowFinding,
  type WorkflowKind,
  type WorkflowRun,
} from "@/lib/workflows/automation";
import { releaseReadinessFor, type ReleaseReadiness } from "@/lib/workflows/release";
import { Badge, EmptyState } from "@/components/ui";
import { formatRelative } from "@/lib/i18n/format";

/**
 * The automations surface: every workflow's findings for one repository.
 *
 * Why findings are rendered from the stored run rather than recomputed here
 * 
 * The suite runs in the background (§25: expensive analysis must not block a
 * user request), so the page reads `RepoAutomationRun`. A repository whose run
 * has not happened yet gets an explicit "not analysed yet" state rather than an
 * empty list, "we found nothing" and "we have not looked" are different claims,
 * and showing the second as the first is how a monitoring surface becomes
 * actively misleading.
 *
 * Why FACT and INFERENCE are rendered as distinct badges
 * 
 * §11 forbids presenting AI-derived assumptions as confirmed facts. Each finding
 * carries the confidence its workflow assigned, so the badge is a property of the
 * finding rather than a styling choice. `speculative` findings additionally show
 * their basis inline, because the basis of a similarity score is the only way to
 * argue with it.
 */

export interface AutomationPanelProps {
  owner: string;
  repo: string;
}

/**
 * Badge tone per confidence level.
 *
 * `observed` is the only one rendered as `success`, so a screen full of facts
 * reads differently from a screen full of inferences. `warn` on `speculative` is
 * intentional: these are the findings a user should treat as leads to check, not
 * as conclusions.
 */
const CONFIDENCE_TONE = {
  observed: { tone: "success" as const, label: "Fact" },
  derived: { tone: "info" as const, label: "Derived" },
  speculative: { tone: "warn" as const, label: "Inference" },
};

function parseRuns(raw: string): WorkflowRun[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : [];
  } catch {
    return [];
  }
}

export async function AutomationPanel({ owner, repo }: AutomationPanelProps) {
  const stored = await prisma.repoAutomationRun.findFirst({
    where: { repo: { owner, name: repo } },
    select: { runsJson: true, ranAt: true, findingCount: true },
    orderBy: { ranAt: "desc" },
  });

  if (!stored) {
    return (
      <EmptyState
        title="Not analysed yet"
        hint="Automation runs in the background. Findings appear here once the first run completes; a repository that has never been analysed is not a repository with nothing to report."
      />
    );
  }

  const runs = parseRuns(stored.runsJson);
  const readiness = await releaseReadinessFor(
    (
      await prisma.repo.findFirst({ where: { owner, name: repo }, select: { id: true } })
    )?.id ?? "",
  ).catch((e) => {
    logger.warn("release-readiness-failed", { owner, repo, error: String(e) });
    return null;
  });

  const byKind = new Map<WorkflowKind, WorkflowRun>();
  for (const run of runs) byKind.set(run.kind, run);

  const ordered = WORKFLOW_ORDER.map((kind) => ({ kind, run: byKind.get(kind) })).filter(
    (entry): entry is { kind: WorkflowKind; run: WorkflowRun } => entry.run !== undefined,
  );
  const withFindings = ordered.filter((e) => e.run.findings.length > 0);
  const quiet = ordered.filter((e) => e.run.findings.length === 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-white">Automations</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          {stored.findingCount} finding{stored.findingCount === 1 ? "" : "s"} across{" "}
          {ordered.length} workflow{ordered.length === 1 ? "" : "s"}, last run{" "}
          {formatRelative(stored.ranAt, "en")}. Findings are proposals: nothing here has been
          actioned on GitHub.
        </p>
      </div>

      {readiness ? <ReleasePanel readiness={readiness} /> : null}

      {withFindings.length === 0 ? (
        <EmptyState
          title="No findings"
          hint="Every workflow ran and none of them matched the thresholds in use. That is a clean result, not an absence of analysis."
        />
      ) : (
        <div className="space-y-4">
          {withFindings.map(({ kind, run }) => (
            <WorkflowSection key={kind} kind={kind} run={run} />
          ))}
        </div>
      )}

      {quiet.length > 0 && (
        <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60">
          <div className="border-b border-hairline px-5 py-3">
            <h3 className="text-xs font-semibold text-ink-300">Ran clean ({quiet.length})</h3>
            <p className="mt-0.5 text-[11px] text-ink-500">
              These workflows executed and matched nothing. Listed so a missing section is never mistaken for
              a workflow that did not run.
            </p>
          </div>
          <ul className="divide-y divide-hairline">
            {quiet.map(({ kind, run }) => (
              <li key={kind} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs">
                <span className="text-ink-400">{WORKFLOW_LABELS[kind]}</span>
                <span className="font-mono text-[10px] text-ink-600">
                  {run.unavailable ?? "no findings"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WorkflowSection({ kind, run }: { kind: WorkflowKind; run: WorkflowRun }) {
  return (
    <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h3 className="text-xs font-semibold text-white">{WORKFLOW_LABELS[kind]}</h3>
        <span className="font-mono text-[10px] text-ink-500">{run.findings.length}</span>
      </div>
      <ul className="divide-y divide-hairline">
        {run.findings.map((f) => (
          <FindingRow key={f.id} finding={f} />
        ))}
      </ul>
    </section>
  );
}

function FindingRow({ finding }: { finding: WorkflowFinding }) {
  const confidence = CONFIDENCE_TONE[finding.confidence];
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white">{finding.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{finding.basis}</p>
          {finding.actors.length > 0 && (
            <p className="mt-1 font-mono text-[10px] text-ink-500">
              {finding.actors.map((a) => (a.startsWith("@") ? a : `@${a}`)).join(" ")}
            </p>
          )}
          {finding.paths.length > 0 && (
            <p className="mt-1 break-all font-mono text-[10px] text-ink-600">
              {finding.paths.slice(0, 4).join("  ")}
              {finding.paths.length > 4 ? `  +${finding.paths.length - 4}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={confidence.tone}>{confidence.label}</Badge>
          {finding.href ? (
            <a
              href={finding.href}
              className="font-mono text-[10px] text-brand-300 transition-colors hover:text-brand-200"
            >
              open
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ReleasePanel({ readiness }: { readiness: ReleaseReadiness }) {
  return (
    <section className="overflow-hidden rounded-panel border border-hairline bg-ink-900/60">
      <div className="border-b border-hairline px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Release preparation</h3>
        <p className="mt-0.5 text-xs text-ink-400">{readiness.headline}</p>
      </div>

      {readiness.blockers.length > 0 && (
        <div className="border-b border-hairline bg-danger-500/[0.04] px-5 py-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-danger-300">
            Check before shipping ({readiness.blockers.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {readiness.blockers.map((b, i) => (
              <li key={i}>
                <p className="text-xs text-white">{b.text}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{b.basis}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="divide-y divide-hairline">
        {readiness.sections.map((s) => (
          <div key={s.key} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-xs font-semibold text-white">{s.title}</h4>
              {s.items.length > 0 && (
                <span className="shrink-0 font-mono text-[10px] text-ink-500">{s.items.length}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{s.basis}</p>
            {s.items.length > 0 && (
              <ul className="mt-2 space-y-1">
                {s.items.map((item, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[11px]">
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 font-mono text-brand-300 hover:text-brand-200"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <span className="shrink-0 font-mono text-ink-300">{item.label}</span>
                    )}
                    <span className="min-w-0 truncate text-ink-400">{item.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export { runWorkflows };
