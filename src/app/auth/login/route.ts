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

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getOAuthBaseUrl(req);

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