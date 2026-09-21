import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/legal/terms" },
  title: "Terms of service",
  description: "The terms that govern your use of Baton.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="container-page py-12">
        <h1 className="text-3xl font-bold tracking-tight">Terms of service</h1>
        <div className="mt-6 max-w-3xl space-y-6 text-sm leading-relaxed text-ink-200">
          <p><em>Last updated: {new Date().toISOString().slice(0, 10)}.</em></p>
          <p>
            Baton Software Inc. (&quot;Baton&quot;, &quot;we&quot;) provides a service that tracks the
            state of pull requests on GitHub, at baton.dev.
          </p>
          <h2 className="text-lg font-semibold text-ink-50">1. Acceptance</h2>
          <p>
            By creating an account or installing the Baton GitHub App you agree to these terms.
            If you use Baton on behalf of an organization, you represent that you have authority
            to bind that organization.
          </p>
          <h2 className="text-lg font-semibold text-ink-50">2. Your data</h2>
          <p>
            You grant Baton the GitHub App permissions required to display status comments,
            manage state labels, and send nudges — as detailed in our Security page. You retain
            ownership of your content. Baton is a GitHub App and can be uninstalled at any time
            from your GitHub settings.
          </p>
          <h2 className="text-lg font-semibold text-ink-50">3. Acceptable use</h2>
          <p>
            You agree not to misuse Baton — for example, by attempting to exceed API rate
            limits, relay sensitive credentials through the service, or harass repository
            members with abuse of the nudge feature. We may disable accounts in violation.
          </p>
          <h2 className="text-lg font-semibold text-ink-50">4. Service level</h2>
          <p>
            The Individual plan is provided &quot;as is&quot; without warranties of any kind. The Team
            and Organization plans include a 95.99% uptime SLA on paid tiers as described at time
            of purchase. Baton depends on GitHub API availability.
          </p>
          <h2 className="text-lg font-semibold text-ink-50">5. Changes</h2>
          <p>
            We may update these terms from time to time. Material changes will be announced in
            the product and on this page with an updated effective date.
          </p>
          <p>
            Contact: hello@baton.dev · 548 Market St, San Francisco, CA.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}