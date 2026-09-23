import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { exchangeCode, GITHUB_OAUTH_ISSUER, GITHUB_OAUTH_CALLBACK_PATH, GitHubApiError } from "@/lib/auth/github-oauth";
import { verifyOauthState, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from "@/lib/auth/oauth";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { sanitizeNextPath, getAppBaseUrl, getOAuthBaseUrl } from "@/lib/auth/redirect";
import { databaseUrlIssue } from "@/lib/config";
import { finishOAuthSignIn } from "@/lib/auth/oauth-flow";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Entry modes (kept for backward compatibility):
 *
 *  1. GitHub App install / setup callback: ?installation_id=<id>, forwarded to
 *     /auth/install/callback. May also carry ?code= (GitHub App user
 *     authorization during installation) which is exchanged with the GitHub
 *     App's OWN credentials there, never with the OAuth App's.
 *  2. OAuth sign-in callback: ?code=...&state=...&iss=https://github.com/login/oauth
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Where the user should end up (request host so a preview/custom domain
  // keeps users on that domain). The OAuth redirect_uri itself must use the
  // canonical registered callback URL (getOAuthBaseUrl), see below.
  const baseUrl = getAppBaseUrl(req);
  // Canonical callback host for the code exchange, matching exactly the
  // redirect_uri GitHub saw on authorize.
  const oauthBase = getOAuthBaseUrl(req);
  const params = req.nextUrl.searchParams;

  const installationIdParam = params.get("installation_id");
  const code = params.get("code");
  const state = params.get("state");

  // OAuth failures redirect to the public site with a machine-readable reason
  // the landing page turns into a human-readable message (instead of the old
  // bare `?oauth_error=1` that told the user nothing).
  const oauthFailure = (reason: string) =>
    NextResponse.redirect(new URL(`/?oauth_error=1&reason=${encodeURIComponent(reason)}`, baseUrl));
  const oauthDeniedUrl = new URL("/?oauth_denied=1", baseUrl);

  // User declined authorization on GitHub.
  if (params.get("error")) {
    return NextResponse.redirect(oauthDeniedUrl);
  }

  // GitHub App installation callback: forward (with or without an App-level
  // `code`) to the dedicated installation route. The standalone OAuth App
  // callback is not the GitHub App installation callback.
  if (installationIdParam) {
    const target = new URL("/auth/install/callback", baseUrl);
    target.searchParams.set("installation_id", installationIdParam);
    const setupAction = params.get("setup_action");
    if (setupAction) target.searchParams.set("setup_action", setupAction);
    if (code) target.searchParams.set("code", code);
    const st = params.get("state");
    if (st) target.searchParams.set("state", st);
    return NextResponse.redirect(target);
  }

  // Mix-up protection: GitHub appends `iss` to user-facing OAuth callbacks.
  const iss = params.get("iss");
  if (iss && iss.replace(/\/+$/, "") !== GITHUB_OAUTH_ISSUER.replace(/\/+$/, "")) {
    logger.warn("oauth-iss-mismatch", { iss, ip: getClientIp(req) });
    return oauthFailure("iss_mismatch");
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
    return oauthFailure("state_mismatch");
  }

  const verifierCookie = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

  try {
    const exchanged = await exchangeCode(
      code,
      oauthBase,
      undefined,
      GITHUB_OAUTH_CALLBACK_PATH,
      verifierCookie,
    );
    if (exchanged.error || !exchanged.access_token) {
      logger.error("oauth-code-exchange-failed", {
        error: exchanged.error_description ?? exchanged.error,
      });
      return oauthFailure("exchange_failed");
    }

    // If next path carries an installation_id (e.g. from GitHub App setup callback
    // redirecting through OAuth sign-in), link it immediately during sign-in.
    let installationIdFromNext: number | undefined;
    try {
      const nextUrl = new URL(next, "http://localhost");
      const idParam = nextUrl.searchParams.get("installation_id");
      if (idParam && /^\d+$/.test(idParam)) {
        installationIdFromNext = Number(idParam);
      }
    } catch {
      installationIdFromNext = undefined;
    }

    // GitHub's state cookie may also carry a brand-new bare session if the
    // site is ever breached to re-check; finishOAuthSignIn re-links installs.
    const result = await finishOAuthSignIn({
      accessToken: exchanged.access_token,
      next,
      installationId: installationIdFromNext,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    logger.info("oauth-signin", {
      login: result.user.login,
      installations: result.installationIds.length,
      linkedInstallId: installationIdFromNext,
    });

    const destination = installationIdFromNext ? "/dashboard?installed=1" : result.next;
    const response = NextResponse.redirect(new URL(destination, baseUrl));
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
    response.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    // Classify the failure so users see the truth and operators can find the
    // real cause: GitHub API problems are NOT "database unavailable", a missing
    // or invalid DATABASE_URL is NOT a GitHub error, and RLS/Prisma failures
    // are logged with the underlying message while the browser only ever sees
    // a safe generic string.
    if (err instanceof GitHubApiError) {
      logger.error("oauth-callback-github-api", {
        endpoint: err.endpoint,
        status: err.status,
        error: err.message,
        ip: getClientIp(req),
      });
      return oauthFailure("github_api");
    }

    const issue = databaseUrlIssue();
    const prismaInit =
      err instanceof Error &&
      (/PrismaClientInitializationError/.test(err.name) ||
        /Error validating datasource/i.test(err.message) ||
        /You must provide a nonempty URL/.test(err.message));
    const prismaConnect =
      err instanceof Error &&
      (/\bP1001\b|\bP1002\b|\bP1003\b|\bP1012\b|\bECONNREFUSED\b|\blogin failed\b/i.test(err.message));

    if (process.env.NODE_ENV === "production") {
      if (issue) {
        logger.error("oauth-callback-db-misconfigured", {
          detail: issue,
          hint: "Set a real PostgreSQL DATABASE_URL on the deployment, then run `npm run db:deploy` (prisma migrate deploy) before signing in.",
          error: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : typeof err,
          ip: getClientIp(req),
        });
        return oauthFailure("db_misconfigured");
      } else if (prismaInit || prismaConnect) {
        logger.error("oauth-callback-db-unreachable", {
          error: err instanceof Error ? err.message : String(err),
          hint: "DATABASE_URL is syntactically valid but the first query failed; check host/port/credentials and that `prisma migrate deploy` has run.",
          ip: getClientIp(req),
        });
        return oauthFailure("db_unreachable");
      } else {
        logger.error("oauth-callback-failed", {
          error: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : typeof err,
          ip: getClientIp(req),
        });
      }
    } else {
      logger.error("oauth-callback-failed", {
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : typeof err,
        ip: getClientIp(req),
      });
    }
    return oauthFailure("server_error");
  }
}