import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { isGitHubConfigured } from "@/lib/config";
import { oauthAuthorizeUrl } from "@/lib/auth/github-oauth";
import { newOAuthState, storeOauthState } from "@/lib/auth/oauth";
import { sanitizeNextPath } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isGitHubConfigured(config)) {
    return NextResponse.redirect(
      new URL("/?oauth_config=1", config.APP_URL),
    );
  }
  const next = sanitizeNextPath(req.nextUrl.searchParams.get("next"));

  const state = newOAuthState();
  // Retain `next` inside the state so `//evil.com` values are re-validated on
  // the callback (defense-in-depth on top of sanitize).
  const stateValue = `${state}.${Buffer.from(next, "utf8").toString("base64url")}`;
  await storeOauthState(stateValue);
  return NextResponse.redirect(oauthAuthorizeUrl(stateValue));
}