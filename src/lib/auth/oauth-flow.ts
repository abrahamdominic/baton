import { prisma } from "../db";
import { logger } from "../logger";
import { fetchGitHubUser, fetchUserInstallations } from "./github-oauth";
import { createSession, defaultRoleForLogin, type SessionUser } from "./session";
import { enqueueInstallRegister } from "../engine/jobs";
import { claimUnownedInstallations } from "../github/install";

export interface FinishOAuthSignInParams {
  accessToken: string;
  next: string;
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
 * create a server-side session, and link any GitHub App installations that
 * GitHub itself reports the user administers. Throws on failure so the caller can route to `/?oauth_error=1`.
 */
export async function finishOAuthSignIn(
  params: FinishOAuthSignInParams,
): Promise<FinishOAuthSignInResult> {
  const { accessToken, next } = params;

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

  // Link every installation reachable with the user's token to this account.
  // Only GitHub App user-to-server tokens (`ghu_`) can list installations;
  // standalone OAuth App tokens (`gho_`) get a 401 back, so skip the call.
  //
  // Claiming is conditional: an installation already owned by someone else is
  // never displaced, and Organization installations are never personally owned
  // (two admins of one org would otherwise flip ownership on every sign-in).
  const installationIds = accessToken.startsWith("ghu_")
    ? await fetchUserInstallations(accessToken).catch(() => [])
    : [];
  if (installationIds.length > 0) {
    const claimed = await claimUnownedInstallations(installationIds, user.id);
    const skipped = installationIds.filter((id) => !claimed.includes(id));
    if (skipped.length > 0) {
      logger.info("oauth-installations-not-claimed", {
        login: gh.login,
        count: skipped.length,
        reason: "owned-by-another-user-or-organization-account",
      });
    }
    for (const id of installationIds) {
      // Same reasoning as above: awaited so a lost enqueue cannot silently
      // strand an installation. One failure must not abandon the rest.
      await enqueueInstallRegister(id).catch((e) => {
        logger.error("oauth-enqueue-install-register-failed", {
          installationId: id,
          error: e instanceof Error ? e.message : String(e),
          hint: "This installation may need to be reconnected from the dashboard.",
        });
      });
    }
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
      preferredLanguage: null,
    },
    token: session.token,
    expiresAt: session.expiresAt,
    next,
    installationIds,
  };
}