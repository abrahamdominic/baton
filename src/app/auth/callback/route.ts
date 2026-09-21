import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { exchangeCode, GITHUB_OAUTH_ISSUER } from "@/lib/auth/github-oauth";
import { verifyOauthState, OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import { currentUser, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { sanitizeNextPath, getAppBaseUrl } from "@/lib/auth/redirect";
import { finishOAuthSignIn } from "@/lib/auth/oauth-flow";
import { enqueueInstallRegister } from "@/lib/engine/jobs";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Two distinct entry modes share this route (existing architecture, kept):
 *
 *  1. GitHub App install setup redirect: ?installation_id=<id>
 *     (optionally ?setup_action=install) with NO `code`.
 *  2. OAuth sign-in callback: ?code=...&state=...&iss=https://github.com/login/oauth
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const params = req.nextUrl.searchParams;

  const installationIdParam = params.get("installation_id");
  const code = params.get("code");
  const state = params.get("state");

  const oauthErrorUrl = new URL("/?oauth_error=1", baseUrl);
  const oauthDeniedUrl = new URL("/?oauth_denied=1", baseUrl);

  // User declined authorization on GitHub.
  if (params.get("error")) {
    return NextResponse.redirect(oauthDeniedUrl);
  }

  // GitHub App installation callback: GitHub redirects here after install.
  if (installationIdParam && !code) {
    const instId = Number(installationIdParam);
    if (!Number.isFinite(instId) || instId <= 0) {
      return NextResponse.redirect(new URL("/dashboard", baseUrl));
    }
    void enqueueInstallRegister(instId).catch(() => {});
    const user = await currentUser();
    if (user) {
      await prisma.appInstallation
        .updateMany({ where: { installationId: instId }, data: { userId: user.id } })
        .catch(() => {});
      return NextResponse.redirect(new URL("/dashboard?installed=1", baseUrl));
    }
    // Not signed in: send through login, then back to /dashboard?installed=1.
    // `next` must be a properly-encoded query VALUE so the login page and the
    // post-login redirect treat "?installed=1" as a query, not a path.
    const login = new URL("/auth/login", baseUrl);
    login.searchParams.set("next", "/dashboard?installed=1");
    return NextResponse.redirect(login);
  }

  // Mix-up protection: GitHub appends `iss` to user-facing OAuth callbacks.
  const iss = params.get("iss");
  if (iss && iss !== GITHUB_OAUTH_ISSUER) {
    logger.warn("oauth-iss-mismatch", { iss, ip: getClientIp(req) });
    return NextResponse.redirect(oauthErrorUrl);
  }

  // Recover the post-login destination from the state value. The state was
  // built in /auth/login as `<random>.<base64url(next)>`; re-validated here
  // against the cookie, and the path is sanitized again (open-redirect guard).
  let next = "/dashboard";
  const encoded = state?.split(".")[1];
  if (state && encoded) {
    try {
      next = sanitizeNextPath(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      next = "/dashboard";
    }
  }

  // One-time, constant-time state verification against the cookie set at login.
  if (!code || !(await verifyOauthState(state, req.cookies.get(OAUTH_STATE_COOKIE)?.value))) {
    logger.warn("oauth-state-mismatch", { ip: getClientIp(req) });
    return NextResponse.redirect(oauthErrorUrl);
  }

  try {
    const exchanged = await exchangeCode(code, baseUrl);
    if (exchanged.error || !exchanged.access_token) {
      logger.error("oauth-code-exchange-failed", {
        error: exchanged.error_description ?? exchanged.error,
      });
      return NextResponse.redirect(oauthErrorUrl);
    }

    // GitHub's state cookie may also carry a brand-new bare session if the
    // site is ever breached to re-check; finishOAuthSignIn re-links installs.
    const result = await finishOAuthSignIn({
      accessToken: exchanged.access_token,
      next,
      installationId: installationIdParam ? Number(installationIdParam) : null,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    logger.info("oauth-signin", {
      login: result.user.login,
      installations: result.installationIds.length,
    });

    const response = NextResponse.redirect(new URL(result.next, baseUrl));
    const isHttps = baseUrl.startsWith("https");
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      expires: result.expiresAt,
      maxAge: SESSION_TTL_MS / 1000,
    });
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    // Isolate GitHub/DB failures so users see a friendly banner, not a 500.
    logger.error("oauth-callback-failed", { error: String(err), ip: getClientIp(req) });
    return NextResponse.redirect(oauthErrorUrl);
  }
}