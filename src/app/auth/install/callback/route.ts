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
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/auth/session";
import type { GitHubUser } from "@/lib/auth/github-oauth";
import { getAppBaseUrl } from "@/lib/auth/redirect";
import { enqueueInstallRegister } from "@/lib/engine/jobs";
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
          const session = await createSession(user.id, {
            ip: getClientIp(req),
            userAgent: req.headers.get("user-agent"),
          });
          newSessionToken = session.token;
          newSessionExpiresAt = session.expiresAt;
          logger.info("app-install-oauth-signin", { login: ghUser.login, ip: getClientIp(req) });
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
    login.searchParams.set(
      "next",
      `/auth/install/callback?installation_id=${installationId}&setup_action=${encodeURIComponent(setupAction)}`,
    );
    return NextResponse.redirect(login);
  }

  try {
    // Link the installation to the authenticated Baton user BEFORE the
    // registration job runs, so org installs are attributed even though the
    // `installation.created` webhook row may not exist yet.
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

    if (appUserToken) {
      const installationIds = await fetchUserInstallations(appUserToken).catch(() => []);
      for (const id of installationIds) void enqueueInstallRegister(id).catch(() => {});
    }
  } catch (err) {
    logger.error("app-install-callback-db-failed", { error: String(err), ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const response = NextResponse.redirect(new URL("/dashboard?installed=1", baseUrl));
  if (newSessionToken && newSessionExpiresAt) {
    const isHttps = baseUrl.startsWith("https");
    response.cookies.set(SESSION_COOKIE, newSessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
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
  };
}