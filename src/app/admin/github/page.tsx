import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconGitHub,
  IconBranch,
  IconGitPullRequest,
  IconActivity,
  IconArrowLeft,
  IconExternalLink,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "GitHub Integrations: Baton Admin",
};

export default async function AdminGithubPage() {
  const [installs, repos, prs, webhooks, actions] = await Promise.all([
    prisma.appInstallation.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        accountLogin: true,
        accountType: true,
        uninstalledAt: true,
        createdAt: true,
        _count: { select: { repos: true } },
      },
    }),
    prisma.repo.count(),
    prisma.pullRequest.count({ where: { githubState: { not: "MERGED" } } }),
    prisma.webhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take: 12,
      select: { id: true, eventType: true, receivedAt: true, processedAt: true },
    }),
    prisma.action.count(),
  ]);

  const activeInstalls = installs.filter((i) => !i.uninstalledAt).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin &middot; Integrations"
        title="GitHub Integrations &amp; Pipeline"
        description="Real-time status of connected GitHub App installations, tracked repositories, and webhook ingestion events."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Active Installations"
          value={activeInstalls}
          detail={`${installs.length - activeInstalls} uninstalled accounts`}
          tone="signal"
          icon={IconGitHub}
        />
        <StatCard
          label="Tracked Repositories"
          value={repos}
          detail="Across all active installations"
          icon={IconBranch}
        />
        <StatCard
          label="Live Open PRs"
          value={prs}
          detail="Monitored by state engine"
          tone="brand"
          icon={IconGitPullRequest}
        />
        <StatCard
          label="Baton Actions Issued"
          value={actions}
          detail="Targeted nudges & comments"
          icon={IconActivity}
        />
      </section>

      {/* Grid: Installations + Webhooks */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Installations Table */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Connected Installations ({installs.length})
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              {activeInstalls} active
            </span>
          </div>

          {installs.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-500">
              No GitHub installations recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {installs.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          i.uninstalledAt ? "bg-white/20" : "bg-signal-400"
                        }`}
                      />
                      <a
                        href={`https://github.com/${encodeURIComponent(i.accountLogin)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-bold text-white transition-colors hover:text-brand-300 inline-flex items-center gap-1"
                      >
                        <span>@{i.accountLogin}</span>
                        <IconExternalLink className="h-3 w-3 text-ink-500" />
                      </a>
                      <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-400">
                        {i.accountType}
                      </span>
                    </div>

                    <p className="mt-1 font-mono text-[11px] text-ink-400">
                      Installed {new Date(i.createdAt).toISOString().slice(0, 10)}
                      {i.uninstalledAt ? " · uninstalled" : ""}
                    </p>
                  </div>

                  <span className="shrink-0 font-mono text-xs text-ink-300">
                    <strong className="text-white">{i._count.repos}</strong> repo
                    {i._count.repos === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Webhook Events Ingestion Ledger */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Recent Webhook Ingestion Events
            </span>
          </div>

          {webhooks.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-500">
              No webhook events ingested yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {webhooks.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5 text-xs transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-medium text-ink-200">{w.eventType}</span>
                    <p className="mt-0.5 font-mono text-[10px] text-ink-500">
                      {new Date(w.receivedAt).toLocaleTimeString()} &middot;{" "}
                      {new Date(w.receivedAt).toISOString().slice(0, 10)}
                    </p>
                  </div>

                  <span
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                      w.processedAt
                        ? "border-signal-500/30 bg-signal-500/10 text-signal-300"
                        : "border-brand-500/30 bg-brand-500/10 text-brand-300"
                    }`}
                  >
                    {w.processedAt ? "processed" : "pending"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}