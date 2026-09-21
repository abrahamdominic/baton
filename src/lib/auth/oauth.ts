import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const OAUTH_STATE_COOKIE = "baton_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Store a one-time state hash so a leaked cookie can't be replayed. */
export async function storeOauthState(state: string, isSecure = process.env.NODE_ENV === "production"): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, hashState(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: STATE_TTL_MS / 1000,
  });
}

/** Verifies the callback `state` against the stored hash; clears the cookie. Accepts optional raw cookie from request. */
export async function verifyOauthState(state: string | null, rawCookieValue?: string | null): Promise<boolean> {
  if (!state) return false;
  let stored = rawCookieValue;
  try {
    const store = await cookies();
    if (!stored) {
      stored = store.get(OAUTH_STATE_COOKIE)?.value;
    }
    store.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  } catch {
    // If running outside request context or during test
  }
  if (!stored) return false;
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(hashState(state), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}