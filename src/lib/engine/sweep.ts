import { prisma } from "../db";
import { logger } from "../logger";
import { enqueuePrRefresh } from "./jobs";
import { installationClients } from "../github/app";

/**
 * Walk every enabled repo belonging to an active installation and enqueue a
 * refresh for each open PR. Used by the cron sweep and manual "re-scan".
 */
export async function sweepEnabledRepos(): Promise<{
  repos: number;
  prsEnqueued: number;
}> {
  const installations = await prisma.appInstallation.findMany({
    where: { uninstalledAt: null },
    include: {
      repos: {
        where: { enabled: true },
        select: { installation: false, owner: true, name: true },
      },
    },
  });

  let repos = 0;
  let prsEnqueued = 0;

  for (const installation of installations) {
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

  logger.info("sweep-complete", { installations: installations.length, repos, prsEnqueued });
  return { repos, prsEnqueued };
}

async function sweepRepo(installationId: number, owner: string, name: string): Promise<number> {
  const { rest } = await installationClients(installationId);
  const res = await rest.pulls.list({
    owner,
    repo: name,
    state: "open",
    per_page: 100,
    sort: "updated",
    direction: "desc",
  });
  let enqueued = 0;
  for (const pr of res.data) {
    if (pr.draft) continue;
    await enqueuePrRefresh(installationId, owner, name, pr.number);
    enqueued += 1;
  }
  return enqueued;
}