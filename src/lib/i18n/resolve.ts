import "server-only";

/**
 * Request locale resolution for SSR (lan.md §6, §16, §24).
 *
 * The server can see two things the browser provider cannot: the `Accept-
 * Language` header and the signed-in account's saved preference. Resolving the
 * locale here - rather than redirecting to a `/{locale}/...` path - is what
 * lets the first server-rendered HTML already be correct.
 *
 * A locale-prefixed path was deliberately NOT used. lan.md §9 requires a
 * language change to cause no redirect and no route change, so the language has
 * to be request state, not URL state.
 *
 * Precedence:
 *   1. explicit cookie   - set when the user picked a language on any device
 *   2. account preference- signed-in user's stored choice, including on a
 *                          device that has never seen the site before
 *   3. Accept-Language   - anonymous first visit
 *   4. English
 */

import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isSupportedLocale, resolveLocale, type Locale } from "./config";
import { currentUser } from "@/lib/auth/session";

/** Mirrors the cookie written by the save action. */
export const LOCALE_COOKIE = "baton.locale";

export interface ResolvedLocale {
  locale: Locale;
  /** The account preference, or null when signed out / never chosen. */
  accountLocale: Locale | null;
}

export async function resolveRequestLocale(): Promise<ResolvedLocale> {
  const jar = await cookies();
  const cookieValue = jar.get(LOCALE_COOKIE)?.value;
  if (cookieValue && isSupportedLocale(cookieValue)) {
    return { locale: cookieValue, accountLocale: null };
  }

  let accountLocale: Locale | null = null;
  try {
    const user = await currentUser();
    if (user?.preferredLanguage && isSupportedLocale(user.preferredLanguage)) {
      accountLocale = user.preferredLanguage;
    }
  } catch {
    // Signed out, or the session lookup failed. Browser detection still gives a
    // correct first paint, and an error here must not break the page.
  }

  if (accountLocale) return { locale: accountLocale, accountLocale };

  const h = await headers();
  return {
    locale: resolveLocale(h.get("accept-language")) ?? DEFAULT_LOCALE,
    accountLocale: null,
  };
}
