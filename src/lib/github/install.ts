import type { Repo } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { getInstallationToken } from "./app";

export interface InstallationInfo {
  installationId: number;
  accountLogin: string;
  accountType: string;
  targetType: string | null;
  appId: number | null;
  repositories: { id: number; name: string; fullName: string; defaultBranch: string; private: boolean }[];
}

/**
 * Fetch an installation's details + repos from the GitHub API using the app token.
 */
export async function fetchInstallationInfo(installationId: number): Promise<InstallationInfo> {
  const token = await getInstallationToken(installationId);
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "baton",
  };

  const inst = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    { headers },
  ).then((r) => r.json() as Promise<any>);
  if (!inst.id) {
    throw new Error(`GitHub API returned no installation for ${installationId}`);
  }

  const repoRes = await fetch(
    `https://api.github.com/installation/repositories?per_page=100`,
    { headers },
  ).then((r) => r.json() as Promise<any>);

  const repos = (repoRes.repositories ?? []).map((r: any) => ({
    id: Number(r.id),
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch ?? "main",
    private: Boolean(r.private),
  }));

  return {
    installationId: inst.id,
    accountLogin: inst.account?.login ?? "unknown",
    accountType: inst.account?.type ?? "User",
    targetType: inst.target_type ?? null,
    appId: inst.app_id ?? null,
    repositories: repos,
  };
}

/**
 * Persist an installation + its repositories. Idempotent — safe to call on
 * `installation.created`, `installation_repositories`, and on lazy registration
 * from a webhook/worker.
 */
export async function registerInstallation(
  installationId: number,
  opts: { accountLogin?: string | null; accountType?: string | null } = {},
): Promise<InstallationInfo> {
  let info: InstallationInfo;
  try {
    info = await fetchInstallationInfo(installationId);
  } catch (e) {
    logger.error("installation-info-fetch-failed", { installationId, error: String(e) });
    throw e;
  }

  const accountLogin = opts.accountLogin ?? info.accountLogin;
  const accountType = opts.accountType ?? info.accountType;

  // Link the installation to a local user whose GitHub login matches, so the
  // per-person dashboard only shows repos the user actually installed on.
  const user = await prisma.user.findFirst({
    where: { login: accountLogin },
  });

  const installation = await prisma.appInstallation.upsert({
    where: { installationId: Number(installationId) },
    create: {
      installationId: Number(installationId),
      accountLogin,
      accountType,
      userId: user?.id ?? null,
    },
    update: {
      accountLogin,
      accountType,
      userId: user?.id ?? null,
      uninstalledAt: null,
    },
  });

  for (const r of info.repositories) {
    await prisma.repo.upsert({
      where: { repoId: BigInt(r.id) },
      create: {
        installationId: installation.id,
        repoId: BigInt(r.id),
        owner: r.fullName.split("/")[0],
        name: r.name,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch,
        isPrivate: r.private,
        enabled: true,
      },
      update: {
        owner: r.fullName.split("/")[0],
        name: r.name,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch,
        isPrivate: r.private,
      },
    });
    // ensure settings exist
    const repo = await prisma.repo.findUnique({ where: { repoId: BigInt(r.id) } });
    if (repo) {
      await prisma.repoSetting.upsert({
        where: { repoId: repo.id },
        create: { repoId: repo.id },
        update: {},
      });
    }
  }

  // Repos that were removed from the installation must stop being processed.
  await prisma.repo.updateMany({
    where: {
      installationId: installation.id,
      repoId: { notIn: info.repositories.map((r) => BigInt(r.id)) },
    },
    data: { enabled: false },
  });

  logger.info("installation-registered", {
    installationId,
    accountLogin,
    repos: info.repositories.length,
  });

  return info;
}

/**
 * Handle app uninstall / uninstalledAt: stop processing, disable repos,
 * drop snapshots per retention policy. Personal data is purged immediately for
 * installations; event/job history is retained briefly for debugging.
 */
export async function handleUninstall(installationId: number): Promise<void> {
  const installation = await prisma.appInstallation.findUnique({
    where: { installationId: Number(installationId) },
    include: { repos: true },
  });
  if (!installation) {
    logger.warn("uninstall-unknown-installation", { installationId });
    return;
  }

  await prisma.$transaction([
    prisma.appInstallation.update({
      where: { id: installation.id },
      data: { uninstalledAt: new Date() },
    }),
    prisma.repo.updateMany({
      where: { installationId: installation.id },
      data: { enabled: false },
    }),
    prisma.pullRequest.deleteMany({
      where: { repoId: { in: installation.repos.map((r) => r.id) } },
    }),
    prisma.action.deleteMany({
      where: { repoId: { in: installation.repos.map((r) => r.id) } },
    }),
  ]);

  logger.info("installation-uninstalled", { installationId, repos: installation.repos.length });
}

/**
 * Reconcile a repo at a given installation (used when a PR event arrives for a
 * repo we did not yet register). Returns the Repo row or null if the repo is
 * not part of the installation.
 */
export async function ensureRepoRegistered(
  installationId: number,
  owner: string,
  name: string,
): Promise<{ repo: Repo; enabled: boolean } | null> {
  const existing = await prisma.repo.findFirst({
    where: { installation: { installationId: Number(installationId) }, owner, name },
  });
  if (existing) {
    await prisma.repoSetting.upsert({
      where: { repoId: existing.id },
      create: { repoId: existing.id },
      update: {},
    });
    return { repo: existing, enabled: existing.enabled };
  }

  // Lazy-register the whole installation (including this repo).
  try {
    await registerInstallation(installationId);
  } catch (e) {
    logger.error("lazy-register-failed", { installationId, owner, name, error: String(e) });
    return null;
  }
  const repo = await prisma.repo.findFirst({
    where: { installation: { installationId: Number(installationId) }, owner, name },
  });
  if (!repo) return null;
  return { repo, enabled: repo.enabled };
}