import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  exchangeCode,
  fetchGitHubUser,
  fetchUserInstallations,
} from "@/lib/auth/github-oauth";
import { verifyOauthState, OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import {
  createSession,
  writeSessionCookie,
  currentUser,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/session";
import { sanitizeNextPath, getAppBaseUrl } from "@/lib/auth/redirect";
import { enqueueInstallRegister } from "@/lib/engine/jobs";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const params = req.nextUrl.searchParams;

  // GitHub App installation callback: GitHub sends ?installation_id=... (& setup_action=install)
  const installationIdParam = params.get("installation_id");
  const code = params.get("code");
  const state = params.get("state");

  // User declined authorization on GitHub.
  if (params.get("error")) {
    return NextResponse.redirect(new URL("/?oauth_denied=1", baseUrl));
  }

  // Handle GitHub App post-installation redirect (installation_id present without code)
  if (installationIdParam && !code) {
    const instId = Number(installationIdParam);
    if (Number.isFinite(instId) && instId > 0) {
      void enqueueInstallRegister(instId);
      const user = await currentUser();
      if (user) {
        await prisma.appInstallation
          .updateMany({
            where: { installationId: instId },
            data: { userId: user.id },
          })
          .catch(() => {});
        return NextResponse.redirect(new URL("/dashboard?installed=1", baseUrl));
      }
      return NextResponse.redirect(new URL("/auth/login?next=/dashboard&installed=1", baseUrl));
    }
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  // Normal OAuth code verification
  const rawCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !(await verifyOauthState(state, rawCookie))) {
    logger.warn("oauth-state-mismatch", { ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/?oauth_error=1", baseUrl));
  }

  const next = state?.includes(".")
    ? sanitizeNextPath(
        Buffer.from(state.split(".")[1] ?? "", "base64url").toString("utf8"),
      )
    : "/dashboard";

  const exchanged = await exchangeCode(code, baseUrl);
  if (exchanged.error || !exchanged.access_token) {
    logger.error("oauth-code-exchange-failed", {
      error: exchanged.error_description ?? exchanged.error,
    });
    return NextResponse.redirect(new URL("/?oauth_error=1", baseUrl));
  }

  const gh = await fetchGitHubUser(exchanged.access_token);
  const user = await prisma.user.upsert({
    where: { githubId: gh.id },
    create: {
      githubId: gh.id,
      login: gh.login,
      name: gh.name,
      email: gh.email,
      avatarUrl: gh.avatar_url,
    },
    update: {
      login: gh.login,
      name: gh.name,
      email: gh.email,
      avatarUrl: gh.avatar_url,
    },
  });

  const session = await createSession(user.id, {
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  await writeSessionCookie(session.token, session.expiresAt);

  // If installation_id was also present in query params (combined flow)
  if (installationIdParam) {
    const instId = Number(installationIdParam);
    if (Number.isFinite(instId) && instId > 0) {
      await prisma.appInstallation
        .updateMany({
          where: { installationId: instId },
          data: { userId: user.id },
        })
        .catch(() => {});
      void enqueueInstallRegister(instId);
    }
  }

  // Link installations to this account (GitHub App OAuth token only).
  const installationIds = await fetchUserInstallations(exchanged.access_token);
  if (installationIds.length > 0) {
    await prisma.appInstallation.updateMany({
      where: { installationId: { in: installationIds } },
      data: { userId: user.id },
    });
    for (const id of installationIds) void enqueueInstallRegister(id);
  }

  logger.info("oauth-signin", {
    login: gh.login,
    installations: installationIds.length,
  });

  const response = NextResponse.redirect(new URL(next, baseUrl));
  const isHttps = baseUrl.startsWith("https");
  // Explicitly attach session cookie to redirect response
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    expires: session.expiresAt,
    maxAge: SESSION_TTL_MS / 1000,
  });
  // Clear the state cookie
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}