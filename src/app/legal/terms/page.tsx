import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/terms" },
  title: "Terms of Service: Baton",
  description: "The legal terms governing your use of Baton.",
};

const SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    content:
      "By creating an account or installing the Baton GitHub App, you agree to these Terms of Service. If you use Baton on behalf of an organization or company, you represent and warrant that you have authority to bind that entity.",
  },
  {
    title: "2. Your Data & GitHub Permissions",
    content:
      "You grant Baton the minimal GitHub App permissions required to display status comments, manage state labels, and send targeted nudges, as detailed on our Security page. You retain full ownership of your repositories and code. Baton can be uninstalled at any time from your GitHub settings.",
  },
  {
    title: "3. Acceptable Use",
    content:
      "You agree not to misuse Baton, including attempting to bypass API rate limits, probing for vulnerabilities outside our responsible disclosure policy, or using the notification engine for spam or harassment.",
  },
  {
    title: "4. Service Level & Warranties",
    content:
      "The Individual plan is provided 'as is' without warranties. Team and Organization plans include the uptime SLAs specified in your order agreement. Baton operates as a GitHub App and is dependent on GitHub API uptime.",
  },
  {
    title: "5. Modifications",
    content:
      "We may update these terms from time to time with advance notice posted to this page and announced in product release notes.",
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <MarketingHeader />
      <main className="container-text py-16 md:py-24">
        <p className="eyebrow">Legal &amp; Compliance</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-2 text-xs font-mono text-ink-400">
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-ink-300">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="rounded-xl border border-white/[0.08] bg-ink-900/50 p-6">
              <h2 className="text-base font-bold text-white">{sec.title}</h2>
              <p className="mt-2 text-xs leading-relaxed text-ink-300">{sec.content}</p>
            </section>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}