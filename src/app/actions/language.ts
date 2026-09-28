"use server";

/**
 * Persist the language preference (lan.md §7, §8, §27).
 *
 * Two guarantees:
 *  - the user id comes from the session, never from the client, so a crafted
 *    call cannot rewrite somebody else's preference
 *  - the cookie is written before the database, so a database failure still
 *    leaves the next request rendering in the chosen language
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { isSupportedLocale, type Locale } from "@/lib/i18n/config";
import { LOCALE_COOKIE } from "@/lib/i18n/resolve";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function savePreferredLanguageAction(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) {
    throw new Error("Unsupported locale");
  }
  const tag = locale as Locale;

  // Cookie first: it is what the next SSR render reads, so the language holds
  // even if the account write below fails.
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, tag, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const user = await currentUser();
  // Signed out is not an error. The local preference and the cookie already
  // applied, and the choice is written to the account the next time the user
  // explicitly saves it.
  if (!user) {
    revalidatePath("/", "layout");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { preferredLanguage: tag },
  });

  revalidatePath("/", "layout");
}
