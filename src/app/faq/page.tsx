import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconGitHub, IconArrowRight } from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/faq" },
  title: "Frequently Asked Questions: Baton",
  description: "Common technical questions about Baton, the deterministic GitHub App that unblocks stalled pull requests.",
};

interface FAQItem {
  category: string;
  q: string;
  a: string;
}

const FAQ_ITEMS: FAQItem[] = [
  // Core Mechanics
  {
    category: "Core Mechanics",
    q: "What exactly does Baton do once installed?",
    a: "For every open pull request in a repository you install it on, Baton continuously evaluates the PR's state: what it is blocked on and who needs to act next. It maintains one pinned status comment and a matching baton:* label on the PR. If the PR exceeds your configured grace period (e.g. 24 hours), it sends a single targeted @-mention to the person who can unblock it.",
  },
  {
    category: "Core Mechanics",
    q: "How does Baton determine whose turn it is?",
    a: "A pure deterministic state machine. It combines GitHub review decisions (Approved, Changes Requested, Commented), pending review requests, CI check conclusions, merge-conflict status, draft state, and latest activity timestamps. Every state has an explicit mathematical definition; no LLM guesswork is involved in determining who acts next.",
  },
  {
    category: "Core Mechanics",
    q: "How is this different from generic stale-PR bots?",
    a: "Stale-PR bots use blunt time rules (e.g. 'mark as stale after 30 days of inactivity') and almost always blame the author, even if the PR has been sitting waiting on a reviewer for weeks. Baton distinguishes between awaiting initial review, re-review after fixes, changes required, CI failing, and merge conflicts, directing attention to the actual blocker.",
  },

  // Security & Privacy
  {
    category: "Security & Permissions",
    q: "Does Baton read, analyze, or store my source code?",
    a: "No. Absolutely never. Baton is configured with the strict least-privilege permissions needed for workflow orchestration: Pull requests (read/write for status comments), Issues (read/write for state labels), Checks (read-only), and Metadata. It never requests Contents access, so GitHub's security model strictly prevents Baton from reading files, ASTs, or diffs.",
  },
  {
    category: "Security & Permissions",
    q: "Does Baton work on private repositories?",
    a: "Yes. You choose exactly which repositories Baton can access during GitHub App installation. You can grant access to individual repos or all repos, and modify permissions or revoke access at any time in your GitHub organization settings.",
  },
  {
    category: "Security & Permissions",
    q: "What happens to our data if we uninstall Baton?",
    a: "Uninstalling the GitHub App immediately terminates polling and permanently deletes stored PR snapshots and repository settings for that installation within seconds. Webhook delivery logs are retained for 30 days for operational debugging, then expired.",
  },

  // Nudges & Etiquette
  {
    category: "Nudges & Politeness",
    q: "Will Baton spam my engineering team with notifications?",
    a: "No. Baton enforces strict politeness limits: at most one nudge per state per pull request. A nudge is only triggered after the PR has outlived that repo's configured grace period (by default 24h to 48h). You can adjust thresholds per repository or set maximum nudges to zero for a completely silent, comment-only setup.",
  },
  {
    category: "Nudges & Politeness",
    q: "What happens when CI checks fail?",
    a: "Reviewers are never nudged for PRs with failing checks. Baton automatically flips the state to 'CI failing' with ownership assigned to the author. Reviewers are only alerted once the build is green.",
  },

  // Billing & Open Source
  {
    category: "Billing & Open Source",
    q: "Is Baton really free for open-source repositories?",
    a: "Yes. All public repositories get full Team plan functionality at zero cost. There are no credit card requirements or time limits for open-source projects.",
  },
  {
    category: "Billing & Open Source",
    q: "Can we self-host Baton on our own servers?",
    a: "Yes. Baton is AGPL-3.0 open source. The entire codebase, database migrations, and deployment configs are public. You can run it on your own PostgreSQL infrastructure without external dependencies.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function FaqPage() {
  const categories = Array.from(new Set(FAQ_ITEMS.map((i) => i.category)));

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Frequently Asked Questions
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-300 leading-relaxed">
            Everything you need to know about how Baton tracks pull requests, respects developer focus,
            and handles permissions.
          </p>
        </div>

        <div className="mt-14 space-y-12">
          {categories.map((cat) => {
            const items = FAQ_ITEMS.filter((i) => i.category === cat);
            return (
              <div key={cat} className="space-y-4">
                <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-brand-300">
                  {cat}
                </h2>
                <div className="space-y-3">
                  {items.map((item) => (
                    <details
                      key={item.q}
                      className="group rounded-xl border border-white/[0.08] bg-ink-900/60 transition-all hover:border-white/[0.14] open:border-brand-500/40 open:bg-ink-850"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-semibold text-white transition-colors group-hover:text-brand-200 [&::-webkit-details-marker]:hidden">
                        <span>{item.q}</span>
                        <span className="ml-4 font-mono text-lg text-ink-500 transition-transform duration-200 group-open:rotate-45 group-open:text-brand-400">
                          +
                        </span>
                      </summary>
                      <div className="border-t border-white/[0.06] px-6 pb-5 pt-3.5 text-xs sm:text-sm leading-relaxed text-ink-300">
                        {item.a}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Help Box */}
        <div className="mt-16 rounded-2xl border border-white/[0.08] bg-ink-900/40 p-8 text-center sm:text-left sm:flex sm:items-center sm:justify-between gap-6">
          <div>
            <h3 className="text-base font-bold text-white">Have a specific question not covered here?</h3>
            <p className="mt-1 text-xs text-ink-400">
              Check our public GitHub discussions or review the source code on GitHub.
            </p>
          </div>
          <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
            <a
              href="https://github.com/baton-pr/baton/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              GitHub Discussions
            </a>
            <Link href="/docs" className="btn btn-primary btn-sm">
              Read the Docs
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}