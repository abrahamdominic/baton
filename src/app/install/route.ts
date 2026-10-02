import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { getAppBaseUrl } from "@/lib/auth/redirect";
import { currentUser } from "@/lib/auth/session";
import {
  hashState,
  INSTALL_STATE_COOKIE,
  newOAuthState,
  STATE_COOKIE_OPTS,
  storeInstallState,
} from "@/lib/auth/oauth";
import { githubAppInstallUrl } from "@/lib/auth/github-oauth";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Initiates the Baton GitHub App installation flow.
 *
 * This intentionally sends the user to the GitHub App installation page
 * (https://github.com/apps/<appSlug>/installations/new), NEVER to the standalone
 * OAuth App authorize page (/auth/login).
 *
 * The GitHub App handles repository access and permissions. After the user
 * installs the app on their organization or account, GitHub redirects to
 * Baton's Setup URL (/auth/install/callback?installation_id=...&setup_action=install).
 *
 * If the user is already authenticated, the callback links the installation
 * to their account immediately. If not yet signed in, the installation callback
 * smoothly forwards them through sign-in, preserving the installation association.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const appSlug = config.GITHUB_APP_SLUG || "abrahamdominic";

  if (!appSlug) {
    logger.warn("install-app-slug-missing", { ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/?install_error=1&reason=app_not_configured", baseUrl));
  }

  const user = await currentUser();

  // A fresh, single-use nonce bound to this browser, not an identifier. The
  // callback requires it before it will attribute anything, which is what stops
  // the state-mutating callback from being triggered on a signed-in browser
  // with an attacker-chosen `installation_id`. The user it belongs to is already
  // implied by the session, so there is nothing for the state to carry.
  const state = newOAuthState();
  await storeInstallState(state);
  const installUrl = githubAppInstallUrl(appSlug, state);

  logger.info("install-redirect-to-github-app", {
    appSlug,
    authenticated: Boolean(user),
    ip: getClientIp(req),
  });

  const response = NextResponse.redirect(installUrl);
  // Re-assert on the response itself: the cookie is consumed and cleared on the
  // way back, and not every proxy in front of us preserves Set-Cookie from a
  // route handler's cookie store.
  response.cookies.set(INSTALL_STATE_COOKIE, hashState(state), STATE_COOKIE_OPTS);
  return response;
}
