import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/env-boot";
import { readSessionCookie, revokeSession, clearSessionCookie } from "@/lib/auth/session";
import { sanitizeNextPath } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = await readSessionCookie();
  if (token) await revokeSession(token);
  await clearSessionCookie();
  return NextResponse.redirect(
    new URL(sanitizeNextPath(req.nextUrl.searchParams.get("next") ?? "/"), config.APP_URL),
  );
}