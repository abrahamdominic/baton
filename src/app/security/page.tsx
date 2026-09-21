import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  title: "Security & privacy",
  description:
    "Baton's security model: least-privilege GitHub App permissions, signed webhooks, hashed sessions, and a clear data retention policy.",
};

interface Section {
  title: string;
  body: string[];
  items?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "Least-privilege GitHub App",
    body: [
      "Baton is a GitHub App with the minimum permissions the product needs. It never requests Contents, Actions, Dependabot, or Administration access, so your code is never read, emitted, or stored.",
    ],
    items: [
      "Pull requests: read and write (status comment, nudges)",
      "Issues: read and write (state labels, comments in the thread)",
      "Checks: read only (CI state)",
      "Metadata: read only (visibility, repo info)",
    ],
  },
  {
    title: "Transport & webhook integrity",
    body: [
      "All traffic runs over TLS 1.2 or newer. Every webhook delivery is checked against the configured webhook secret using HMAC-SHA256 with the x-hub-signature-256 header, compared in constant time before the payload touches the database.",
      "Delivery IDs are deduplicated so GitHub's retries are harmless, and IP rate limiting sits behind the signature check to blunt replay storms.",
    ],
  },
  {
    title: "Authentication & sessions",
    body: [
      "Sign-in is GitHub OAuth with a random, single-use CSRF state parameter. Session tokens are 32 random bytes, stored server-side as SHA-256 hashes in an httpOnly, SameSite=Lax cookie with a 30-day lifetime. Sessions can be revoked at any time, and signing out deletes the row.",
    ],
  },
  {
    title: "Data stored & retention",
    body: [
      "We store only operational metadata: PR titles, numbers, URLs, author logins, review and check summaries, and timestamps. We do not store code, diffs, or file contents.",
      "On uninstall, the installation record, its repositories, PR snapshots, and action history are deleted immediately. Webhook deliveries and job logs are retained for 30 days for debugging, then expired.",
    ],
  },
  {
    title: "Tenant isolation",
    body: [
      "Every dashboard query is scoped to the signed-in GitHub user and the installations tied to their account, matched by installation ownership and GitHub login. Repository-level mutations re-verify ownership server-side.",
    ],
  },
  {
    title: "Transparency & audit",
    body: [
      "Baton's own activity (status writes, label changes, nudges) is written to an action ledger, and sign-in and sign-out events to an audit log. On the Team plan these are available to you; on the Organization plan they are exported via webhook or API for your SIEM.",
    ],
  },
  {
    title: "Responsible disclosure",
    body: [
      "Found a bug? Email security@baton.dev with a description and a reproduction, and we will acknowledge it within 24 hours. If you prefer to inspect the design yourself, the source is public under AGPL-3.0 and the full security model lives in SECURITY.md.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-20">
        <p className="eyebrow">Security & privacy</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
          Small permissions, clear data practices
        </h1>
        <p className="mt-3 max-w-2xl text-ink-300">
          Baton is designed so that the worst-case compromise grants no more than the ability to
          read PR metadata and post comments on repositories the account already invited it into.
        </p>

        <div className="mt-14 space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="rounded-xl border border-ink-800 bg-ink-900/30 p-7">
              <h2 className="text-lg font-semibold text-ink-50">{s.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-300">
                {s.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {s.items ? (
                  <ul className="mt-2 space-y-2">
                    {s.items.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}