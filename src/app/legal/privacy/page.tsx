import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/privacy" },
  title: "Privacy Policy: Baton",
  description: "How Baton processes, stores, and protects the operational metadata it needs to unblock pull requests.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />
      <main className="container-text py-16 md:py-24">
        <p className="eyebrow">Legal &amp; Compliance</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-xs font-mono text-ink-400">
          Effective date: {new Date().toISOString().slice(0, 10)}
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-ink-300">
          <section className="rounded-xl border border-white/[0.08] bg-ink-900/50 p-6">
            <h2 className="text-base font-bold text-white">1. What Baton Collects</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-300">
              Baton stores only the operational metadata required to do its job: pull request
              numbers, titles, URLs, author and reviewer logins, review and CI-check summaries,
              and timestamps. It does not store code, diffs, or file contents.
            </p>
          </section>

          <section className="rounded-xl border border-white/[0.08] bg-ink-900/50 p-6">
            <h2 className="text-base font-bold text-white">2. What Baton Never Collects</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-300">
              Baton never requests Contents access from GitHub, so it is technically incapable of
              reading your source code, ASTs, commits blobs, or files. We do not sell data, track
              users across the web, or embed third-party analytics trackers.
            </p>
          </section>

          <section className="rounded-xl border border-white/[0.08] bg-ink-900/50 p-6">
            <h2 className="text-base font-bold text-white">3. Data Residency &amp; Storage</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-300">
              Managed service data is stored in secure, encrypted PostgreSQL databases located in
              US East (or EU West on request for enterprise customers). Self-hosted deployments
              keep all data strictly inside your private network.
            </p>
          </section>

          <section className="rounded-xl border border-white/[0.08] bg-ink-900/50 p-6">
            <h2 className="text-base font-bold text-white">4. Data Deletion on Uninstall</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-300">
              Uninstalling the Baton GitHub App immediately disables polling and permanently wipes
              all stored PR snapshots, repository settings, and action logs for that installation.
              You may also request immediate manual deletion by contacting{" "}
              <a
                href="mailto:privacy@baton.dev"
                className="font-mono text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                privacy@baton.dev
              </a>.
            </p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}