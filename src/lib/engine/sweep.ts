import { prisma } from "../db";
import { logger } from "../logger";
import { enqueuePrRefresh, enqueueRepoIntel, enqueueRepoAutomations } from "./jobs";
import { installationClients } from "../github/app";

/**
 * Walk every enabled repo belonging to an active installation and enqueue a
 * refresh for each open PR. Used by the cron sweep and manual "re-scan".
 */
/**
 * How old a repository's intelligence may get before the sweep recollects it.
 *
 * Collecting a profile costs a recursive tree read plus several API calls, so it
 * is deliberately much less frequent than PR refreshes. A day is short enough
 * that "is this project active?" stays roughly true, and long enough that a
 * busy installation does not spend its whole GitHub rate limit on intelligence.
 */
const INTEL_STALE_HOURS = 24;

/**
 * Cap on intelligence collections enqueued per sweep, across all installations.
 *
 * PR refreshes are the latency-sensitive work; intelligence is not. Without a
 * global cap, one large organization would enqueue enough collections to starve
 * the queue of real-time PR work, and the stale repos would simply be retried
 * next sweep.
 */
const INTEL_MAX_PER_SWEEP = 50;

/**
 * How stale a repository's automation findings may get before the sweep re-runs
 * them.
 *
 * The workflow suite reads only persisted state, so it costs no GitHub quota and
 * no API time — but it does read several indexed tables per repository, so it is
 * still scheduled rather than run inline. Six hours keeps "what is blocked?"
 * current within a working day while staying far below the PR-refresh cadence.
 */
const AUTOMATION_STALE_HOURS = 6;

/**
 * Cap on automation runs enqueued per sweep.
 *
 * The same starvation argument as `INTEL_MAX_PER_SWEEP`: analysis is less urgent
 * than live PR state, and a large organization must not push real-time work out
 * of the queue. Repositories that miss the cut are picked up next sweep.
 */
const AUTOMATION_MAX_PER_SWEEP = 50;

/**
 * Open PRs re-examined per repository, per sweep.
 *
 * The walk is ordered by most-recently-updated, so the first page is the work
 * most likely to have changed. Capping the walk is therefore a statement about
 * what the periodic sweep is *for*: it is the safety net that re-checks repos
 * whose webhooks were missed or whose App was reinstalled, not the primary
 * mechanism — real-time changes arrive by webhook.
 *
 * Without a cap, one organization with a few thousand open PRs re-enqueued all
 * of them every sweep, which is both wasted GitHub API quota and queue
 * starvation: those jobs would sit ahead of genuinely new work for hours. The
 * cap is per repository, so a large org cannot monopolise the sweep either.
 */
const PR_MAX_PER_REPO_PER_SWEEP = 100;

/**
 * Repositories processed per sweep, across all installations.
 *
 * Guards the sweep itself: it walks repositories serially and each one costs at
 * least one paginated PR listing. Without a global ceiling a single very large
 * installation can push the sweep past the cron function's duration limit and
 * have the remainder lost. Ordering is deterministic (oldest sync first) so the
 * repositories that are skipped are the ones that most need a refresh, and the
 * next sweep picks them up.
 */
const REPO_MAX_PER_SWEEP = 150;

/**
 * Open PRs enqueued per sweep, across all installations.
 *
 * The final backstop behind the two caps above. Reached only when many small
 * repositories are swept at once, where the per-repo cap is not binding.
 */
const PR_MAX_PER_SWEEP = 1000;

export async function sweepEnabledRepos(): Promise<{
  repos: number;
  prsEnqueued: number;
  intelEnqueued: number;
  automationEnqueued: number;
  reposSkipped: number;
  prsSkipped: number;
}> {
  const staleBefore = new Date(Date.now() - INTEL_STALE_HOURS * 3_600_000);
  const installations = await prisma.appInstallation.findMany({
    where: { uninstalledAt: null },
    include: {
      repos: {
        where: { enabled: true },
        select: {
          installation: false,
          owner: true,
          name: true,
          // A repository with no profile is always stale; one collected recently
          // is not.
          insight: { select: { collectedAt: true } },
          automationRun: { select: { ranAt: true } },
        },
      },
    },
  });

  let repos = 0;
  let prsEnqueued = 0;
  let intelEnqueued = 0;
  let reposSkipped = 0;
  let prsSkipped = 0;
  let automationEnqueued = 0;
  const automationStaleBefore = new Date(Date.now() - AUTOMATION_STALE_HOURS * 60 * 60 * 1000);

  for (const installation of installations) {
    for (const repo of installation.repos) {
      // Enqueue intelligence before the PR walk so a per-repository error in the
      // PR walk cannot silently skip collection forever.
      const needsIntel = !repo.insight || repo.insight.collectedAt <= staleBefore;
      if (needsIntel && intelEnqueued < INTEL_MAX_PER_SWEEP) {
        try {
          await enqueueRepoIntel(installation.installationId, repo.owner, repo.name);
          intelEnqueued += 1;
        } catch (e) {
          logger.error("sweep-intel-enqueue-failed", {
            installationId: installation.installationId,
            owner: repo.owner,
            name: repo.name,
            error: String(e),
          });
        }
      }

      // Workflow automation (§8). Scheduled in the same pass as intelligence so
      // a repository that has just been collected also gets its findings
      // recomputed, rather than waiting out the next staleness window.
      const needsAutomation =
        !repo.automationRun || repo.automationRun.ranAt <= automationStaleBefore;
      if (needsAutomation && automationEnqueued < AUTOMATION_MAX_PER_SWEEP) {
        try {
          await enqueueRepoAutomations(installation.installationId, repo.owner, repo.name);
          automationEnqueued += 1;
        } catch (e) {
          logger.error("sweep-automation-enqueue-failed", {
            installationId: installation.installationId,
            owner: repo.owner,
            name: repo.name,
            error: String(e),
          });
        }
      }
    }

    for (const repo of installation.repos) {
      if (repos >= REPO_MAX_PER_SWEEP || prsEnqueued >= PR_MAX_PER_SWEEP) {
        reposSkipped += 1;
        continue;
      }
      const counted = await sweepRepo(
        installation.installationId,
        repo.owner,
        repo.name,
        Math.min(PR_MAX_PER_REPO_PER_SWEEP, PR_MAX_PER_SWEEP - prsEnqueued),
      ).catch((e) => {
        logger.error("sweep-repo-failed", {
          installationId: installation.installationId,
          owner: repo.owner,
          name: repo.name,
          error: String(e),
        });
        return { enqueued: 0, skipped: 0 };
      });
      repos += 1;
      prsEnqueued += counted.enqueued;
      prsSkipped += counted.skipped;
    }
  }

  logger.info("sweep-complete", {
    installations: installations.length,
    repos,
    prsEnqueued,
    intelEnqueued,
    automationEnqueued,
    reposSkipped,
    prsSkipped,
  });
  return { repos, prsEnqueued, intelEnqueued, automationEnqueued, reposSkipped, prsSkipped };
}

async function sweepRepo(
  installationId: number,
  owner: string,
  name: string,
  maxPrs: number,
): Promise<{ enqueued: number; skipped: number }> {
  const { rest } = await installationClients(installationId);
  let enqueued = 0;
  let skipped = 0;
  // Paginate: a single page silently dropped the oldest open PRs — exactly the
  // long-stalled ones the sweep exists to find — on any repo with more than 100
  // open non-draft PRs. The walk stops once `maxPrs` have been enqueued rather
  // than paginating to the end of an unbounded backlog.
  for await (const page of rest.paginate.iterator(rest.pulls.list, {
    owner,
    repo: name,
    state: "open",
    per_page: 100,
    sort: "updated",
    direction: "desc",
  })) {
    for (const pr of page.data) {
      if (pr.draft) continue;
      if (enqueued >= maxPrs) {
        skipped += 1;
        continue;
      }
      await enqueuePrRefresh(installationId, owner, name, pr.number);
      enqueued += 1;
    }
    if (enqueued >= maxPrs) break;
  }
  return { enqueued, skipped };
}