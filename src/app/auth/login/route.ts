import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { isGitHubConfigured } from "@/lib/config";
import { oauthAuthorizeUrl } from "@/lib/auth/github-oauth";
import {
  newOAuthState,
  hashState,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  generateCodeVerifier,
  generateCodeChallenge,
} from "@/lib/auth/oauth";
import { sanitizeNextPath, getOAuthBaseUrl } from "@/lib/auth/redirect";
import { rateLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/net";
import { metrics } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getOAuthBaseUrl(req);

  // Rate limit per client IP. This endpoint mints fresh PKCE verifiers and state
  // values and hands them to GitHub, so an unauthenticated caller can drive an
  // unbounded number of authorize round trips for free. Twenty per minute is far
  // above what a person clicking "Sign in with GitHub" needs — including after a
  // failed attempt — while still bounding the cost of an automated one.
  if (!rateLimiter.check(`auth:login:${getClientIp(req)}`, 20, 60_000)) {
    metrics.authFailure("oauth login rate limited");
    return NextResponse.redirect(new URL("/?oauth_error=1&reason=rate_limited", baseUrl));
  }

  if (!isGitHubConfigured(config)) {
    return NextResponse.redirect(new URL("/?oauth_config=1", baseUrl));
  }

  const next = sanitizeNextPath(req.nextUrl.searchParams.get("next"));
  const state = newOAuthState();
  // Retain `next` inside the state so it is re-validated on the callback
  // (defense-in-depth on top of sanitize).
  const stateValue = `${state}.${Buffer.from(next, "utf8").toString("base64url")}`;
  const isHttps = baseUrl.startsWith("https");

  // PKCE: generate cryptographically random verifier and S256 challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl = oauthAuthorizeUrl(stateValue, baseUrl, codeChallenge);
  const response = NextResponse.redirect(authUrl);

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps,
    path: "/",
    maxAge: 600,
  };

  // State cookie for CSRF protection
  response.cookies.set(OAUTH_STATE_COOKIE, hashState(stateValue), cookieOpts);
  // Verifier cookie for PKCE exchange
  response.cookies.set(OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOpts);

  return response;
}