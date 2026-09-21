# Product

## The problem

Engineering teams do not lose most of their time writing code, they lose it
waiting for code to move. Pull requests routinely sit for days because the
responsibility for the next action is implicit:

- Reviewers don't know a PR is waiting on them.
- Authors don't know a reviewer is waiting on a response.
- Maintainers don't know a PR is approved and green but unmerged.
- Everyone asks the same question in Slack: *"whose turn is this?"*

The data is unambiguous:

- Around **89% of PR cycle time** is spent waiting, not working.
- The average PR waits **2–6 days** for its first review.
- Some repos have **160+ of 167** PRs with zero review engagement; the longest
  waits stretch to hundreds of days.
- GitHub's own documentation includes a section titled *"Who am I blocking?"*, 
  a tacit admission that the platform does not answer this today.

Existing tools either only notify you of what's *new* (reviewer requests), only
flag PRs as *stale* with blunt time rules, or live outside GitHub in a separate
dashboard nobody checks.

## The thesis

> Developers currently spend hours hunting for stalled pull requests and working
> out whose turn it is. Baton tracks the state of every open PR, puts the answer
> where the work already is, inside the pull request, and then nudges exactly
> the person who can unblock it.

Baton wins by being **GitHub-native** (the value appears in the PR thread, not in
yet another dashboard), **deterministic** (no AI guesswork in the critical path),
and **polite** (a bounded, configurable number of nudges, never spam).

## Personas

- **The reviewer drowning in requests**: wants to know which of the many PRs
  truly needs them and how long they've been blocking others.
- **The PR author**: wants to know why their PR is stuck and who to ping.
- **The tech lead / maintainer**: wants a pulse on the repo: what's stalled,
  what's about to rot, what's one click from done.

## The core loop

1. Install the GitHub App on chosen repos.
2. Baton observes every PR event (and sweeps on a schedule as a safety net).
3. It classifies each PR into exactly one state and answers *whose turn is it*.
4. It surfaces that answer as a live status comment and a `baton:*` label.
5. Past your threshold, it sends one targeted `@mention`.
6. You check the **Your Move** dashboard for your slice of that same picture.

## What Baton is *not*

- **Not a code review bot.** It doesn't comment on code quality or read diffs.
- **Not an AI summarizer.** Classification is a deterministic state machine.
- **Not a project tracker.** It complements Jira/Linear rather than replacing them.
- **Not a blocker.** It never approves, merges, or gates PRs. It informs and nudges.

## Positioning

| Alternative | Gap Baton fills |
| --- | --- |
| GitHub's native review requests | Only tells you about *new* requests, not stalls or follow-ups. |
| Stale-PR bots | Blunt time rules; blames the wrong party; no state awareness. |
| AI code-review tools | Review code quality, not workflow state; can be noisy. |
| Standalone team dashboards | Outside GitHub; another tab nobody visits. |

## Pricing

- **Individual, $0.** Up to 3 repos, full status card, labels, and dashboard.
- **Team, $10/user/mo.** Unlimited repos, per-repo thresholds, board views ($8/user/mo billed annually).
- **Organization, custom.** SSO, audit-log export, SLAs, onboarding.
- **Open source, Team free on public repos.**

## Growth channels

1. **GitHub Marketplace** listing, natural discovery for a GitHub App.
2. **Open-source launch**: AGPL-3.0, "Show HN", and a public dashboard of
   aggregate PR-stall statistics as a linkable data asset.
3. **Content/SEO**: landing page plus `/pricing`, `/faq`, `/security`, `/docs`,
   `/sitemap.xml`, `/robots.txt` for organic search.
4. **In-product virality**: every status comment and nudge in a public repo
   carries a subtle Baton signature, so maintainers of other repos see it.
5. **Integrations**: Slack/Teams notifications (post-MVP) and a public API.

## Roadmap

- **MVP (this repository):** webhook pipeline, deterministic classifier, status
  comment, labels, nudges, Your Move dashboard, OAuth, SEO, tests, docs.
- **Next:** Slack/Teams digests, per-reviewer load views, merge-order suggestions.
- **Later:** self-hosted edition, SSO/SCIM, audit exports, org analytics.
