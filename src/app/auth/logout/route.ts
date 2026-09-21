import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { revokeSession, readSessionCookie, clearSessionCookie, SESSION_COOKIE } from "@/lib/auth/session";
import { sanitizeNextPath, getAppBaseUrl } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getAppBaseUrl(req);
  const sessionToken = await readSessionCookie();
  if (sessionToken) {
    await revokeSession(sessionToken);
  }
  await clearSessionCookie();
  const response = NextResponse.redirect(
    new URL(sanitizeNextPath(req.nextUrl.searchParams.get("next") ?? "/"), baseUrl),
  );
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}