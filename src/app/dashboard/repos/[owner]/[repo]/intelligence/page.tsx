import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { intelligenceFor, evidenceByIds } from "@/lib/queries/intelligence";
import { loadDigest, saveDigest, buildDeveloperBriefing, type DigestBullet } from "@/lib/intelligence/briefing";
import { readStructure } from "@/lib/intelligence/profile";
import { ProjectProfilePanel } from "./project-profile";
import { WorkSignalList } from "./work-signals";
import { detectWorkSignals } from "@/lib/intelligence/work-detection";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { nextActionsFor } from "@/lib/intelligence/context";
import { whatBroke } from "@/lib/intelligence/whatbroke";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import {
  IconArrowLeft,
  IconExternalLink,
  IconGitHub,
  IconLayers,
  IconActivity,
  IconCheckCircle,
  IconAlertCircle,
} from "@/components/icons";
import { getOnboardingGuideForRepo } from "@/lib/intelligence/onboarding";
import { intelligenceAccess, UPGRADE_HREF } from "@/lib/intelligence/access";
import { FEATURE_KEYS } from "@/lib/billing/types";
import { IntelligenceQuestionForm } from "./question-form";

export const dynamic = "force-dynamic";

/** Flags rendered as present/absent, with the evidence that establishes each. */
const FLAG_ROWS: { key: keyof IntelligenceFlags; label: string; absent: string }[] = [
  { key: "readme", label: "README", absent: "No README in the default branch" },
  { key: "codeowners", label: "CODEOWNERS", absent: "No CODEOWNERS file" },
  { key: "contributing", label: "CONTRIBUTING", absent: "No CONTRIBUTING guide" },
  { key: "ci", label: "CI workflows", absent: "No GitHub Actions workflows" },
  { key: "securityPolicy", label: "Security policy", absent: "No SECURITY.md" },
  { key: "license", label: "License", absent: "No license file" },
];

type IntelligenceFlags = {
  readme: boolean;
  codeowners: boolean;
  contributing: boolean;
  ci: boolean;
  securityPolicy: boolean;
  license: boolean;
};

function hoursSince(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 3_600_000));
}

export default async function IntelligencePage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { owner, repo } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const currentTab = resolvedSearchParams?.tab === "onboarding" ? "onboarding" : "profile";

  const user = await currentUser();
  if (!user) return null;

  // Returns null when the user cannot see the repository OR when it has not been
  // collected yet; both are handled below without leaking the difference.
  // This gate must come before any per-repository read: fetching onboarding
  // content first would do work on, and hand a view model for, a repository the
  // user is about to be refused.
  const view = await intelligenceFor(user, owner, repo);
  if (!view) notFound();

  // Plan gate. Deliberately *after* the authorization check: an upgrade panel
  // shown to someone who cannot see the repository would confirm it exists.
  const access = await intelligenceAccess(user.id, FEATURE_KEYS.repoIntelligence);
  if (!access.allowed) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Repository intelligence"
          description={`${owner}/${repo}`}
        />
        <EmptyState
          title="Repository intelligence is a paid capability"
          hint={`${access.label} is included with the Team plan. Your current plan does not include it.`}
          action={
            <Link href={UPGRADE_HREF} className="btn btn-primary btn-sm">
              View plans
            </Link>
          }
        />
      </div>
    );
  }

  const onboardingGuide = currentTab === "onboarding" ? await getOnboardingGuideForRepo(user, owner, repo) : null;

  const githubRepoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // The briefing is rendered on demand from the current revision rather than
  // read from a possibly-stale digest row, so what is shown always matches the
  // facts displayed beside it.
  const profileForBriefing = await prisma.repositoryInsight.findUniqueOrThrow({
    where: { repoId: view.repo.id },
    include: { evidence: { select: { id: true, kind: true, label: true, rank: true } } },
  });

  const structureProfile = readStructure(profileForBriefing.structure).profile;

  // Work signals are proposed, never auto-saved (aa.md §17), so this read is
  // safe to run on every render of the tab.
  const workSignals = await detectWorkSignals(user, view.repo.id);

  const openPrs = await prisma.pullRequest.findMany({
    where: { repoId: view.repo.id, githubState: "OPEN", isDraft: false },
    select: { number: true, title: true, url: true, stateEnteredAt: true },
    orderBy: { stateEnteredAt: "asc" },
    take: 100,
  });

  const briefing = buildDeveloperBriefing(profileForBriefing, {
    days: 3,
    openPrs: openPrs.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      ageDays: Math.floor((Date.now() - p.stateEnteredAt.getTime()) / 86_400_000),
    })),
  });

  const actions = await nextActionsFor(user.id, view.repo.id);
  const savedDigest = await loadDigest(view.repo.id, "developer_briefing", "main");

  // Persist the briefing at the revision it was rendered from, so the "cached"
  // indicator below reflects a real stored digest rather than a lookup that can
  // only ever miss. `saveDigest` is idempotent per (user, repo, kind, slot,
  // revision), and a new revision replaces the old row rather than accumulating.
  await saveDigest(view.repo.id, "developer_briefing", { ...briefing, userId: user.id })
    .catch((e) => logger.warn("repo-intel-digest-save-failed", { owner, repo, error: String(e) }));

  // "What Broke?" for the pull requests that are actually failing. Read from
  // the check runs Baton already recorded, so this is never a re-guess of a
  // build that has since changed.
  const failing = await prisma.pullRequest.findMany({
    where: { repoId: view.repo.id, githubState: "OPEN", isDraft: false, state: "ci_failing" },
    select: { number: true },
    orderBy: { number: "desc" },
    take: 10,
  });
  const broken = (await Promise.all(failing.map((p) => whatBroke(user.id, owner, repo, p.number)))).filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

  // Resolve every evidence id referenced by the briefing in one query.
  const bulletEvidence = await evidenceByIds(briefing.bullets.flatMap((b) => b.evidenceIds));

  return (
    <div className="space-y-8">
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
          <span className="text-ink-400">Intelligence</span>
        </div>

        <PageHeader
          title={`${owner}/${repo} intelligence`}
          description={`Facts collected from GitHub at revision ${view.insight.revision}, ${hoursSince(view.insight.collectedAt)}h ago. Every claim below links to the file or API response it came from.`}
          actions={
            <div className="flex items-center gap-2">
              <a href={githubRepoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                <IconGitHub className="h-3.5 w-3.5" />
                <span>GitHub</span>
                <IconExternalLink className="h-3 w-3" />
              </a>
            </div>
          }
        />
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <Link
          href={`/dashboard/repos/${owner}/${repo}/intelligence`}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            currentTab !== "onboarding"
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-ink-400 hover:text-white"
          }`}
        >
          Intelligence Profile & Grounded Q&A
        </Link>
        <Link
          href={`/dashboard/repos/${owner}/${repo}/intelligence?tab=onboarding`}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            currentTab === "onboarding"
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-ink-400 hover:text-white"
          }`}
        >
          Developer Onboarding Guide
        </Link>
      </div>

      {currentTab === "onboarding" && onboardingGuide ? (
        <div className="space-y-8">
          {/* Possible unfinished work (aa.md §17) */}
          <WorkSignalList owner={owner} repo={repo} signals={workSignals} />

          {/* Derived project profile (aa.md §6) */}
          <ProjectProfilePanel profile={structureProfile} />

          {/* Tech Stack & System Summary */}
          <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div>
                <h2 className="text-base font-bold text-white">System Architecture & Tech Stack</h2>
                <p className="mt-0.5 text-xs text-ink-400">{onboardingGuide.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="info">{onboardingGuide.techStack.primaryLanguage}</Badge>
                <Badge tone="neutral">{onboardingGuide.techStack.packageManager}</Badge>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {onboardingGuide.architectureMap.map((mod, i) => (
                <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-white">{mod.name}</span>
                    <Badge tone={mod.importance === "critical" ? "warn" : mod.importance === "high" ? "info" : "neutral"}>
                      {mod.importance}
                    </Badge>
                  </div>
                  <code className="text-[11px] font-mono text-brand-300 block">{mod.path}</code>
                  <p className="text-[11px] text-ink-400 leading-normal">{mod.role}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Setup & Run Workflow */}
          <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
            <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">1. Local Setup Workflow</h2>
              <p className="mt-0.5 text-xs text-ink-500">Step-by-step commands to get a working local development environment.</p>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {onboardingGuide.setupWorkflow.map((step) => (
                <div key={step.step} className="p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-mono text-xs font-bold">
                      {step.step}
                    </span>
                    <span className="text-sm font-semibold text-white">{step.title}</span>
                  </div>
                  <p className="text-xs text-ink-300 ml-7 leading-relaxed">{step.description}</p>
                  {step.command ? (
                    <div className="ml-7 mt-2">
                      <pre className="rounded-lg border border-white/[0.06] bg-ink-950/80 px-3.5 py-2 font-mono text-xs text-brand-200 overflow-x-auto">
                        {step.command}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {/* Testing & Verification Workflow */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">2. Testing & Quality Gates</h3>
              <p className="text-xs text-ink-300 leading-relaxed">{onboardingGuide.testingWorkflow.details}</p>
              <div className="rounded-lg border border-white/[0.06] bg-ink-950/80 p-3">
                <span className="text-[10px] font-mono text-ink-500 uppercase">Framework:</span>
                <p className="text-xs font-bold text-white mt-0.5">{onboardingGuide.testingWorkflow.testFramework}</p>
                <div className="mt-2 font-mono text-xs text-brand-300 bg-white/[0.03] p-2 rounded">
                  {onboardingGuide.testingWorkflow.command}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">3. CI & Deployment Automation</h3>
              <p className="text-xs text-ink-300 leading-relaxed">{onboardingGuide.deployWorkflow.details}</p>
              <div className="rounded-lg border border-white/[0.06] bg-ink-950/80 p-3 space-y-1.5">
                <span className="text-[10px] font-mono text-ink-500 uppercase">Provider:</span>
                <p className="text-xs font-bold text-white">{onboardingGuide.deployWorkflow.ciProvider}</p>
                {onboardingGuide.deployWorkflow.workflows.length > 0 ? (
                  <div className="pt-1">
                    <span className="text-[10px] font-mono text-ink-500">Configured Workflows:</span>
                    <ul className="mt-1 space-y-1">
                      {onboardingGuide.deployWorkflow.workflows.map((w, i) => (
                        <li key={i} className="text-xs font-mono text-ink-300">&bull; {w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* Recommended Reading & Common Pitfalls */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
              <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
                <h3 className="text-sm font-semibold text-white">Recommended Reading</h3>
              </div>
              <ul className="divide-y divide-white/[0.05]">
                {onboardingGuide.readingList.map((item, i) => (
                  <li key={i} className="p-4 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{item.title}</span>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:underline flex items-center gap-1 font-mono text-[11px]">
                          {item.path}
                          <IconExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="font-mono text-ink-500 text-[11px]">{item.path}</span>
                      )}
                    </div>
                    <p className="text-ink-400 text-[11px] leading-relaxed">{item.reason}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
              <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
                <h3 className="text-sm font-semibold text-white">Common Pitfalls & Architectural Traps</h3>
              </div>
              <ul className="divide-y divide-white/[0.05]">
                {onboardingGuide.pitfalls.map((pit, i) => (
                  <li key={i} className="p-4 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-warn-300">{pit.pitfall}</span>
                      <Badge tone="warn">{pit.severity}</Badge>
                    </div>
                    <p className="text-ink-300 text-[11px] leading-relaxed">&rarr; {pit.recommendation}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Key Owners */}
          {onboardingGuide.keyOwners.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">Domain Maintainers & Active Contributors</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {onboardingGuide.keyOwners.map((ownerItem, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-white">@{ownerItem.login}</span>
                      <p className="text-[10px] text-ink-500 font-mono">{ownerItem.commits} recent commits</p>
                    </div>
                    <a
                      href={`https://github.com/${ownerItem.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm text-xs"
                    >
                      GitHub
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          {actions.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
              <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
                <IconActivity className="h-4 w-4 text-brand-300" />
                <h2 className="text-sm font-semibold text-white">Waiting on you</h2>
                <span className="font-mono text-xs text-ink-500">({actions.length})</span>
              </div>
              <ul className="divide-y divide-white/[0.05]">
                {actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{a.label}</p>
                      <p className="text-xs text-ink-400">{a.reason}</p>
                    </div>
                    <Link href={a.href} className="btn btn-ghost btn-sm">
                      Open
                      <IconArrowLeft className="h-3 w-3 rotate-180" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

      {briefing.bullets.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <IconLayers className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold text-white">{briefing.title}</h2>
            <span className="ml-auto font-mono text-[10px] text-ink-500">
              {savedDigest ? `cached r${savedDigest.revision}` : `rendered r${briefing.revision}`}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {briefing.bullets.map((b: DigestBullet, i: number) => (
              <li key={i} className="px-5 py-3.5">
                <div className="flex items-start gap-2.5">
                  {b.tone === "risk" ? (
                    <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-300" />
                  ) : b.tone === "positive" ? (
                    <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                  ) : (
                    <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-ink-100">{b.text}</p>
                    {b.evidenceIds.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {b.evidenceIds.slice(0, 4).map((id) => {
                          const ev = bulletEvidence.get(id);
                          if (!ev) return null;
                          return ev.url ? (
                            <a
                              key={id}
                              href={ev.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-ink-950/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 transition-colors hover:text-brand-300"
                            >
                              {ev.path ?? ev.kind}
                              <IconExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ) : (
                            <span
                              key={id}
                              className="inline-flex items-center rounded border border-white/[0.06] bg-ink-950/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-500"
                            >
                              {ev.kind}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          icon={IconLayers}
          title="No evidence-backed observations yet"
          hint="Nothing in the collected profile can be cited for this repository, so no briefing is shown rather than a guess."
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <h2 className="text-sm font-semibold text-white">Project health</h2>
          </div>
          <dl className="divide-y divide-white/[0.05]">
            {FLAG_ROWS.map((row) => {
              const present = view.insight.flags[row.key];
              const ev = view.evidence.find((e) =>
                row.key === "readme"
                  ? e.kind === "readme"
                  : row.key === "codeowners"
                    ? e.kind === "codeowners"
                    : row.key === "contributing"
                      ? e.kind === "contributing"
                      : row.key === "ci"
                        ? e.kind === "workflow"
                        : row.key === "securityPolicy"
                          ? e.kind === "security"
                          : e.kind === "license",
              );
              return (
                <div key={row.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <dt className="text-sm text-ink-300">{row.label}</dt>
                  <dd>
                    {present ? (
                      <span className="inline-flex items-center gap-1.5">
                        {ev?.url ? (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-signal-400 hover:underline"
                          >
                            present
                            <IconExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-signal-400">present</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-500">{row.absent}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <h2 className="text-sm font-semibold text-white">Activity</h2>
          </div>
          <dl className="divide-y divide-white/[0.05]">
            <Row label="Open pull requests" value={String(view.insight.counts.openPullRequests)} />
            <Row label="Open issues" value={String(view.insight.counts.openIssues)} />
            <Row
              label="Merged, last 30 days"
              value={
                view.insight.counts.mergedLast30Days === null
                  ? "not available"
                  : String(view.insight.counts.mergedLast30Days)
              }
            />
            <Row label="Recent contributors" value={String(view.insight.counts.contributors)} />
            <Row
              label="Latest release"
              value={view.insight.lastReleaseTag ?? "none published"}
            />
            <Row
              label="Default branch"
              value={view.insight.defaultBranch ?? "unknown"}
            />
            <Row label="Collected" value={`${hoursSince(view.insight.collectedAt)}h ago`} />
          </dl>
        </section>
      </div>

      {view.insight.languages.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <h2 className="text-sm font-semibold text-white">Languages</h2>
            <p className="mt-0.5 text-xs text-ink-500">Share of bytes detected by GitHub.</p>
          </div>
          <ul className="space-y-2.5 px-5 py-4">
            {view.insight.languages.map((l) => (
              <li key={l.name} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-300">{l.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    className="block h-full rounded-full bg-brand-400/70"
                    style={{ width: `${Math.min(100, Math.max(2, l.percent))}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ink-400">
                  {Math.round(l.percent)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {broken.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
          <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <IconAlertCircle className="h-4 w-4 text-warn-300" />
            <h2 className="text-sm font-semibold text-white">What broke?</h2>
            <span className="font-mono text-xs text-ink-500">({broken.length})</span>
            <span className="ml-auto text-[10px] text-ink-500">from recorded check runs</span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {broken.map((b) => (
              <li key={b.prNumber} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={b.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-semibold text-white transition-colors hover:text-brand-300"
                  >
                    #{b.prNumber} {b.prTitle}
                  </a>
                  <IconExternalLink className="h-3 w-3 text-ink-500" />
                  <span className="ml-auto font-mono text-[10px] text-ink-500">
                    {b.failedChecks.length} failing / {b.pendingChecks.length} pending /{" "}
                    {b.passedChecks.length} passed
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {b.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-ink-300">
                      <span
                        className={
                          bullet.tone === "risk"
                            ? "mt-1 h-1 w-1 shrink-0 rounded-full bg-warn-400"
                            : bullet.tone === "positive"
                              ? "mt-1 h-1 w-1 shrink-0 rounded-full bg-signal-400"
                              : "mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-600"
                        }
                      />
                      {bullet.text}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <IntelligenceQuestionForm owner={owner} repo={repo} />

      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <h2 className="text-sm font-semibold text-white">Evidence ({view.evidence.length})</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Every source this page is built from. Nothing is asserted without one of these.
          </p>
        </div>
        {view.evidence.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No evidence was collected for this repository.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {view.evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Badge tone="neutral">{e.kind}</Badge>
                  <span className="truncate text-sm text-ink-200">{e.label}</span>
                </div>
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm shrink-0"
                  >
                    {e.path ?? "source"}
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-ink-600">{e.ref ?? "api"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-sm text-ink-300">{label}</dt>
      <dd className="font-mono text-xs text-white">{value}</dd>
    </div>
  );
}
