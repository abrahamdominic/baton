import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconArrowRight } from "@/components/icons";

export const metadata: Metadata = {
  alternates: { canonical: "/docs" },
  title: "Documentation",
  description:
    "Learn how Baton classifies pull requests, how thresholds and nudges work, and how to self-host.",
};

const DOCS = [
  {
    href: "/docs#installation",
    title: "Installation & setup",
    body: "Why you install a GitHub App, what permissions Baton requests, and how OAuth sign-in links your account to your repos. Run npm i, set environment variables, and install. About two minutes total.",
  },
  {
    href: "/docs#states",
    title: "The Baton state machine",
    body: "Eight states plus merged and closed: draft, awaiting review, awaiting review after fix, changes required, CI failing, checks pending, conflicts, ready to merge. Every state has an explicit definition and a 'whose turn'.",
  },
  {
    href: "/docs#thresholds",
    title: "Nudge thresholds",
    body: "Per-repo controls: first response, re-review, changes required, CI failure, conflicts, and ready to merge, in hours, plus a cap on nudges per state. Nudges are time-boxed and can be turned off.",
  },
  {
    href: "/docs#architecture",
    title: "Architecture",
    body: "A Next.js app, PostgreSQL (SQLite in local dev), a polling worker, and a webhook pipeline with HMAC verification, idempotency, and retries. See ARCHITECTURE.md in the repository.",
  },
  {
    href: "/docs#self-host",
    title: "Self-hosting",
    body: "Baton is AGPL-3.0. The repository ships the environment reference, migration commands for PostgreSQL, and everything needed to run your own instance. The SQLite mirror keeps local development free of Postgres.",
  },
];

const STATE_ROWS: [string, string, string][] = [
  ["Draft", "No one", "Open, marked as a draft, no review requested."],
  ["Awaiting review", "Reviewers", "No review decision yet; reviewers assigned or required."],
  ["Awaiting review after fix", "Reviewers", "Had an approval, then new commits; a re-review is due."],
  ["Changes required", "Author", "A reviewer asked for changes and it has not been answered."],
  ["CI failing", "Author", "One or more checks are failing or timed out."],
  ["Checks pending", "No one", "Mergeability is unknown while checks are still running."],
  ["Conflicts", "Author", "The base branch and PR branch conflict."],
  ["Ready to merge", "Author / maintainer", "Approved, green, and conflict-free. It needs the merge."],
];

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-20">
        <p className="eyebrow">Documentation</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
          Baton docs
        </h1>
        <p className="mt-3 max-w-2xl text-ink-300">
          Short guides, plus pointers to the source of truth in the repository.
        </p>

        <div className="mt-12">
          {DOCS.map((d) => (
            <a
              key={d.href}
              href={d.href}
              className="group flex items-start justify-between gap-6 border-b border-ink-800 py-6 transition-colors last:border-b-0"
            >
              <div>
                <h2 className="font-semibold text-ink-50 transition-colors group-hover:text-brand-300">
                  {d.title}
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">{d.body}</p>
              </div>
              <IconArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-500 transition-colors group-hover:text-brand-300" />
            </a>
          ))}
        </div>

        <section id="states" className="mt-20 scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight text-ink-50">State machine summary</h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-ink-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
                  <th className="py-3 pl-6 pr-4 font-semibold">State</th>
                  <th className="py-3 pr-4 font-semibold">Whose turn</th>
                  <th className="py-3 pr-6 font-semibold">Definition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/70">
                {STATE_ROWS.map((row) => (
                  <tr key={row[0]}>
                    <td className="py-3.5 pl-6 pr-4 font-medium text-ink-50">{row[0]}</td>
                    <td className="py-3.5 pr-4 text-ink-300">{row[1]}</td>
                    <td className="py-3.5 pr-6 text-ink-400">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}