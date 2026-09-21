import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/faq" },
  title: "FAQ",
  description: "Frequently asked questions about Baton, the GitHub App that unblocks stalled pull requests.",
};

const Q = [
  {
    q: "What exactly does Baton do?",
    a: "For every open pull request in a repo you've installed Baton on, it continuously computes the PR's state — what it's blocked on and whose turn it is — keeps a live status comment and state label on the PR itself, and sends a polite, targeted @-mention to the one person who can unblock it once it has been stuck past your threshold.",
  },
  {
    q: "How does Baton decide 'whose turn it is'?",
    a: "A deterministic state machine. It combines GitHub review decisions (approved / changes requested), pending review requests, CI check conclusions, merge-conflict status, draft state, and latest activity. There are no heuristics that guess — every state has an explicit definition, and it's all driven by the GitHub API.",
  },
  {
    q: "Does Baton read or store my code?",
    a: "No. Baton only requests Pull requests and Issues read/write (for comments and labels) plus read-only Checks and Metadata. It does not request contents access and never stores diffs or file contents. It stores PR metadata (title, numbers, states, timestamps) to render dashboards and track stall durations.",
  },
  {
    q: "Will Baton spam my team with nudges?",
    a: "By default, each state can produce exactly one nudge per PR, and only after the state has outlived the repo's configured threshold (24–72h). You can disable nudges per repo, raise thresholds, or set maxNudgesPerState to 0 to make Baton purely informational.",
  },
  {
    q: "How is this different from a stale-PR bot?",
    a: "Stale bots target unusual-looking PRs and are usually configured with blunt time rules. Baton is a state machine: it knows the difference between 'waiting for review', 'waiting on re-review', 'author owes changes', 'CI is failing', 'has conflicts', and 'approved but not merged' — and it blames the person who actually needs to act.",
  },
  {
    q: "Does Baton work on private repositories?",
    a: "Yes. You control which repos the GitHub App can access at install time, and you can remove access at any time in GitHub settings or by uninstalling.",
  },
  {
    q: "What happens to my data if I uninstall?",
    a: "On uninstall we disable polling, delete stored PR snapshots and action history for that installation immediately, and stop posting to GitHub within seconds. See our Privacy policy for the full retention story.",
  },
  {
    q: "Can I run Baton on my own infrastructure?",
    a: "Baton is AGPL-3.0 open source. The codebase runs on standard PostgreSQL; for teams with strict data requirements we're releasing a self-host guide with Docker Compose.",
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
      <main className="container-page py-16">
        <h1 className="text-center text-4xl font-bold tracking-tight">Frequently asked questions</h1>
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {Q.map((item) => (
            <details key={item.q} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold text-ink-100 selection:bg-transparent">
                <span className="mr-2 inline-block text-brand-400 transition-transform group-open:rotate-90">›</span>
                {item.q}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-300">{item.a}</p>
            </details>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}