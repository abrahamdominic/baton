import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  title: "Security & privacy",
  description:
    "Baton's security model: least-privilege GitHub App permissions, signed webhooks, hashed sessions, and a clear data retention policy.",
};

const SECTIONS = [
  {
    title: "Least-privilege GitHub App",
    body: [
      "Baton is a GitHub App with the minimum permissions the product needs:",
      "· Pull requests — Read & write (post status comment, nudges)", 
      "· Issues — Read & write (state labels, comment in thread)",
      "· Checks — Read only (CI state)",
      "· Metadata — Read only (visibility, repo info)",
      "Baton never requests Contents, Actions, Dependabot, or Administration access. Your code is never read, emitted, or stored.",
    ],
  },
  {
    title: "Transport & webhook integrity",
    body: [
      "All traffic is TLS 1.2+. Webhooks are required-verified: every delivery is checked against GITHUB_APP_WEBHOOK_SECRET using HMAC-SHA256 (x-hub-signature-256) in constant time before it touches the database.",
      "Delivery IDs are deduplicated so GitHub's retries are harmless. Rate limiting sits behind the signature check to blunt replay storms.",
    ],
  },
  {
    title: "Authentication & sessions",
    body: [
      "Sign-in is GitHub OAuth with a random, single-use CSRF state parameter. Session tokens are 32 random bytes, stored server-side as SHA-256 hashes in an httpOnly, SameSite=Lax cookie with a 30-day lifetime. Sessions can be revoked at any time; signing out deletes the row.",
    ],
  },
  {
    title: "Data stored & retention",
    body: [
      "We store only operational metadata: PR titles, numbers, URLs, author logins, review/check summaries, and timestamps. We do not store code, diffs, or file contents.",
      "On uninstall: installation, repos, PR snapshots, and action history are deleted immediately. Webhook deliveries and job logs are retained for 30 days for debugging, then expired.",
    ],
  },
  {
    title: "Tenant isolation",
    body: [
      "Every dashboard query is scoped to the signed-in GitHub user and the installations tied to their account (by installation ownership and matching GitHub login). Repo-level mutations re-verify ownership server-side.",
    ],
  },
  {
    title: "Transparency & audit",
    body: [
      "Baton app activity (status writes, label changes, nudges) is written to an action ledger, and human sign-in/logout events to an audit log. On the Team plan, these are available to you; on Organization, they're exported via API/webhook for your SIEM.",
    ],
  },
  {
    title: "Responsible disclosure",
    body: [
      "Found a bug? Report it to security@baton.dev. We'll acknowledge within 24h and publish a fix timeline. Baton runs a confidential severity-based disclosure process. (This MVP is public AGPL-3.0 source — see docs/ for the security model in code.)",
    ],
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-16">
        <h1 className="text-3xl font-bold tracking-tight">Security &amp; privacy</h1>
        <p className="mt-2 max-w-2xl text-ink-300">
          Baton is designed so that the worst-case compromise grants no more than the ability to
          read PR metadata and post comments on repos the victim already invited us into.
        </p>
        <div className="mt-10 space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title} className="card p-6">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-300">
                {s.body.map((line, i) => (
                  <p key={i} className="whitespace-pre-line">{line}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}