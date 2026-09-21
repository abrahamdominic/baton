import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  exchangeCode,
  fetchGitHubUser,
  fetchUserInstallations,
} from "@/lib/auth/github-oauth";
import { verifyOauthState } from "@/lib/auth/oauth";
import { createSession, writeSessionCookie } from "@/lib/auth/session";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { enqueueInstallRegister } from "@/lib/engine/jobs";
import { getClientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;

  // User declined authorization on GitHub.
  if (params.get("error")) {
    return NextResponse.redirect(new URL("/?oauth_denied=1", config.APP_URL));
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !(await verifyOauthState(state))) {
    logger.warn("oauth-state-mismatch", { ip: getClientIp(req) });
    return NextResponse.redirect(new URL("/?oauth_error=1", config.APP_URL));
  }

  const next = state?.includes(".")
    ? sanitizeNextPath(
        Buffer.from(state.split(".")[1] ?? "", "base64url").toString("utf8"),
      )
    : "/dashboard";

  const exchanged = await exchangeCode(code);
  if (exchanged.error || !exchanged.access_token) {
    logger.error("oauth-code-exchange-failed", {
      error: exchanged.error_description ?? exchanged.error,
    });
    return NextResponse.redirect(new URL("/?oauth_error=1", config.APP_URL));
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

  return NextResponse.redirect(new URL(next, config.APP_URL));
}