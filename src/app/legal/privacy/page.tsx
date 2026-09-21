import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/privacy" },
  title: "Privacy policy",
  description: "How Baton processes, stores, and protects data.",
  robots: { index: true },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-12">
        <h1 className="text-3xl font-bold tracking-tight">Privacy policy</h1>
        <div className="prose prose-invert mt-6 max-w-3xl text-ink-200">
          <p className="lead"><em>Last updated: {new Date().toISOString().slice(0, 10)}.</em></p>
          <h2>What Baton collects</h2>
          <p>
            Baton stores only the operational metadata required to do its job: pull request
            numbers, titles, URLs, author and reviewer logins, review and CI-check summaries,
            and timestamps. It does not store code, diffs, or file contents.
          </p>
          <h2>What Baton does not collect</h2>
          <p>
            No contents access is ever requested. Baton cannot read your source code, and it
            never will. It does not sell data. It does not use analytics trackers or third-party
            ad networks on the Baton dashboard.
          </p>
          <h2>Where data lives</h2>
          <p>
            The Baton SaaS stores data in the region you choose for the workspace (default:
            US-East or EU-West on request). Self-hosted deployments keep everything inside
            your own PostgreSQL instance.
          </p>
          <h2>Retention &amp; deletion</h2>
          <p>
            Uninstalling Baton immediately disables polling and deletes stored PR snapshots and
            action history for that installation. Webhook payloads and job logs are retained
            for 30 days after receipt for debugging, then permanently deleted. You may request
            full deletion at any time by emailing privacy@baton.dev.
          </p>
          <h2>Contact</h2>
          <p>Questions about this policy: privacy@baton.dev.</p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}