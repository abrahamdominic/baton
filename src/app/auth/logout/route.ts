import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  revokeSession,
  readSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  SESSION_COOKIE_BASE_OPTS,
} from "@/lib/auth/session";
import { sanitizeNextPath, getAppBaseUrl } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/net";
import { rateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Sign out.
 *
 * POST only. This was a state-changing GET, which is forgeable: any page on
 * the internet could sign a visitor out with an `<img src="https://…/auth/logout">`,
 * and because the redirect target is also attacker-supplied this made for a
 * cheap phishing primitive, authenticate a victim on github.com, bounce them
 * through a logout into an attacker-shaped URL. `SameSite=Lax` on the session
 * cookie does not help: a top-level navigation still sends it.
 *
 * A POST from a cross-origin form is also possible in principle, so the session
 * cookie's `SameSite=Lax` plus the browser's preflight rules for `fetch` are the
 * real barrier, and the route additionally refuses a cross-origin `Origin`
 * header rather than trusting that alone.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) {
        logger.warn("logout-cross-origin-refused", { origin, ip: getClientIp(req) });
        return NextResponse.json({ error: "Cross-origin sign-out is not allowed." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Cross-origin sign-out is not allowed." }, { status: 403 });
    }
  }

  if (!rateLimiter.check(`auth:logout:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const baseUrl = getAppBaseUrl(req);
  const sessionToken = await readSessionCookie();
  if (sessionToken) {
    await revokeSession(sessionToken);
  }
  await clearSessionCookie();
  const response = NextResponse.redirect(
    new URL(sanitizeNextPath(req.nextUrl.searchParams.get("next") ?? "/"), baseUrl),
  );
  response.cookies.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_BASE_OPTS, maxAge: 0 });
  return response;
}

/** A GET no longer signs anyone out. Anyone relying on the old link 405s. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Sign out with POST. Use the sign-out control in the interface." },
    { status: 405, headers: { allow: "POST" } },
  );
}
