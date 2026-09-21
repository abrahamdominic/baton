import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/terms" },
  title: "Terms of service",
  description: "The terms that govern your use of Baton.",
};

const SECTIONS: [string, string[]][] = [
  [
    "1. Acceptance",
    [
      "By creating an account or installing the Baton GitHub App you agree to these terms. If you use Baton on behalf of an organization, you represent that you have the authority to bind that organization.",
    ],
  ],
  [
    "2. Your data",
    [
      "You grant Baton the GitHub App permissions required to display status comments, manage state labels, and send nudges, as detailed on the Security page. You retain ownership of your content. Baton is a GitHub App and can be uninstalled at any time from your GitHub settings.",
    ],
  ],
  [
    "3. Acceptable use",
    [
      "You agree not to misuse Baton, for example by exceeding API rate limits, relaying sensitive credentials through the service, or harassing repository members with the nudge feature. We may disable accounts that are in violation.",
    ],
  ],
  [
    "4. Service level",
    [
      "The Individual plan is provided as is, without warranties of any kind. The Team and Organization plans include the uptime SLA described at the time of purchase. Baton depends on GitHub API availability.",
    ],
  ],
  [
    "5. Changes",
    [
      "We may update these terms from time to time. Material changes are announced in the product and on this page with an updated effective date.",
    ],
  ],
];

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-text py-20">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
          Terms of service
        </h1>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-ink-300">
          <p className="text-sm text-ink-400">
            Last updated: {new Date().toISOString().slice(0, 10)}.
          </p>
          <p>
            Baton Software Inc. ("Baton", "we") provides a service that tracks the state of pull
            requests on GitHub at baton-xi.vercel.app.
          </p>
          {SECTIONS.map(([title, paras]) => (
            <section key={title}>
              <h2 className="text-xl font-semibold text-ink-50">{title}</h2>
              {paras.map((p) => (
                <p key={p} className="mt-3">
                  {p}
                </p>
              ))}
            </section>
          ))}
          <p className="text-sm text-ink-400">
            Contact: hello@baton.dev.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}