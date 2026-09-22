import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { IconLock, IconShield, IconCheckCircle, IconArrowRight } from "@/components/icons";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  title: "Security and Privacy: Least Privilege by Design",
  description:
    "Baton's security architecture: least-privilege metadata access, signed webhooks with HMAC-SHA256, session encryption, and strict data isolation.",
};

const PERMISSIONS_MATRIX = [
  {
    scope: "Pull requests",
    access: "Read & Write",
    status: "Granted",
    purpose: "Read PR review states and update the single pinned status comment and nudges.",
  },
  {
    scope: "Issues",
    access: "Read & Write",
    status: "Granted",
    purpose: "Synchronize canonical baton:* state labels on GitHub pull requests.",
  },
  {
    scope: "Checks",
    access: "Read-only",
    status: "Granted",
    purpose: "Inspect check-suite pass/fail conclusions to avoid nudging reviewers on red builds.",
  },
  {
    scope: "Metadata",
    access: "Read-only",
    status: "Granted",
    purpose: "Read repository names, owner logins, and default branch references.",
  },
  {
    scope: "Contents (Source Code, Diffs)",
    access: "NO ACCESS",
    status: "Denied by design",
    purpose: "Baton never requests or touches file contents, source code, or git blobs.",
  },
  {
    scope: "Workflows & Actions",
    access: "NO ACCESS",
    status: "Denied by design",
    purpose: "Cannot view workflow secrets, CI definitions, or runner configurations.",
  },
  {
    scope: "Administration & Members",
    access: "NO ACCESS",
    status: "Denied by design",
    purpose: "Cannot modify repo settings, invite members, or manage organization keys.",
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />

      <main className="container-page py-16 md:py-24">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Least privilege by design. No code read access.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-300 leading-relaxed">
            Baton is engineered so that even in the absolute worst-case scenario, the app holds no
            permissions to read your source code, inspect repository files, or access production secrets.
          </p>
        </div>

        {/* Permissions Table */}
        <section className="mt-14">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-brand-300">
            <IconLock className="h-4 w-4" />
            <span>GitHub App Permissions Matrix</span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/70">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-ink-950/80 font-mono text-[11px] uppercase text-ink-400">
                  <th className="py-3.5 pl-6 pr-4 font-semibold">GitHub Scope</th>
                  <th className="py-3.5 px-4 font-semibold">Access Level</th>
                  <th className="py-3.5 px-4 font-semibold">Status</th>
                  <th className="py-3.5 pr-6 pl-4 font-semibold">Technical Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {PERMISSIONS_MATRIX.map((p) => {
                  const isDenied = p.status.includes("Denied");
                  return (
                    <tr key={p.scope} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 pl-6 pr-4 font-semibold text-white">{p.scope}</td>
                      <td className="py-3.5 px-4 font-mono text-ink-300">{p.access}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                            isDenied
                              ? "border border-signal-500/30 bg-signal-500/10 text-signal-400"
                              : "border border-brand-400/30 bg-brand-500/10 text-brand-300"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3.5 pr-6 pl-4 text-ink-400">{p.purpose}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Security Principles */}
        <section className="mt-16 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6">
            <div className="flex items-center gap-2 text-brand-300 font-bold text-sm">
              <IconShield className="h-4 w-4" />
              <span>Cryptographic Webhook Integrity</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-300">
              Every incoming GitHub webhook delivery is authenticated against your configured
              webhook secret using HMAC-SHA256 with the <code className="text-brand-300">x-hub-signature-256</code> header.
              Signatures are evaluated in constant time to prevent timing side-channel attacks before
              any JSON payload is parsed.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6">
            <div className="flex items-center gap-2 text-brand-300 font-bold text-sm">
              <IconCheckCircle className="h-4 w-4" />
              <span>Data Minimization &amp; Retention</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-300">
              We store only operational metadata required to render the dashboard and measure stall
              durations: PR titles, numbers, author logins, and timestamps. On uninstall, all PR
              snapshots and repository configurations are deleted immediately and permanently.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6">
            <div className="flex items-center gap-2 text-brand-300 font-bold text-sm">
              <IconLock className="h-4 w-4" />
              <span>Tenant &amp; Session Isolation</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-300">
              Every dashboard query is strictly scoped to the authenticated GitHub OAuth user and
              installations they own or belong to. Sessions are backed by 32 cryptographically random
              bytes, hashed with SHA-256 before storage, and protected by <code className="text-brand-300">httpOnly</code>, <code className="text-brand-300">SameSite=Lax</code> cookies.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6">
            <div className="flex items-center gap-2 text-brand-300 font-bold text-sm">
              <IconShield className="h-4 w-4" />
              <span>Responsible Disclosure</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-300">
              If you identify a security vulnerability in Baton, please notify us immediately at{" "}
              <a
                href="mailto:security@baton.dev"
                className="font-mono text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                security@baton.dev
              </a>
              . We acknowledge reports within 24 hours and commit to transparent patching and public attribution.
            </p>
          </div>
        </section>

        {/* CTA */}
        <div className="mt-16 rounded-2xl border border-white/[0.08] bg-ink-900/40 p-8 flex flex-wrap items-center justify-between gap-6">
          <div>
            <h3 className="text-base font-bold text-white">Need a custom security review or SOC2 report?</h3>
            <p className="mt-1 text-xs text-ink-400">
              Our Organization plan includes vendor assessment assistance, SAML SSO, and audit log exports.
            </p>
          </div>
          <Link href="/pricing" className="btn btn-primary btn-sm">
            Explore Enterprise Plan
            <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}