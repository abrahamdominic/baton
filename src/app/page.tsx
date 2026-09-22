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
  IconGitHub,
  IconZap,
  IconLock,
  IconAlertCircle,
} from "@/components/icons";
import { PrSimulator } from "@/components/pr-simulator";
import { StateMatrix } from "@/components/state-matrix";
import { RoiCalculator } from "@/components/roi-calculator";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  title: "Baton: Know whose turn it is on every pull request",
  description:
    "Deterministic GitHub App that tracks PR review state, surfaces the blocker in the thread, and nudges the right person when work stalls. Metadata-only permissions.",
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
        description: "Free for individuals on up to 3 repositories and free for public open source.",
      },
    },
  ],
};

const STATS = [
  {
    value: "89%",
    label: "of PR cycle time is spent waiting, not writing code",
    detail: "Measured across open-source and team repositories",
  },
  {
    value: "2-6 days",
    label: "the typical wait before the first review lands",
    detail: "Context decays with every passing day",
  },
  {
    value: "0 diffs",
    label: "read, parsed, or stored by Baton",
    detail: "Least-privilege GitHub App permissions only",
  },
  {
    value: "100%",
    label: "deterministic state engine",
    detail: "Pure state machine without flaky LLM guessing",
  },
];

const FEATURES = [
  {
    icon: IconBranch,
    title: "Pinned live status card",
    body: "Baton maintains one single, always-updated status comment at the top of the pull request. State, current owner, duration in state, and next unblocking action are always visible.",
  },
  {
    icon: IconLayers,
    title: "State labels on GitHub",
    body: "One canonical baton:* label mirrors the PR state in real time. Works seamlessly with your existing GitHub search filters, notification routing, and triage workflows.",
  },
  {
    icon: IconBell,
    title: "Targeted, polite nudges",
    body: "At most one nudge per state, sent only after your configured grace period (e.g. 24h, 48h). Mentions only the person who can unblock the PR, never spamming the whole team.",
  },
  {
    icon: IconActivity,
    title: "Deterministic whose-turn engine",
    body: "Reviews, review requests, CI checks, merge conflicts, and draft status feed into a verifiable finite-state machine. No heuristics, no AI hallucinations in the critical path.",
  },
  {
    icon: IconGauge,
    title: "Your Move command center",
    body: "A clean developer dashboard grouping PRs by who needs to act next. Your queue is front and center so you can unblock teammates first thing in the morning.",
  },
  {
    icon: IconShield,
    title: "No source code read access",
    body: "Baton requests only Pull requests and Issues read/write (for comments/labels), plus read-only Checks and Metadata. It never requests Contents, ASTs, or Secrets.",
  },
];

const COMPARISONS = [
  {
    dimension: "How it decides ownership",
    baton: "Deterministic state machine using GitHub review decisions, commits, CI, and mergeability",
    staleBot: "Blunt time rules (e.g. 'no activity in 30 days')",
    slackPings: "Manual human memory and ad-hoc Slack reminders",
  },
  {
    dimension: "Where the status lives",
    baton: "Pinned comment and labels inside the PR thread + dashboard",
    staleBot: "A noisy bot comment after weeks of silence",
    slackPings: "Lost in Slack threads and direct messages",
  },
  {
    dimension: "Who gets nudged",
    baton: "Exactly the one blocker (reviewer or author) past the threshold",
    staleBot: "Blames the author regardless of who is stalled",
    slackPings: "Interrupts whoever checks Slack first",
  },
  {
    dimension: "Source code access",
    baton: "Metadata-only access (Pull requests and Checks metadata only)",
    staleBot: "Usually requires broad repository access",
    slackPings: "N/A",
  },
];

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{
    oauth_config?: string;
    oauth_error?: string;
    oauth_denied?: string;
    reason?: string;
  }>;
}) {
  const sp = searchParams ? await searchParams : undefined;

  const OAUTH_ERROR_MESSAGES: Record<string, string> = {
    exchange_failed:
      "GitHub rejected the sign-in credentials. Confirm the OAuth Client ID and Client secret, and that https://baton-xi.vercel.app/auth/callback is registered as the callback URL on the GitHub App.",
    github_api:
      "GitHub could not complete the sign-in on its end (GitHub API error). Please try signing in again in a moment.",
    state_mismatch:
      "Your sign-in request expired or was replayed. Please sign in again from the header — no harm done, just retry.",
    iss_mismatch:
      "Sign-in was rejected for security reasons (unexpected OAuth issuer). Please try signing in again.",
    server_error:
      "Sign-in could not be completed because the service database is currently unavailable. Please try again shortly.",
    db_misconfigured:
      "Sign-in could not be completed because the service database is not configured on this deployment.",
    db_unreachable:
      "Sign-in could not be completed because the service database could not be reached. Please try again shortly.",
  };

  const oauthBanner = sp?.oauth_config
    ? "GitHub sign-in is temporarily unavailable on this deployment because OAuth credentials are not configured. The GitHub App install flow still works."
    : sp?.oauth_error
      ? (sp.reason && OAUTH_ERROR_MESSAGES[sp.reason]) ||
        "GitHub sign-in failed. Please try again, or install the GitHub App directly from the header."
      : sp?.oauth_denied
        ? "GitHub sign-in was cancelled. No problem, you can keep browsing or install Baton from the header."
        : null;

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
      />
      <MarketingHeader />

      {oauthBanner ? (
        <div
          role="alert"
          className="container-page flex items-start justify-between gap-4 rounded-b-xl border border-warn-500/30 border-t-0 bg-warn-500/10 px-4 py-3 text-xs text-warn-200"
        >
          <span>{oauthBanner}</span>
          <IconAlertCircle className="h-4 w-4 shrink-0 text-warn-300" aria-hidden="true" />
        </div>
      ) : null}

      {/* Hero Section */}
      <section className="border-b border-white/[0.06] pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="container-wide">
          <div className="mx-auto max-w-3xl text-center">
            {/* Top Pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1 text-xs font-medium text-brand-300">
              <span className="flex h-2 w-2 rounded-full bg-signal-500" />
              <span>Baton v0.1</span>
              <span className="text-brand-400/50">·</span>
              <span>Deterministic GitHub App</span>
              <span className="text-brand-400/50">·</span>
              <span className="text-ink-300">AGPL-3.0 Open Source</span>
            </div>

            {/* Main Headline */}
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl sm:leading-[1.1]">
              Know whose turn it is on{" "}
              <span className="text-brand-300">
                every pull request.
              </span>
            </h1>

            {/* Subhead */}
            <p className="mt-6 text-base text-ink-300 sm:text-lg leading-relaxed max-w-2xl mx-auto">
              Engineering teams do not lose time writing code. They lose it waiting for reviews.
              Baton tracks PR state deterministically, surfaces the owner inside the thread, and
              sends one polite nudge when work stalls.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/install" className="btn btn-primary btn-lg">
                <IconGitHub className="h-4 w-4" />
                Install Baton Free
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <a href="#simulator" className="btn btn-ghost btn-lg">
                <IconZap className="h-4 w-4 text-brand-400" />
                Try Live Simulator
              </a>
              <Link href="/docs" className="btn btn-secondary btn-lg">
                Documentation
              </Link>
            </div>

            {/* Trust points */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-400">
              <span className="flex items-center gap-1.5">
                <IconCheck className="h-3.5 w-3.5 text-signal-400" />
                No code or diff access
              </span>
              <span className="flex items-center gap-1.5">
                <IconCheck className="h-3.5 w-3.5 text-signal-400" />
                Installs in 60 seconds
              </span>
              <span className="flex items-center gap-1.5">
                <IconCheck className="h-3.5 w-3.5 text-signal-400" />
                Free for public repositories
              </span>
            </div>
          </div>

          {/* Hero Interactive PR Simulator */}
          <div id="simulator" className="mt-14 max-w-4xl mx-auto">
            <div className="mb-3 flex items-center justify-between px-2 text-xs text-ink-400">
              <span className="font-mono uppercase tracking-wider text-[11px] text-brand-300">
                Live Interactive Product Simulator
              </span>
              <span>Click a scenario to see how Baton acts</span>
            </div>
            <PrSimulator />
          </div>
        </div>
      </section>

      {/* Key Numbers */}
      <section className="border-b border-white/[0.06] bg-ink-900/40">
        <div className="container-page py-12">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.value} className="space-y-1">
                <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-mono">
                  {s.value}
                </div>
                <div className="text-xs font-semibold text-ink-200">{s.label}</div>
                <div className="text-[11px] text-ink-500 leading-snug">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The PR Problem: The Stalled Loop vs The Baton Relay */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Why pull requests stall in engineering teams
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            Responsibility on PRs is almost always implicit. Reviewers do not know they are
            blocking work. Authors do not know when a reviewer is waiting on a reply. The result
            is days of silent drift.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* Without Baton */}
          <div className="rounded-xl border border-danger-500/20 bg-danger-500/[0.03] p-6 sm:p-7">
            <div className="flex items-center justify-between border-b border-danger-500/20 pb-4">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-danger-400">
                Without Baton (Status Quo)
              </span>
              <span className="rounded bg-danger-500/10 px-2 py-0.5 text-xs text-danger-300 font-mono">
                ~4-7 days cycle time
              </span>
            </div>
            <ul className="mt-6 space-y-4 text-xs text-ink-300">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400 font-mono text-[10px]">
                  &times;
                </span>
                <div>
                  <strong className="text-white block font-medium">Reviewer requests drown in email:</strong>
                  Reviewers receive 20+ GitHub notifications daily and miss the initial request.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400 font-mono text-[10px]">
                  &times;
                </span>
                <div>
                  <strong className="text-white block font-medium">Author pushes fixes, reviewer unaware:</strong>
                  The author fixes comments, but GitHub does not make it clear that the ball is back in the reviewer court.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400 font-mono text-[10px]">
                  &times;
                </span>
                <div>
                  <strong className="text-white block font-medium">Ad-hoc Slack interruptions:</strong>
                  Engineers are forced to play detective in Slack: &ldquo;Hey, can someone review #182?&rdquo;
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-danger-400 font-mono text-[10px]">
                  &times;
                </span>
                <div>
                  <strong className="text-white block font-medium">Merge conflicts creep in:</strong>
                  While waiting, base branches move, tests rot, and rebases become painful.
                </div>
              </li>
            </ul>
          </div>

          {/* With Baton */}
          <div className="rounded-xl border border-signal-500/30 bg-signal-500/[0.03] p-6 sm:p-7">
            <div className="flex items-center justify-between border-b border-signal-500/20 pb-4">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-signal-400">
                With Baton (Deterministic Relay)
              </span>
              <span className="rounded bg-signal-500/15 px-2 py-0.5 text-xs text-signal-300 font-mono">
                ~12-24h cycle time
              </span>
            </div>
            <ul className="mt-6 space-y-4 text-xs text-ink-200">
              <li className="flex items-start gap-3">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                <div>
                  <strong className="text-white block font-medium">Single source of truth in the PR:</strong>
                  A pinned card shows state, blocker, and time in state right at the top of the conversation.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                <div>
                  <strong className="text-white block font-medium">Instant turn transitions:</strong>
                  When author pushes commits after review, Baton instantly flips the state to &ldquo;Re-review Due&rdquo;.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                <div>
                  <strong className="text-white block font-medium">Polite, time-boxed notifications:</strong>
                  Exactly one targeted nudge sent only when the threshold expires. Never spam.
                </div>
              </li>
              <li className="flex items-start gap-3">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
                <div>
                  <strong className="text-white block font-medium">Your Move dashboard:</strong>
                  Reviewers see PRs waiting on them in one clean queue. No manual searching needed.
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* How it Works: 3 Deterministic Steps */}
      <section id="how-it-works" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            From GitHub webhook to unblocked PR
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            Baton is purely event-driven. On every pull request action and on a safety sweep schedule,
            the state is re-evaluated using standard GitHub APIs.
          </p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Observe events",
              desc: "GitHub webhook fires with HMAC-SHA256 signature verification. Baton reads review states, checks conclusion, and mergeability status. It never requests or reads source diffs.",
              badge: "HMAC Verified",
            },
            {
              step: "02",
              title: "Deterministic classify",
              desc: "A pure state machine determines which of the 8 canonical states applies, who owns the next move, and calculates the exact duration the PR has been waiting in this state.",
              badge: "0 AI guessing",
            },
            {
              step: "03",
              title: "Surface & nudge",
              desc: "Baton updates its pinned comment, synchronizes the baton:* label, and if the time exceeds your configured grace period, sends exactly one polite @-mention to the blocker.",
              badge: "Configurable grace",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="relative rounded-xl border border-white/[0.08] bg-ink-900/60 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-brand-400">{item.step}</span>
                <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-ink-400">
                  {item.badge}
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-white">{item.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* State Engine Interactive Matrix */}
      <section id="states" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Eight canonical states, zero ambiguity
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            Explore the exact rules Baton uses to assign ownership, labels, and thresholds.
            Every state has a clear definition based entirely on verifiable GitHub data.
          </p>
        </div>

        <StateMatrix />
      </section>

      {/* Feature Grid */}
      <section id="features" className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Built for engineering teams that ship daily
          </h2>
          <p className="mt-4 text-sm text-ink-300">
            No fluff, no noisy notifications, no heavy dashboards nobody opens.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-6 transition-all hover:border-white/[0.14] hover:bg-ink-850/70"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Wait Calculator */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            How many hours is your team waiting?
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            Adjust the sliders to estimate how many hours of PR stall time Baton can eliminate
            for your engineering team.
          </p>
        </div>

        <RoiCalculator />
      </section>

      {/* Comparison Grid */}
      <section className="container-page py-20 md:py-28 border-b border-white/[0.06]">
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Why teams choose Baton over alternatives
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            See how Baton compares against generic stale bots and manual Slack nudging.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-ink-900/80 font-mono uppercase text-[11px] text-ink-400">
                <th className="py-4 pl-6 pr-4 font-semibold">Capability</th>
                <th className="py-4 px-4 font-semibold text-brand-300">Baton</th>
                <th className="py-4 px-4 font-semibold">Stale-PR Bots</th>
                <th className="py-4 pr-6 pl-4 font-semibold">Slack Reminders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] bg-ink-950/40">
              {COMPARISONS.map((row) => (
                <tr key={row.dimension}>
                  <td className="py-4 pl-6 pr-4 font-semibold text-white">{row.dimension}</td>
                  <td className="py-4 px-4 font-medium text-brand-200 bg-brand-500/[0.03]">
                    {row.baton}
                  </td>
                  <td className="py-4 px-4 text-ink-400">{row.staleBot}</td>
                  <td className="py-4 pr-6 pl-4 text-ink-400">{row.slackPings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security Guarantee Strip */}
      <section className="container-page py-20 md:py-24">
        <div className="rounded-2xl border border-white/[0.1] bg-ink-900 p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.4fr_auto] items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase text-signal-400">
                <IconLock className="h-4 w-4" />
                Metadata-Only Security Guarantee
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
                Baton never reads your repository code or diffs
              </h2>
              <p className="mt-3 text-xs leading-relaxed text-ink-300 max-w-2xl">
                Baton works within GitHub least-privilege permission model. It does not request
                repository Contents, Workflows, or Secrets. Write access is strictly limited to
                posting PR comments and managing state labels.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {[
                  "Pull requests (read/write)",
                  "Issues (read/write for labels)",
                  "Checks (read-only)",
                  "Metadata (read-only)",
                  "Contents: NO ACCESS",
                ].map((perm) => (
                  <span
                    key={perm}
                    className="rounded-md border border-white/[0.08] bg-ink-950 px-2.5 py-1 font-mono text-[11px] text-ink-300"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <Link href="/security" className="btn btn-ghost">
                Read Security Architecture
                <IconArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final Call to Action */}
      <section className="border-t border-white/[0.06] bg-ink-900 py-24">
        <div className="container-page text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Stop asking &ldquo;who&apos;s on this?&rdquo; in Slack.
          </h2>
          <p className="mt-4 max-w-xl mx-auto text-sm text-ink-300 leading-relaxed">
            Install the GitHub App in under two minutes. Free for individual developers and
            open-source repositories.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/install" className="btn btn-primary btn-lg">
              <IconGitHub className="h-4 w-4" />
              Install Baton Free
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="btn btn-ghost btn-lg">
              View Team Pricing
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] text-ink-500">
            No credit card required · Uninstall anytime with one click
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}