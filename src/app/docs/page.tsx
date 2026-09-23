import type { Metadata } from "next";
import { config } from "@/lib/env-boot";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconCheckCircle, IconShield, IconActivity, IconTerminal, IconGitHub, IconBell } from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/docs" },
  title: "Documentation: The Deterministic PR State Engine",
  description:
    "Learn how Baton classifies pull requests, how thresholds and polite nudges work, and how to self-host with Docker.",
};

const DOC_SECTIONS = [
  {
    id: "installation",
    title: "Installation & Quickstart",
    badge: "2 minutes",
    description: "Connect the Baton GitHub App to your personal or organization repositories.",
  },
  {
    id: "states",
    title: "State Machine Reference",
    badge: "Deterministic",
    description: "Complete specification of the 8 canonical PR states and turn ownership logic.",
  },
  {
    id: "thresholds",
    title: "Nudge Policy & Thresholds",
    badge: "Zero Spam",
    description: "How grace periods, time-in-state calculation, and polite @-mentions work.",
  },
  {
    id: "architecture",
    title: "System Architecture",
    badge: "PostgreSQL & Next.js",
    description: "Webhook pipeline, HMAC verification, idempotency, and background safety sweeps.",
  },
  {
    id: "self-host",
    title: "Self-Hosting (AGPL-3.0)",
    badge: "Docker Compose",
    description: "Run Baton on your private infrastructure with zero external telemetry.",
  },
];

const STATES_TABLE = [
  {
    state: "Draft",
    turn: "None",
    label: "baton:draft",
    definition: "PR is marked as draft. Reviewers are never notified.",
  },
  {
    state: "Waiting for review",
    turn: "Reviewers",
    label: "baton:awaiting-review",
    definition: "Non-draft PR with requested reviewers; zero reviews submitted.",
  },
  {
    state: "Fix pushed, re-review due",
    turn: "Reviewers",
    label: "baton:re-review",
    definition: "Previous review asked for changes; author pushed new commits.",
  },
  {
    state: "Changes required",
    turn: "Author",
    label: "baton:changes-required",
    definition: "A reviewer requested changes. Ball is in author's court.",
  },
  {
    state: "CI failing",
    turn: "Author",
    label: "baton:ci-failing",
    definition: "Check suite failed or timed out. Reviewers are spared from nudges.",
  },
  {
    state: "Checks pending",
    turn: "None",
    label: "baton:checks-pending",
    definition: "CI runs in progress. Mergeability is temporarily undetermined.",
  },
  {
    state: "Conflicts",
    turn: "Author",
    label: "baton:conflicts",
    definition: "Branch conflicts with base branch; requires rebase or merge.",
  },
  {
    state: "Ready to merge",
    turn: "Author / Maintainer",
    label: "baton:ready-to-merge",
    definition: "Approved, all checks green, zero merge conflicts.",
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        {/* Header */}
        <div className="max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Baton Technical Documentation
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-300 leading-relaxed">
            Everything you need to know about Baton&apos;s deterministic classification engine,
            least-privilege security model, and self-hosting options.
          </p>
        </div>

        {/* Quick Jump Bar */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              className="group rounded-xl border border-white/[0.08] bg-ink-900/60 p-4 transition-all hover:border-brand-500/40 hover:bg-ink-850"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white group-hover:text-brand-300 transition-colors">
                  {sec.title}
                </span>
                <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
                  {sec.badge}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-ink-400 leading-relaxed">
                {sec.description}
              </p>
            </a>
          ))}
        </div>

        {/* Section 1: Installation */}
        <section id="installation" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs text-brand-300 uppercase">
            <IconTerminal className="h-4 w-4" />
            <span>01 / Installation</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Installing Baton on GitHub</h2>
          <p className="mt-3 text-sm text-ink-300 max-w-2xl leading-relaxed">
            Baton is distributed as an official GitHub App. Installation takes less than 60 seconds
            and grants only the minimal permissions required to read PR metadata and update comments.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "1. Install GitHub App",
                desc: "Select repositories you wish to track. Baton works on public and private repos.",
              },
              {
                step: "2. Sign In via OAuth",
                desc: "Sign in with your GitHub account to access your personal 'Your Move' queue.",
              },
              {
                step: "3. Configure Thresholds",
                desc: "Choose per-repo grace periods (e.g. 24h for reviews, 12h for failing CI) or use defaults.",
              },
            ].map((s) => (
              <div key={s.step} className="rounded-xl border border-white/[0.08] bg-ink-900/70 p-5">
                <h3 className="font-bold text-sm text-white">{s.step}</h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-white/[0.08] bg-ink-900/90 p-5 font-mono text-xs">
            <div className="flex items-center justify-between text-ink-400 pb-3 border-b border-white/[0.08]">
              <span>Quick Install Link</span>
              <span className="text-[11px] text-brand-300">github.com/apps</span>
            </div>
            <p className="mt-3 text-ink-200">
              Direct GitHub App URL:{" "}
              <a
                href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                {`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
              </a>
            </p>
          </div>
        </section>

        {/* Section 2: State Machine */}
        <section id="states" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs text-brand-300 uppercase">
            <IconActivity className="h-4 w-4" />
            <span>02 / State Machine</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">The Deterministic State Machine</h2>
          <p className="mt-3 text-sm text-ink-300 max-w-2xl leading-relaxed">
            Baton rejects non-deterministic LLM classifiers for workflow orchestration. Every open PR
            is mapped to exactly one of eight states using strict boolean logic based on the GitHub API.
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/60">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                  <th className="py-3.5 pl-6 pr-4 font-semibold">Canonical State</th>
                  <th className="py-3.5 px-4 font-semibold text-white">Whose Turn</th>
                  <th className="py-3.5 px-4 font-semibold text-brand-300">GitHub Label</th>
                  <th className="py-3.5 pr-6 pl-4 font-semibold">Trigger Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {STATES_TABLE.map((row) => (
                  <tr key={row.state} className="hover:bg-white/[0.02]">
                    <td className="py-3.5 pl-6 pr-4 font-bold text-white">{row.state}</td>
                    <td className="py-3.5 px-4 font-mono text-ink-300">{row.turn}</td>
                    <td className="py-3.5 px-4">
                      <code className="rounded border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-mono text-[11px] text-brand-300">
                        {row.label}
                      </code>
                    </td>
                    <td className="py-3.5 pr-6 pl-4 text-ink-400">{row.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Thresholds */}
        <section id="thresholds" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs text-brand-300 uppercase">
            <IconBell className="h-4 w-4" />
            <span>03 / Nudge Policy</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Targeted Nudge Thresholds &amp; Politeness</h2>
          <p className="mt-3 text-sm text-ink-300 max-w-2xl leading-relaxed">
            Baton is designed to be respectful of developer focus. It enforces strict politeness rules:
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "Bounded Nudges (Max 1 Per State)",
                desc: "Once Baton pings a reviewer or author for a given state, it will never ping them again for that same state until new activity occurs.",
              },
              {
                title: "Configurable Grace Periods",
                desc: "Set thresholds per repo: First response (default 24h), Re-review (default 24h), Changes required (default 48h), CI failure (default 12h).",
              },
              {
                title: "Zero Pings on Red Builds",
                desc: "If CI is broken, reviewers are never nudged. The PR is automatically categorized as blocked on the author.",
              },
              {
                title: "Read-Only Mode Option",
                desc: "Set nudge limits to 0 to disable automated mentions entirely, using Baton purely for the pinned status card and labels.",
              },
            ].map((card) => (
              <div key={card.title} className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
                <div className="flex items-center gap-2 text-brand-300 font-bold text-xs">
                  <IconCheckCircle className="h-4 w-4" />
                  <span>{card.title}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Architecture */}
        <section id="architecture" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs text-brand-300 uppercase">
            <IconShield className="h-4 w-4" />
            <span>04 / System Architecture</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Pipeline Architecture &amp; Security</h2>
          <p className="mt-3 text-sm text-ink-300 max-w-2xl leading-relaxed">
            Built with Next.js 15, Prisma ORM, and PostgreSQL. Every webhook undergoes HMAC-SHA256
            verification in constant time before parsing.
          </p>

          <div className="mt-8 rounded-xl border border-white/[0.08] bg-ink-950 p-6 font-mono text-xs text-ink-300 space-y-3">
            <p className="text-brand-300 font-bold">Pipeline Execution Order:</p>
            <ol className="list-decimal pl-5 space-y-2 text-ink-400">
              <li>
                <strong className="text-white">Webhook Ingestion:</strong> Evaluates <code className="text-brand-300">x-hub-signature-256</code> with configured webhook secret. Deduplicates delivery IDs.
              </li>
              <li>
                <strong className="text-white">PR Event Filter:</strong> Pull request, review, check run, and issue comment events trigger the classifier.
              </li>
              <li>
                <strong className="text-white">Deterministic Classifier:</strong> Pure function computing state, whoseTurn, and blocked duration. Zero LLM calls.
              </li>
              <li>
                <strong className="text-white">GitHub API Dispatch:</strong> Updates pinned comment via GitHub API, syncs label, and conditionally posts single nudge comment.
              </li>
              <li>
                <strong className="text-white">Safety Net Sweep:</strong> Periodic cron sweep audits open PRs to catch any missed webhook events.
              </li>
            </ol>
          </div>
        </section>

        {/* Section 5: Self Hosting */}
        <section id="self-host" className="mt-20 scroll-mt-24 border-t border-white/[0.08] pt-16">
          <div className="flex items-center gap-2 font-mono text-xs text-brand-300 uppercase">
            <IconGitHub className="h-4 w-4" />
            <span>05 / Self Hosting</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Self-Hosting Baton (AGPL-3.0)</h2>
          <p className="mt-3 text-sm text-ink-300 max-w-2xl leading-relaxed">
            Baton is 100% open source under the AGPL-3.0 license. You can deploy it inside your own
            VPC or Kubernetes cluster backed by PostgreSQL.
          </p>

          <div className="mt-6 rounded-xl border border-white/[0.08] bg-ink-900/90 p-5 font-mono text-xs text-ink-200">
            <div className="text-ink-500 pb-2"># Clone and run locally or with Docker</div>
            <pre className="overflow-x-auto text-brand-300">
{`git clone https://github.com/baton-pr/baton.git
cd baton
cp .env.example .env
npm install
npm run db:migrate
npm run build && npm run start`}
            </pre>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}