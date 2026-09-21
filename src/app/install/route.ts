import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { getAppBaseUrl } from "@/lib/auth/redirect";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const appSlug = config.GITHUB_APP_SLUG || "baton";
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;

  const user = await currentUser();
  if (!user) {
    // If not authenticated, authenticate first, then continue to GitHub App installation
    return NextResponse.redirect(new URL("/auth/login?next=/install", baseUrl));
  }

  // If already authenticated, proceed to the GitHub App installation page
  return NextResponse.redirect(installUrl);
}
