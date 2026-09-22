import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { getAppBaseUrl } from "@/lib/auth/redirect";
import { currentUser } from "@/lib/auth/session";
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
  // If user is already authenticated, embed user id in state for verification on return
  const state = user ? `uid:${user.id}` : undefined;
  const installUrl = githubAppInstallUrl(appSlug, state);

  logger.info("install-redirect-to-github-app", {
    appSlug,
    authenticated: Boolean(user),
    ip: getClientIp(req),
  });

  return NextResponse.redirect(installUrl);
}
