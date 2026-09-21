import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/faq" },
  title: "Frequently asked questions",
  description: "Common questions about Baton, the GitHub App that unblocks stalled pull requests.",
};

const Q = [
  {
    q: "What exactly does Baton do?",
    a: "For every open pull request in a repository you have installed it on, Baton continuously computes the PR's state: what it is blocked on and whose turn it is. It keeps a live status comment and state label on the PR itself, then sends a single, targeted @-mention to the person who can unblock it once it has been stuck past the threshold you set.",
  },
  {
    q: "How does Baton decide whose turn it is?",
    a: "A deterministic state machine. It combines GitHub review decisions, pending review requests, CI check conclusions, merge-conflict status, draft state, and latest activity. Every state has an explicit definition, and every result is driven entirely by the GitHub API.",
  },
  {
    q: "Does Baton read or store my code?",
    a: "No. Baton requests Pull requests and Issues read/write access for comments and labels, plus read-only Checks and Metadata. It never requests Contents access and never stores diffs or file contents. It stores PR metadata (titles, numbers, URLs, states, timestamps) to render dashboards and measure stall durations.",
  },
  {
    q: "Will Baton spam my team with nudges?",
    a: "No. Each state can produce at most one nudge per pull request, and only after that state has outlived the repo's configured threshold, by default 24 to 72 hours. You can raise thresholds, disable nudges per repository, or set the max per state to zero and use Baton in read-only mode.",
  },
  {
    q: "How is this different from a stale-PR bot?",
    a: "Stale bots use blunt time rules and often blame the wrong party. Baton is a state machine that distinguishes between waiting for review, waiting on re-review after the author pushed a fix, author owes changes, CI failing, has conflicts, and approved but not merged, and it names the person who actually needs to act.",
  },
  {
    q: "Does Baton work on private repositories?",
    a: "Yes. You control which repositories the GitHub App can access at install time, and you can revoke access at any time in your GitHub settings or by uninstalling Baton.",
  },
  {
    q: "What happens to my data if I uninstall?",
    a: "On uninstall Baton immediately stops polling, deletes stored PR snapshots and action history for that installation, and stops posting to GitHub within seconds. See the privacy policy for the full retention and deletion story.",
  },
  {
    q: "Can I run Baton on my own infrastructure?",
    a: "Yes. Baton is AGPL-3.0 open source. The codebase runs on standard PostgreSQL. For teams with strict data requirements we provide a self-hosting guide with Docker Compose.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: Q.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function FaqPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <MarketingHeader />
      <main className="container-page py-20">
        <p className="eyebrow">Questions & answers</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
          Frequently asked questions
        </h1>
        <div className="mt-12 max-w-3xl space-y-3">
          {Q.map((item) => (
            <details key={item.q} className="group rounded-xl border border-ink-800 bg-ink-900/30">
              <summary className="cursor-pointer list-none px-6 py-5 text-base font-semibold text-ink-50 transition-colors hover:text-brand-300 group-open:text-brand-300 [&::-webkit-details-marker]:hidden">
                {item.q}
              </summary>
              <div className="border-t border-ink-800 px-6 pb-5 pt-4 text-sm leading-relaxed text-ink-300">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}