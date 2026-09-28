import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { getSmartPrContext } from "@/lib/intelligence/pr-context";
import { STATE_META } from "@/lib/engine/types";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import {
  IconArrowLeft,
  IconExternalLink,
  IconGitHub,
  IconGitPullRequest,
  IconCheckCircle,
  IconAlertCircle,
  IconClock,
  IconActivity,
  IconBranch,
  IconLayers,
} from "@/components/icons";
import { SaveContextButton } from "./context-button";
import { intelligenceAccess, UPGRADE_HREF } from "@/lib/intelligence/access";
import { FEATURE_KEYS } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

export default async function SmartPrContextPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const { owner, repo, number: rawNumber } = await params;
  const prNumber = parseInt(rawNumber, 10);
  if (Number.isNaN(prNumber) || prNumber <= 0) notFound();

  const user = await currentUser();
  if (!user) return null;

  const view = await getSmartPrContext(user, owner, repo, prNumber);
  if (!view) notFound();

  // Plan gates. The page itself needs repository intelligence; the impact
  // analysis and CI investigation panels are a separate, higher tier.
  const intelAccess = await intelligenceAccess(user.id, FEATURE_KEYS.repoIntelligence);
  const impactAccess = await intelligenceAccess(user.id, FEATURE_KEYS.changeImpact);
  const canSeeImpact = intelAccess.allowed && impactAccess.allowed;

  if (!intelAccess.allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title={`#${prNumber} ${view.pr.title}`} description={`${owner}/${repo}`} />
        <EmptyState
          title="Pull request context is a paid capability"
          hint={`${intelAccess.label} is included with the Team plan. Your current plan does not include it.`}
          action={
            <Link href={UPGRADE_HREF} className="btn btn-primary btn-sm">
              View plans
            </Link>
          }
        />
      </div>
    );
  }

  const meta = (STATE_META as Record<string, any>)[view.pr.state] ?? {
    label: view.pr.state,
    tone: "neutral" as const,
    description: "",
  };

  const hoursInState = Math.max(0, Math.floor((Date.now() - view.pr.stateEnteredAt.getTime()) / 3_600_000));

  return (
    <div className="space-y-8">
      {/* Navigation Breadcrumb */}
      <div>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-ink-400">
          <Link
            href={`/dashboard/repos/${owner}/${repo}`}
            className="flex items-center gap-1 text-ink-400 transition-colors hover:text-white"
          >
            <IconArrowLeft className="h-3 w-3" />
            <span>{owner}/{repo}</span>
          </Link>
          <span className="text-ink-600">/</span>
          <span className="text-ink-400">pulls</span>
          <span className="text-ink-600">/</span>
          <span className="font-semibold text-white">#{prNumber}</span>
        </div>

        <PageHeader
          badge={<Badge tone={meta.tone}>{meta.label}</Badge>}
          title={`#${prNumber} ${view.pr.title}`}
          description={`Opened by @${view.pr.authorLogin} &middot; ${view.pr.headRef} into ${view.pr.baseRef} &middot; In state for ${hoursInState}h`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SaveContextButton
                owner={owner}
                repo={repo}
                prNumber={prNumber}
                title={view.pr.title}
                isPreserved={view.isPreservedContext}
                existingContextId={view.preservedContextId}
              />
              <a
                href={view.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <IconGitHub className="h-3.5 w-3.5" />
                <span>GitHub PR</span>
                <IconExternalLink className="h-3 w-3" />
              </a>
            </div>
          }
        />
      </div>

      {/* Snapshot metadata. Every field here is read straight from the persisted
          pull request row, so nothing shown here is inferred. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-500">
            <IconGitPullRequest className="h-3 w-3" />
            <span>GitHub state</span>
          </div>
          <p className="mt-1 font-mono text-sm text-white">
            {view.pr.githubState}
            {view.pr.isDraft ? " (draft)" : ""}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-500">
            <IconClock className="h-3 w-3" />
            <span>Time in state</span>
          </div>
          <p className="mt-1 font-mono text-sm text-white">{hoursInState}h</p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-500">
            <IconBranch className="h-3 w-3" />
            <span>Branch</span>
          </div>
          <p className="mt-1 truncate font-mono text-sm text-white">
            {view.pr.headRef} &rarr; {view.pr.baseRef}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-500">
            <IconActivity className="h-3 w-3" />
            <span>Last GitHub update</span>
          </div>
          <p className="mt-1 font-mono text-sm text-white">
            {view.pr.githubUpdatedAt.toISOString().slice(0, 10)}
          </p>
        </div>
      </div>

      {view.pr.labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {view.pr.labels.map((label) => (
            <Badge key={label} tone="neutral">
              {label}
            </Badge>
          ))}
        </div>
      )}

      {/* Recommended Next Actions */}
      {view.nextActions.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-brand-500/20 bg-brand-500/[0.04]">
          <div className="flex items-center gap-2.5 border-b border-brand-500/20 bg-brand-500/10 px-5 py-3">
            <IconActivity className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold text-white">Recommended Next Action</h2>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {view.nextActions.map((action, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{action.label}</p>
                  <p className="mt-1 text-xs text-ink-300 leading-relaxed">{action.description}</p>
                </div>
                <a
                  href={action.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm shrink-0"
                >
                  <span>Take Action</span>
                  <IconExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Review Brief */}
      {view.reviewBrief && view.reviewBrief.bullets.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <IconLayers className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold text-white">{view.reviewBrief.title}</h2>
            <span className="ml-auto font-mono text-[10px] text-ink-500">
              evidence-backed review context
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {view.reviewBrief.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 px-5 py-3.5">
                {b.tone === "risk" ? (
                  <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
                ) : b.tone === "positive" ? (
                  <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                ) : (
                  <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-ink-100">{b.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* What Broke? (If CI Failing) */}
      {view.whatBroke && (view.whatBroke.failedChecks.length > 0 || view.whatBroke.bullets.length > 0) ? (
        <section className="overflow-hidden rounded-xl border border-warn-500/30 bg-warn-500/[0.04]">
          <div className="flex items-center gap-2.5 border-b border-warn-500/20 bg-warn-500/10 px-5 py-3">
            <IconAlertCircle className="h-4 w-4 text-warn-300" />
            <h2 className="text-sm font-semibold text-white">What Broke? CI Failure Investigation</h2>
            <span className="ml-auto font-mono text-[10px] text-warn-300">
              {view.whatBroke.failedChecks.length} failing check run{view.whatBroke.failedChecks.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="p-5 space-y-4">
            <ul className="space-y-2">
              {view.whatBroke.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-ink-200">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-warn-400 shrink-0" />
                  <span>{bullet.text}</span>
                </li>
              ))}
            </ul>
            {view.whatBroke.failedChecks.length > 0 ? (
              <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.08] bg-ink-950/60">
                {view.whatBroke.failedChecks.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-3 text-xs">
                    <div>
                      <span className="font-semibold text-white">{c.name}</span>
                      {c.appSlug ? <span className="ml-2 text-ink-500">via {c.appSlug}</span> : null}
                      <span className="ml-2 text-warn-400 font-mono">({c.conclusion})</span>
                    </div>
                    {c.detailsUrl ? (
                      <a
                        href={c.detailsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm text-[11px]"
                      >
                        <span>View Build Log</span>
                        <IconExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Change Impact Analysis */}
      {canSeeImpact && view.impactAnalysis && view.impactAnalysis.areas.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <div className="flex items-center gap-2">
              <IconBranch className="h-4 w-4 text-brand-300" />
              <h2 className="text-sm font-semibold text-white">Change Impact Analysis</h2>
            </div>
            <Badge
              tone={
                view.impactAnalysis.overallRisk === "critical"
                  ? "warn"
                  : view.impactAnalysis.overallRisk === "high"
                  ? "warn"
                  : "neutral"
              }
            >
              Risk: {view.impactAnalysis.overallRisk.toUpperCase()}
            </Badge>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-xs text-ink-300 leading-relaxed">{view.impactAnalysis.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.impactAnalysis.areas.map((area, i) => (
                <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{area.name}</span>
                    <span className="font-mono text-[10px] uppercase text-ink-400">
                      {area.files.length} file{area.files.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {area.reasons.map((r, ri) => (
                      <li key={ri} className="text-[11px] text-ink-400 leading-normal">
                        &bull; {r}
                      </li>
                    ))}
                  </ul>
                  {area.affectedTests.length > 0 ? (
                    <div className="pt-1">
                      {/* Inferred from naming convention, never verified to
                          exist -- so this is worded as a place to look. */}
                      <span className="text-[10px] font-mono text-ink-500">
                        Tests likely covering this (inferred, unverified):
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {area.affectedTests.map((t, ti) => (
                          <code key={ti} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-brand-300 font-mono">
                            {t}
                          </code>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : !impactAccess.allowed ? (
        <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Change impact analysis</h2>
          <p className="mt-1.5 text-xs text-ink-400">
            {impactAccess.label} is included with the Organization plan.
          </p>
          <Link href={UPGRADE_HREF} className="btn btn-ghost btn-sm mt-3">
            View plans
          </Link>
        </section>
      ) : null}

      {/* Facts vs Inferences Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* FACTS Section */}
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal-400" />
              <h2 className="text-sm font-semibold text-white">Confirmed Facts</h2>
            </div>
            <span className="font-mono text-[10px] text-ink-500">Verifiable GitHub data</span>
          </div>
          {view.facts.length === 0 ? (
            <EmptyState
              title="No confirmed facts recorded"
              hint="Nothing has been collected for this pull request yet, so there is nothing to state as fact."
            />
          ) : (
            <dl className="divide-y divide-white/[0.05]">
              {view.facts.map((fact) => (
                <div key={fact.id} className="flex items-center justify-between gap-3 px-5 py-3 text-xs">
                  <div>
                    <dt className="text-ink-400 font-medium">{fact.label}</dt>
                    <span className="font-mono text-[10px] text-ink-600">{fact.category}</span>
                  </div>
                  <dd className="font-mono text-white text-right">
                    {fact.evidenceUrl ? (
                      <a
                        href={fact.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-brand-300"
                      >
                        <span>{fact.value}</span>
                        <IconExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* INFERENCES Section */}
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand-400" />
              <h2 className="text-sm font-semibold text-white">Architectural Inferences</h2>
            </div>
            <span className="font-mono text-[10px] text-brand-300">Derived heuristics</span>
          </div>
          {view.inferences.length === 0 ? (
            <p className="p-5 text-xs text-ink-500">
              No architectural inferences or risk markers derived for this pull request.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {view.inferences.map((inf) => (
                <li key={inf.id} className="p-5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{inf.claim}</span>
                    <span className="font-mono text-[10px] text-brand-300 uppercase">
                      {inf.confidence} confidence
                    </span>
                  </div>
                  <p className="text-ink-400 leading-relaxed text-[11px]">&bull; Basis: {inf.basis}</p>
                  {inf.suggestedAction ? (
                    <p className="text-brand-300/90 text-[11px] font-medium">
                      &rarr; Suggestion: {inf.suggestedAction}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
