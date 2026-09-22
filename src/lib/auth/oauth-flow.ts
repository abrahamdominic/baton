import { prisma } from "../db";
import { logger } from "../logger";
import { fetchGitHubUser, fetchUserInstallations } from "./github-oauth";
import { createSession, defaultRoleForLogin, type SessionUser } from "./session";
import { enqueueInstallRegister } from "../engine/jobs";

export interface FinishOAuthSignInParams {
  accessToken: string;
  next: string;
  installationId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface FinishOAuthSignInResult {
  user: SessionUser;
  token: string;
  expiresAt: Date;
  next: string;
  installationIds: number[];
}

/**
 * Complete an OAuth sign-in: resolve the GitHub user, upsert the Baton user,
 * create a server-side session, and link any GitHub App installations to the
 * account. Throws on failure so the caller can route to `/?oauth_error=1`.
 */
export async function finishOAuthSignIn(
  params: FinishOAuthSignInParams,
): Promise<FinishOAuthSignInResult> {
  const { accessToken, next, installationId } = params;

  const gh = await fetchGitHubUser(accessToken);

  const user = await prisma.user.upsert({
    where: { githubId: gh.id },
    create: {
      githubId: gh.id,
      login: gh.login,
      name: gh.name,
      email: gh.email,
      avatarUrl: gh.avatar_url,
      role: defaultRoleForLogin(gh.login),
    },
    update: {
      login: gh.login,
      name: gh.name,
      email: gh.email,
      avatarUrl: gh.avatar_url,
    },
  });

  const session = await createSession(user.id, {
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });

  // Combined flow: GitHub App installation plus freshly-authorized token.
  if (installationId !== null && installationId !== undefined && installationId > 0) {
    try {
      const existing = await prisma.appInstallation.findUnique({
        where: { installationId },
        select: { userId: true },
      });
      if (!existing) {
        await prisma.appInstallation.create({
          data: {
            installationId,
            accountLogin: "pending",
            accountType: "User",
            userId: user.id,
          },
        });
      } else if (existing.userId !== user.id) {
        await prisma.appInstallation.update({
          where: { installationId },
          data: { userId: user.id },
        });
      }
      void enqueueInstallRegister(installationId).catch(() => {});
    } catch (e) {
      logger.warn("oauth-link-installation-failed", { error: String(e), installationId });
    }
  }

  // Link every installation reachable with the user's token to this account.
  // Only GitHub App user-to-server tokens (`ghu_`) can list installations;
  // standalone OAuth App tokens (`gho_`) get a 401 back, so skip the call.
  const installationIds = accessToken.startsWith("ghu_")
    ? await fetchUserInstallations(accessToken).catch(() => [])
    : [];
  if (installationIds.length > 0) {
    await prisma.appInstallation.updateMany({
      where: { installationId: { in: installationIds } },
      data: { userId: user.id },
    });
    for (const id of installationIds) void enqueueInstallRegister(id).catch(() => {});
  }

  logger.info("oauth-signin", { login: gh.login, installations: installationIds.length, ip: params.ip });

  return {
    user: {
      id: user.id,
      githubId: user.githubId,
      login: user.login,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      suspendedAt: user.suspendedAt,
    },
    token: session.token,
    expiresAt: session.expiresAt,
    next,
    installationIds,
  };
}