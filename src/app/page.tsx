import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";
import { config } from "@/lib/env-boot";
import {
  IconActivity,
  IconArrowRight,
  IconBell,
  IconBranch,
  IconCheck,
  IconGauge,
  IconLayers,
  IconShield,
} from "@/components/icons";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  title: "GitHub App that tracks whose turn it is on every pull request",
  description:
    "Baton watches every open pull request in your repos, posts a live status comment showing whose turn it is, and nudges the right person when work stalls.",
};

const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "Baton",
      url: config.SITE_URL,
      description:
        "Know whose turn it is on every pull request. Baton tracks PR state, surfaces it in the PR, and nudges the right person.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Baton",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: config.SITE_URL,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free for individuals on up to 3 repositories.",
      },
    },
  ],
};

const STEPS = [
  {
    n: "01",
    title: "Observe",
    body: "Baton reads reviews, review requests, CI checks, merge conflicts, and draft status for every open PR through the GitHub API.",
  },
  {
    n: "02",
    title: "Classify",
    body: "A deterministic engine decides what the PR is blocked on, whose turn it is, and how long it has been sitting in that state.",
  },
  {
    n: "03",
    title: "Surface and nudge",
    body: "A live status comment and a state label keep the answer visible in the PR. Past the threshold you set, Baton @-mentions the one person who can act.",
  },
];

const STATES: { state: string; label: string; tone: string; turn: string }[] = [
  { state: "Waiting for review", label: "baton:awaiting-review", tone: "info", turn: "Reviewers" },
  { state: "Fix pushed, re-review due", label: "baton:re-review", tone: "info", turn: "Reviewers" },
  { state: "Changes required", label: "baton:changes-required", tone: "warn", turn: "Author" },
  { state: "CI failing", label: "baton:ci-failing", tone: "danger", turn: "Author" },
  { state: "Merge conflicts", label: "baton:conflicts", tone: "danger", turn: "Author" },
  { state: "Ready to merge", label: "baton:ready-to-merge", tone: "success", turn: "Author" },
];

interface Feature {
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: IconBranch,
    title: "A live status card in every PR",
    body: "Baton keeps one always-current comment at the top of each pull request with the state, whose turn it is, and how long it has been stuck. No one has to ask.",
  },
  {
    icon: IconLayers,
    title: "State labels, updated automatically",
    body: "One canonical baton:* label per PR mirrors its current state, so GitHub filters and notifications keep working without extra tooling.",
  },
  {
    icon: IconBell,
    title: "Targeted nudges, never spam",
    body: "When a PR waits past your threshold, Baton mentions exactly the person who can unblock it. At most one nudge per state, and only after the grace period you set.",
  },
  {
    icon: IconActivity,
    title: "A deterministic whose-turn engine",
    body: "Reviews, review requests, CI, mergeability, and draft state combine into one unambiguous answer: who acts next. No heuristics, no guesswork.",
  },
  {
    icon: IconGauge,
    title: "Your Move dashboard",
    body: "Every open PR across your repos, sorted by who is holding it up. Your queue first, so you know exactly where to start.",
  },
  {
    icon: IconShield,
    title: "Least privilege by default",
    body: "Baton asks only for Pull requests and Issues write access for comments and labels, plus read-only Checks and Metadata. It never requests your code.",
  },
];

const PERMISSIONS = ["Pull requests, read & write", "Issues, read & write", "Checks, read only", "Metadata, read only"];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
      />
      <MarketingHeader />

      {/* Hero */}
      <section className="container-page grid items-center gap-12 pb-20 pt-16 md:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs font-medium text-ink-300">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-500" />
            GitHub App for busy teams
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-ink-50 sm:text-5xl">
            Know whose turn it is on every pull request.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-300">
            Baton watches every open PR in your repos, posts the current state and owner right in
            the thread, and nudges the one person who can move it forward.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/auth/login?next=/dashboard" className="btn btn-primary btn-lg">
              Install Baton free
              <span aria-hidden="true">&#8594;</span>
            </Link>
            <Link href="/#how-it-works" className="btn btn-ghost btn-lg">
              See how it works
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-400">Installs in about two minutes. No credit card.</p>
        </div>

        <HeroPreview />
      </section>

      {/* Product numbers */}
      <section className="container-page">
        <dl className="grid grid-cols-1 divide-y divide-ink-800 border-y border-ink-800 py-8 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            ["89%", "of pull request cycle time is spent waiting, not working"],
            ["2-6 days", "the typical gap before the first review lands"],
            ["24-72h", "configurable grace period before Baton nudges anyone"],
          ].map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-4 py-4 sm:justify-center sm:first:justify-start sm:last:justify-end">
              <dt className="sr-only">{label}</dt>
              <dd className="text-3xl font-bold tabular-nums tracking-tight text-brand-300">{value}</dd>
              <dd className="max-w-[16rem] text-sm leading-snug text-ink-400">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container-page pb-20 pt-24 md:pt-32">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
            From GitHub event to nudged reviewer
          </h2>
          <p className="mt-4 text-ink-300">
            On every real GitHub event and on a scheduled safety-net sweep, Baton recomputes each
            PR's state. The whole loop runs without human intervention.
          </p>
        </div>
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="relative border-t border-ink-700 pt-6">
              <span className="absolute -top-px left-0 h-px w-12 bg-brand-500" />
              <p className="font-mono text-xs text-ink-400">Step {step.n}</p>
              <h3 className="mt-3 text-lg font-semibold text-ink-50">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Status card produced by the product */}
      <section className="border-y border-ink-800/80 bg-ink-900/40">
        <div className="container-page grid items-center gap-12 py-20 md:py-24 lg:grid-cols-2">
          <div className="max-w-xl">
            <p className="eyebrow">In the pull request</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
              The state of the PR, where you are already reading
            </h2>
            <p className="mt-4 leading-relaxed text-ink-300">
              Baton posts one comment at the top of the thread, updates it in place, and keeps a
              matching label on the PR. Reviewers and authors see the same single source of truth
              without opening another tab.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                "Who has to act next",
                "How long the PR has been in its current state",
                "The one next action that unblocks it",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-ink-200">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <StatusCommentCard />
        </div>
      </section>

      {/* State engine */}
      <section id="states" className="container-page pb-20 pt-24 md:pt-32">
        <div className="max-w-2xl">
          <p className="eyebrow">The state engine</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
            One of eight states, for every PR
          </h2>
          <p className="mt-4 leading-relaxed text-ink-300">
            Each state has a precise definition and an owner. Baton never picks a state out of the
            air; every one follows from GitHub's own data.
          </p>
        </div>
        <div className="mt-12 overflow-hidden rounded-xl border border-ink-800">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink-800 bg-ink-900/60 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-ink-400 sm:grid">
            <span className="col-span-4">State</span>
            <span className="col-span-4">Label</span>
            <span className="col-span-4">Whose turn</span>
          </div>
          <ul className="divide-y divide-ink-800/80 bg-ink-900/25">
            {STATES.map((s) => (
              <li
                key={s.label}
                className="grid grid-cols-2 gap-4 px-6 py-4 text-sm sm:grid-cols-12"
              >
                <span className="col-span-2 flex items-center gap-3 text-ink-100 sm:col-span-4">
                  <Chip tone={s.tone}>{s.state}</Chip>
                </span>
                <span className="col-span-2 sm:col-span-4">
                  <code className="text-xs text-ink-400">{s.label}</code>
                </span>
                <span className="col-span-2 text-ink-200 sm:col-span-4">{s.turn}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-sm text-ink-400">
          Draft, checks pending, merged, and closed round out the model. See the full state
          definitions in the <Link href="/docs#states" className="link">documentation</Link>.
        </p>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-ink-800/80">
        <div className="container-page py-20 md:py-24">
          <div className="max-w-2xl">
            <p className="eyebrow">Why Baton</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
              Built around how reviews actually stall
            </h2>
          </div>
          <div className="mt-12 grid gap-x-12 gap-y-12 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-700 bg-ink-900 text-brand-300">
                  <f.icon className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink-50">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security strip */}
      <section className="container-page pb-20">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 px-6 py-8 md:px-10">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink-50">
                Read-only on your code
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
                Baton works inside GitHub's permission model. It never reads your source, diffs, or
                file contents, and its write access is limited to PR comments and labels.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {PERMISSIONS.map((p) => (
                  <span
                    key={p}
                    className="rounded-md border border-ink-700/70 bg-ink-900 px-2.5 py-1 text-xs text-ink-300"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <Link href="/security" className="btn btn-ghost">
              Read the security model
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container-page pb-24 md:pb-32">
        <div className="flex flex-col items-center gap-6 border-t border-ink-800 pt-16 text-center md:pt-20">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-ink-50 md:text-4xl">
            Stop asking "who's on this?" in Slack
          </h2>
          <p className="max-w-xl text-ink-300">
            A PR that sits quietly costs a day here, a day there. Baton puts the answer on the PR
            itself, before anyone has to ask.
          </p>
          <Link href="/auth/login?next=/dashboard" className="btn btn-primary btn-lg">
            Install Baton free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-warn/30 bg-warn/10 text-warn"
      : tone === "danger"
        ? "border-danger/30 bg-danger/10 text-danger"
        : tone === "success"
          ? "border-signal-500/30 bg-signal-500/10 text-signal-400"
          : "border-brand-500/25 bg-brand-500/10 text-brand-300";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function HeroPreview() {
  return (
    <div className="relative">
      <div className="rounded-xl border border-ink-700/70 bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
          </div>
          <span className="font-mono text-xs text-ink-500">github.com/acme/web</span>
        </div>
        <div className="px-4 py-5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-300">
              B
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-ink-100">
                baton[bot]
                <span className="rounded-md border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
                  BOT
                </span>
              </p>
              <p className="text-xs text-ink-500">commented just now</p>
            </div>
          </div>
          <div className="mt-4">
            <span className="chip-info">Waiting for review</span>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="text-ink-500">Whose turn</dt>
                <dd className="font-medium text-ink-100">@rew-ann, @dev-niel</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-ink-500">Blocked for</dt>
                <dd className="font-medium text-ink-100">3d 4h</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-ink-500">Next action</dt>
                <dd className="font-medium text-signal-400">Review the latest changes</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-ink-800 px-4 py-2.5 text-xs text-ink-500 sm:px-5">
          <span>Status by Baton, updates automatically</span>
          <code className="text-ink-400">baton:awaiting-review</code>
        </div>
      </div>
    </div>
  );
}

function StatusCommentCard() {
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-900">
      <div className="px-4 py-5 sm:px-5">
        <div className="flex flex-wrap gap-2">
          <span className="chip-info">Waiting for review</span>
          <span className="chip-neutral">#142</span>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-6 border-b border-ink-800/70 pb-3">
            <dt className="text-ink-500">Whose turn</dt>
            <dd className="font-medium text-ink-100">@rew-ann, @dev-niel</dd>
          </div>
          <div className="flex items-center justify-between gap-6 border-b border-ink-800/70 pb-3">
            <dt className="text-ink-500">Blocked for</dt>
            <dd className="font-medium text-ink-100">3d 4h</dd>
          </div>
          <div className="flex items-center justify-between gap-6 border-b border-ink-800/70 pb-3">
            <dt className="text-ink-500">Why</dt>
            <dd className="text-right text-ink-200">Approved, then author pushed 2 new commits</dd>
          </div>
          <div className="flex items-center justify-between gap-6">
            <dt className="text-ink-500">Next action</dt>
            <dd className="font-medium text-signal-400">Review the latest changes</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}