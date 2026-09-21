import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { isGitHubConfigured } from "@/lib/config";
import { oauthAuthorizeUrl } from "@/lib/auth/github-oauth";
import { newOAuthState, storeOauthState, hashState, OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import { sanitizeNextPath, getAppBaseUrl } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);

  if (!isGitHubConfigured(config)) {
    return NextResponse.redirect(
      new URL("/?oauth_config=1", baseUrl),
    );
  }
  const next = sanitizeNextPath(req.nextUrl.searchParams.get("next"));

  const state = newOAuthState();
  // Retain `next` inside the state so `//evil.com` values are re-validated on
  // the callback (defense-in-depth on top of sanitize).
  const stateValue = `${state}.${Buffer.from(next, "utf8").toString("base64url")}`;
  const isHttps = baseUrl.startsWith("https");
  await storeOauthState(stateValue, isHttps);

  const authUrl = oauthAuthorizeUrl(stateValue, baseUrl);
  const response = NextResponse.redirect(authUrl);
  // Ensure the state cookie is explicitly attached to the redirect response
  response.cookies.set(OAUTH_STATE_COOKIE, hashState(stateValue), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 600,
  });
  return response;
}