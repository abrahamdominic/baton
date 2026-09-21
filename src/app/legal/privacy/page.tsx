import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/privacy" },
  title: "Privacy policy",
  description: "How Baton processes, stores, and protects the data it needs to do its job.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-text py-20">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
          Privacy policy
        </h1>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-ink-300">
          <p className="text-sm text-ink-400">
            Last updated: {new Date().toISOString().slice(0, 10)}.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-ink-50">What Baton collects</h2>
            <p className="mt-3">
              Baton stores only the operational metadata required to do its job: pull request
              numbers, titles, URLs, author and reviewer logins, review and CI-check summaries,
              and timestamps. It does not store code, diffs, or file contents.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink-50">What Baton does not collect</h2>
            <p className="mt-3">
              Baton never requests Contents access, so it cannot read your source code. It does
              not sell data, and it does not use analytics trackers or third-party ad networks on
              the dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink-50">Where data lives</h2>
            <p className="mt-3">
              The managed service stores data in the region you choose for your workspace, US East
              by default or EU West on request. Self-hosted deployments keep everything inside
              your own PostgreSQL instance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink-50">Retention and deletion</h2>
            <p className="mt-3">
              Uninstalling Baton immediately disables polling and deletes stored PR snapshots and
              action history for that installation. Webhook payloads and job logs are retained for
              30 days after receipt for debugging, then permanently deleted. You may request full
              deletion at any time by emailing privacy@baton.dev.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink-50">Contact</h2>
            <p className="mt-3">Questions about this policy: privacy@baton.dev.</p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}