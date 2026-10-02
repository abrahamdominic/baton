import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const OAUTH_STATE_COOKIE = "baton_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "baton_oauth_verifier";
/**
 * Separate one-time state for the GitHub App installation flow.
 *
 * The install flow is not the OAuth sign-in flow: it returns to
 * /auth/install/callback, and it can be started by a signed-in user. It used to
 * carry `uid:<userId>` in the GitHub App `state` parameter, which was both
 * ignored when absent (so the callback could be triggered on any signed-in
 * browser with an arbitrary `installation_id`) and an unnecessary disclosure of
 * an internal identifier through GitHub's query string and referrer chain.
 */
export const INSTALL_STATE_COOKIE = "baton_install_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Generate a cryptographically random PKCE code verifier (RFC 7636). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate a PKCE S256 code challenge from a verifier. */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Store a one-time state hash so a leaked cookie can't be replayed. */
export async function storeOauthState(state: string, isSecure = process.env.NODE_ENV === "production"): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, hashState(state), { ...STATE_COOKIE_OPTS, secure: isSecure });
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

export const STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: STATE_TTL_MS / 1000,
};

/** Store a one-time install-flow state hash. Returns the hash to copy verbatim. */
export async function storeInstallState(state: string): Promise<string> {
  const hash = hashState(state);
  const store = await cookies();
  store.set(INSTALL_STATE_COOKIE, hash, STATE_COOKIE_OPTS);
  return hash;
}

/**
 * Consume the install-flow state: constant-time compare against the stored
 * hash, then clear it. Single-use, exactly like the OAuth state.
 */
export async function verifyInstallState(state: string | null, rawCookieValue?: string | null): Promise<boolean> {
  if (!state) return false;
  let stored = rawCookieValue;
  try {
    const store = await cookies();
    if (!stored) stored = store.get(INSTALL_STATE_COOKIE)?.value;
    store.set(INSTALL_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  } catch {
    // Outside a request context (tests) the raw value is all we have.
  }
  if (!stored) return false;
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(hashState(state), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
