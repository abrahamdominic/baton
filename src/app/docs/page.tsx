import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/docs" },
  title: "Product documentation",
  description:
    "Learn how Baton classifies pull requests, how thresholds and nudges work, and how to self-host.",
};

const DOCS = [
  {
    href: "/docs#installation",
    title: "Installation & setup",
    body: "Why you install a GitHub App, what permissions Baton requests, and how OAuth sign-in links your account to your repos. Run npm i, set env vars, and install — ~2 minutes.",
  },
  {
    href: "/docs#states",
    title: "The Baton state machine",
    body: "Eight states (plus merged and closed): draft, awaiting review, awaiting review after fix, changes required, CI failing, checks pending, conflicts, ready-to-merge. Every state has an explicit definition and a 'whose turn'.",
  },
  {
    href: "/docs#thresholds",
    title: "Nudge thresholds",
    body: "Per-repo controls: first-response, re-review, changes-required, CI-fail, conflicts, and ready-to-merge hours, plus maxNudgesPerState. Nudges are one-shot, time-boxed, and can be turned off.",
  },
  {
    href: "/docs#architecture",
    title: "Architecture",
    body: "Next.js app, PostgreSQL (SQLite in local dev), a polling worker, and a webhook ingestion pipeline with HMAC verification, idempotency, and retries. See ARCHITECTURE.md in the repository.",
  },
  {
    href: "/docs#self-host",
    title: "Self-hosting",
    body: "Baton is AGPL-3.0. The repo ships a Dockerfile-compatible stack config, ENVIRONMENT.md for every variable, and migration commands for PostgreSQL. SQLite mirror keeps local dev Postgres-free.",
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-16">
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="mt-2 max-w-2xl text-ink-300">
          Short guides, plus pointers to the source of truth in the repository.
        </p>
        <div className="mt-10 space-y-4">
          {DOCS.map((d) => (
            <a key={d.href} href={d.href} className="card block p-6 transition-colors hover:border-brand-500/40">
              <h2 className="font-semibold text-ink-50">{d.title}</h2>
              <p className="mt-2 text-sm text-ink-300">{d.body}</p>
            </a>
          ))}
        </div>
        <section id="states" className="mt-14">
          <h2 className="text-xl font-bold">State machine summary</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-ink-400">
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 font-medium">Whose turn</th>
                  <th className="py-2 font-medium">Definition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800 text-ink-200">
                {[
                  ["Draft", "—", "Open, isDraft, no request for change."],
                  ["Awaiting review", "Reviewers", "No decision yet; reviewers assigned or required."],
                  ["Awaiting review after fix", "Reviewers", "Had an approval then new commits; re-review overdue."],
                  ["Changes required", "Author", "A reviewer asked for changes and it hasn't been answered."],
                  ["CI failing", "Author", "One or more checks are failing/timed-out."],
                  ["Checks pending", "—", "Mergeable/conflict unknown while checks are queueing."],
                  ["Conflicts", "Author", "Base branch and PR branch conflict."],
                  ["Ready to merge", "Author / maintainer", "Approved, green, no conflicts — needs the merge."],
                ].map((row) => (
                  <tr key={row[0]}>
                    <td className="py-2 pr-4 font-medium text-ink-50">{row[0]}</td>
                    <td className="py-2 pr-4">{row[1]}</td>
                    <td className="py-2">{row[2]}</td>
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