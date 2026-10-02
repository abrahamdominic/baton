import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  exchangeGitHubAppCode,
  fetchGitHubUser,
  fetchUserInstallations,
  githubAppUserIssuer,
  isAppUserOAuthConfigured,
} from "@/lib/auth/github-oauth";
import {
  currentUser,
  createSession,
  defaultRoleForLogin,
  SESSION_COOKIE,
  SESSION_COOKIE_BASE_OPTS,
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/auth/session";
import { INSTALL_STATE_COOKIE, verifyInstallState } from "@/lib/auth/oauth";
import type { GitHubUser } from "@/lib/auth/github-oauth";
import { getAppBaseUrl } from "@/lib/auth/redirect";
import { enqueueInstallRegister } from "@/lib/engine/jobs";
import { registerInstallation, resolveInstallationAttribution } from "@/lib/github/install";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GitHub App installation / setup callback. GitHub redirects here after the
 * user installs the Baton GitHub App (Setup URL) or, when the App has "Request
 * user authorization (OAuth) during installation" enabled, after that user
 * authorization completes (User authorization callback URL).
 *
 * This is intentionally distinct from /auth/callback (the standalone OAuth App
 * sign-in callback). Supported query params:
 *
 *   ?installation_id=<id>&setup_action=install        (normal install)
 *   ?installation_id=<id>&code=...&setup_action=...    (user OAuth during install)
 *
 * The `code` here belongs to the GITHUB APP (exchanged with the App's own
 * client secret), never to the standalone OAuth App.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const params = req.nextUrl.searchParams;

  const installationId = Number(params.get("installation_id"));
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }
  const code = params.get("code");
  const stateParam = params.get("state");

  // GitHub App user-authorization callbacks include iss=https://github.com/apps/<slug>.
  const iss = params.get("iss");
  if (iss && iss.replace(/\/+$/, "") !== githubAppUserIssuer().replace(/\/+$/, "")) {
    logger.warn("app-install-iss-mismatch", { iss, ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  let user = await currentUser();

  // No Baton session yet, but GitHub handed us an App-level authorization code
  // (request-user-auth-during-install). Exchange it with the GitHub App's own
  // credentials, resolve the identity, and sign the user in.
  let appUserToken: string | null = null;
  let newSessionToken: string | null = null;
  let newSessionExpiresAt: Date | null = null;

  if (!user && code) {
    if (!isAppUserOAuthConfigured()) {
      logger.info("app-install-code-exchange-unconfigured-falling-back-to-oauth", { ip: getClientIp(req) });
      // Fall through to standalone OAuth login below
    } else {
      try {
        const exchanged = await exchangeGitHubAppCode(code, baseUrl);
        if (exchanged.error || !exchanged.access_token) {
          logger.error("app-install-code-exchange-failed", {
            error: exchanged.error_description ?? exchanged.error,
            ip: getClientIp(req),
          });
          // Fall through to standalone OAuth login below
        } else {
          appUserToken = exchanged.access_token;
          const ghUser = await fetchGitHubUser(appUserToken);
          user = await upsertBatonUser(ghUser);
          if (user.suspendedAt) {
            // Same rule as the OAuth callback: a suspension blocks the minting
            // of a session, it is not a post-login UI state.
            logger.warn("app-install-signin-suspended", { login: ghUser.login, ip: getClientIp(req) });
            user = null;
            appUserToken = null;
          }
          const session = user
            ? await createSession(user.id, {
                ip: getClientIp(req),
                userAgent: req.headers.get("user-agent"),
              })
            : null;
          if (session) {
            newSessionToken = session.token;
            newSessionExpiresAt = session.expiresAt;
            logger.info("app-install-oauth-signin", { login: ghUser.login, ip: getClientIp(req) });
          }
        }
      } catch (err) {
        logger.error("app-install-oauth-user-failed", { error: String(err), ip: getClientIp(req) });
        // Fall through to standalone OAuth login below
      }
    }
  }

  // Without a session and without an App authorization code, send the user
  // through the standalone OAuth App sign-in which returns to this route.
  if (!user) {
    const login = new URL("/auth/login", baseUrl);
    const setupAction = params.get("setup_action") || "install";
    // The install state rides through sign-in so the returning callback can
    // still prove this browser started the flow. Without it the user would be
    // bounced to /install and made to redo the GitHub side of the install.
    const next = `/auth/install/callback?installation_id=${installationId}&setup_action=${encodeURIComponent(setupAction)}`;
    login.searchParams.set(
      "next",
      stateParam ? `${next}&state=${encodeURIComponent(stateParam)}` : next,
    );
    return NextResponse.redirect(login);
  }

  // CSRF: this callback performs an attribution write, so it must be provably
  // tied to an install flow this browser started. `/install` mints a one-time
  // random nonce, stores its hash in an httpOnly cookie, and GitHub echoes the
  // nonce back. The check used to run only `if (stateParam)`, so an absent state
  // skipped validation entirely and the callback could be triggered on any
  // signed-in browser with an attacker-chosen `installation_id`.
  //
  // A state is not required when GitHub granted an App-level user token: that
  // token is its own proof, and the membership check below confirms the user
  // administers this specific installation.
  if (!appUserToken && !(await verifyInstallState(stateParam, req.cookies.get(INSTALL_STATE_COOKIE)?.value))) {
    logger.warn("app-install-state-missing-or-mismatch", {
      requestedBy: user.id,
      presented: Boolean(stateParam),
      ip: getClientIp(req),
    });
    // A direct install from GitHub's own app page arrives with no state at all.
    // Restart the flow so the user gets a valid one instead of a dead end;
    // re-invoking GitHub's install page re-triggers the setup URL with it.
    if (!stateParam) {
      return NextResponse.redirect(new URL("/install", baseUrl));
    }
    return NextResponse.redirect(new URL("/dashboard?install_error=1&reason=state_mismatch", baseUrl));
  }

  // Authoritative ownership proof when the App granted a user token: GitHub
  // itself reports which installations this user administers. `installation_id`
  // is a sequential integer, so this membership check — not the query
  // parameter — is what makes attribution legitimate.
  let administeredInstallations: number[] = [];
  if (appUserToken) {
    administeredInstallations = await fetchUserInstallations(appUserToken).catch(() => []);
    if (!administeredInstallations.includes(installationId)) {
      logger.warn("app-install-not-administered", {
        installationId,
        requestedBy: user.id,
        ip: getClientIp(req),
      });
      return NextResponse.redirect(new URL("/dashboard?install_error=1&reason=not_admin", baseUrl));
    }
  }

  try {
    // Link the installation to the authenticated Baton user BEFORE the
    // registration job runs, so org installs are attributed even though the
    // `installation.created` webhook row may not exist yet.
    const existing = await prisma.appInstallation.findUnique({
      where: { installationId },
      select: { userId: true },
    });
    const attribution = resolveInstallationAttribution(existing, user.id);
    if (attribution === "create") {
      await prisma.appInstallation.create({
        data: {
          installationId,
          accountLogin: "pending",
          accountType: "User",
          userId: user.id,
        },
      });
    } else if (attribution === "adopt") {
      // Unattributed (e.g. the webhook row landed before anyone signed in).
      await prisma.appInstallation.update({
        where: { installationId },
        data: { userId: user.id },
      });
    } else if (existing && existing.userId !== user.id) {
      // Already attributed to someone else. Leave the owner in place and abort:
      // continuing would still enqueue/register on the victim's behalf. The
      // mismatch is a takeover attempt, not something to paper over.
      logger.warn("app-install-callback-owner-mismatch", {
        installationId,
        requestedBy: user.id,
        currentOwner: existing.userId,
      });
      return NextResponse.redirect(new URL("/dashboard?install_error=1&reason=already_claimed", baseUrl));
    }
    // Awaited. `registerInstallation` below is the synchronous path; the enqueue
    // is a durable retry if it fails. Swallowing the error with `void ...catch()`
    // would discard the only durable record of work this callback created.
    await enqueueInstallRegister(installationId).catch((e) => {
      logger.warn("app-install-callback-enqueue-failed", {
        installationId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    let registered: { accountLogin: string; accountType: string } | null = null;
    try {
      registered = await registerInstallation(installationId);
    } catch (e) {
      logger.warn("app-install-immediate-register-fallback-to-queue", { installationId, error: String(e) });
    }

    // Second, independent proof, available even without an App user token:
    // GitHub reports which account the installation actually belongs to. A
    // *user* installation is installed on one person's account, so if that
    // login is not the signed-in user's, this installation is not theirs and the
    // attribution written above is a claim against someone else's account.
    // Organization installations are installed on the org, not on a person, so
    // there is nothing to compare and the membership check above is the only
    // proof available for them.
    if (registered && registered.accountType === "User") {
      const owner = registered.accountLogin.toLowerCase();
      if (owner !== user.login.toLowerCase()) {
        logger.warn("app-install-account-mismatch", {
          installationId,
          requestedBy: user.id,
          requestedByLogin: user.login,
          installationAccount: owner,
        });
        // Release the attribution we optimistically wrote and fail closed.
        await prisma.appInstallation
          .update({ where: { installationId }, data: { userId: null } })
          .catch(() => {});
        return NextResponse.redirect(new URL("/dashboard?install_error=1&reason=account_mismatch", baseUrl));
      }
    }

    // Reuse the already-verified GitHub-side list; re-fetching here would also
    // re-introduce an unchecked source of installation ids.
    for (const id of administeredInstallations) {
      if (id === installationId) continue; // already registered above
      await enqueueInstallRegister(id).catch(() => {});
      try {
        await registerInstallation(id);
      } catch {
        // Synchronous registration best-effort fallback to enqueued job
      }
    }
  } catch (err) {
    logger.error("app-install-callback-db-failed", { error: String(err), ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const response = NextResponse.redirect(new URL("/dashboard?installed=1", baseUrl));
  if (newSessionToken && newSessionExpiresAt) {
    // Shared cookie definition: `secure` from the environment, never from a
    // request header.
    response.cookies.set(SESSION_COOKIE, newSessionToken, {
      ...SESSION_COOKIE_BASE_OPTS,
      expires: newSessionExpiresAt,
      maxAge: SESSION_TTL_MS / 1000,
    });
  }
  return response;
}

async function upsertBatonUser(gh: GitHubUser): Promise<SessionUser> {
  const row = await prisma.user.upsert({
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
  return {
    id: row.id,
    githubId: row.githubId,
    login: row.login,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role,
    suspendedAt: row.suspendedAt,
    preferredLanguage: row.preferredLanguage,
  };
}