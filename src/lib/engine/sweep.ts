import { prisma } from "../db";
import { logger } from "../logger";
import { enqueuePrRefresh, enqueueRepoIntel } from "./jobs";
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

export async function sweepEnabledRepos(): Promise<{
  repos: number;
  prsEnqueued: number;
  intelEnqueued: number;
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
        },
      },
    },
  });

  let repos = 0;
  let prsEnqueued = 0;
  let intelEnqueued = 0;

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
    }

    for (const repo of installation.repos) {
      const counted = await sweepRepo(installation.installationId, repo.owner, repo.name).catch(
        (e) => {
          logger.error("sweep-repo-failed", {
            installationId: installation.installationId,
            owner: repo.owner,
            name: repo.name,
            error: String(e),
          });
          return 0;
        },
      );
      repos += 1;
      prsEnqueued += counted;
    }
  }

  logger.info("sweep-complete", {
    installations: installations.length,
    repos,
    prsEnqueued,
    intelEnqueued,
  });
  return { repos, prsEnqueued, intelEnqueued };
}

async function sweepRepo(installationId: number, owner: string, name: string): Promise<number> {
  const { rest } = await installationClients(installationId);
  let enqueued = 0;
  // Paginate: a single page silently dropped the oldest open PRs — exactly the
  // long-stalled ones the sweep exists to find — on any repo with more than 100
  // open non-draft PRs.
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
      await enqueuePrRefresh(installationId, owner, name, pr.number);
      enqueued += 1;
    }
  }
  return enqueued;
}