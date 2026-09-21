import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "Baton",
      url: "https://baton.dev",
      description:
        "Know whose turn it is on every pull request. Baton tracks PR state, surfaces it in the PR, and nudges the right person.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Baton",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free for individuals on up to 3 repositories.",
      },
    },
  ],
};

const STATS = [
  { value: "89%", label: "of PR cycle time is spent waiting — not working" },
  { value: "2–6 days", label: "average lag before a first review lands" },
  { value: "24–72h", label: "configurable grace period before Baton nudges anyone" },
  { value: "0", label: "reviews you have to send to install Baton" },
];

const STATES = [
  { state: "Waiting for review", tone: "info", label: "baton:awaiting-review", who: "@reviewer" },
  { state: "Waiting on re-review", tone: "info", label: "baton:re-review", who: "@reviewer" },
  { state: "Changes required", tone: "warn", label: "baton:changes-required", who: "@author" },
  { state: "CI failing", tone: "danger", label: "baton:ci-failing", who: "@author" },
  { state: "Conflicts", tone: "danger", label: "baton:conflicts", who: "@author" },
  { state: "Ready to merge", tone: "success", label: "baton:ready-to-merge", who: "@author" },
];

const FEATURES = [
  {
    title: "A live status card in every PR",
    body: "Baton keeps a single, always-current comment at the top of each pull request: what state it's in, whose turn it is, and how long it's been stuck. Reviewers never guess.",
  },
  {
    title: "State labels, updated automatically",
    body: "One canonical `baton:*` label per PR mirrors its current state, so filters and notifications work out of the box in GitHub itself.",
  },
  {
    title: "Polite, targeted nudges",
    body: "When something has waited past your threshold, Baton @-mentions exactly the person who can unblock it — never the whole team, never at default noise.",
  },
  {
    title: "The 'whose turn' engine",
    body: "A deterministic state machine combines reviews, review requests, CI, mergeability, and drafts to answer one question with zero ambiguity: who acts next?",
  },
  {
    title: "Your Move dashboard",
    body: "Log in and see every PR across your repos sorted by who's holding it up — yours first. No more opening 40 PR tabs to take a pulse.",
  },
  {
    title: "Least-privilege by default",
    body: "Baton only requests what it needs: Pull requests and Issues (read/write) for comments and labels, Checks and Metadata read-only. No contents, no code.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
      />
      <MarketingHeader />

      {/* Hero */}
      <section className="container-page pt-20 text-center sm:pt-28">
        <p className="mx-auto inline-block rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
          For GitHub teams tired of stalled pull requests
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Know whose turn it is on{" "}
          <span className="bg-gradient-to-r from-brand-400 to-signal-400 bg-clip-text text-transparent">
            every pull request
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-300">
          Baton tracks the state of every open PR — who it's waiting on and for how long — posts it
          right in the pull request, and nudges the person whose turn it is. No more stalled work.
          No more the-hero-was-here archaeology.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/auth/login?next=/dashboard" className="btn-primary px-6 py-3 text-base">
            Install Baton — free
          </Link>
          <a href="#how-it-works" className="btn-ghost px-6 py-3 text-base">
            See how it works
          </a>
        </div>
        <p className="mt-3 text-xs text-ink-400">No credit card · installs in ~2 minutes</p>
      </section>

      {/* Proof bar */}
      <section className="container-page mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="card px-5 py-6 text-left">
            <p className="text-3xl font-extrabold text-brand-300">{s.value}</p>
            <p className="mt-2 text-sm text-ink-300">{s.label}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container-page mt-24">
        <h2 className="text-center text-3xl font-bold tracking-tight">How Baton works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-300">
          Install the GitHub App, and Baton quietly walks your open PRs. On every real GitHub
          event — and on a safety-net sweep — it recomputes each PR&apos;s state.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Observe",
              b: "Baton reads reviews, review requests, CI checks, merge conflicts, and draft status for every open PR via the GitHub API.",
            },
            {
              n: "02",
              t: "Classify",
              b: "A deterministic engine answers: what's this PR blocked on, whose turn is it, and how long has it been waiting in this state?",
            },
            {
              n: "03",
              t: "Surface + nudge",
              b: "A live status comment and state label keep the answer visible in the PR. Past your thresholds, Baton @-mentions the one person who can act.",
            },
          ].map((s) => (
            <div key={s.n} className="card p-6">
              <p className="font-mono text-sm text-brand-400">{s.n}</p>
              <h3 className="mt-2 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-ink-300">{s.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The status card mockup */}
      <section className="container-page mt-24">
        <h2 className="text-center text-3xl font-bold tracking-tight">One comment. Always current.</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-300">
          What every reviewer and author sees pinned at the top of the thread.
        </p>
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <span className="chip-info">Waiting for review</span>
              <span className="text-xs text-ink-400">#142</span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-400">Whose turn</dt>
                <dd className="font-medium text-ink-100">@rew-ann, @dev-niel</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-400">Blocked for</dt>
                <dd className="font-medium text-ink-100">3d 4h</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-400">Why</dt>
                <dd className="text-right text-ink-200">Approved — author pushed 2 new commits · no re-review</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-400">Next action</dt>
                <dd className="font-medium text-signal-400">Review the latest changes</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* State + labels */}
      <section className="container-page mt-24">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          Eight honest answers for every PR
        </h2>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STATES.map((s) => (
            <div key={s.state} className="card flex items-center justify-between gap-2 px-4 py-3">
              <span className={`chip chip-${s.tone}`}>{s.state}</span>
              <span className="font-mono text-xs text-ink-400">{s.label}</span>
              <span className="text-xs text-ink-300">→ {s.who}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container-page mt-24">
        <h2 className="text-center text-3xl font-bold tracking-tight">Everything you need to unstick PRs</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-300">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section className="container-page mt-24">
        <div className="card mx-auto max-w-3xl p-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Small permissions, clear boundaries</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-ink-300">
            Baton asks for the narrowest set of GitHub permissions it can get away with:
            read-only on your code, write access limited to PR comments and labels. See our{" "}
            <Link href="/security" className="link">Security &amp; privacy</Link> policy for the full detail.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="container-page mt-24 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Stop losing days to &quot;who&apos;s on this?&quot;</h2>
          <p className="mt-3 text-ink-300">
            A PR that sits quietly costs a day here, a day there. Baton puts the &quot;whose turn&quot;
            answer on the PR itself, so nothing has to wait for someone to ask.
          </p>
          <Link href="/auth/login?next=/dashboard" className="btn-primary mt-6 px-8 py-3 text-base">
            Install Baton for free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}