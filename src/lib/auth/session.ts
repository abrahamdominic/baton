import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { logger } from "../logger";
import { adminLogins } from "../config";

/**
 * Raised when a sign-in is refused because the account is suspended. Distinct
 * from a generic failure so the callback can route to the account-suspended
 * page instead of a generic OAuth error.
 */
export class AccountSuspendedError extends Error {
  readonly code = "account_suspended" as const;

  constructor() {
    super("This account is suspended.");
    this.name = "AccountSuspendedError";
  }
}

/** Raised when a request that requires a signed-in account has no session. */
export class NotAuthenticatedError extends Error {
  readonly code = "not_authenticated" as const;

  constructor() {
    super("Authentication required.");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Current signed-in user, or null.
 *
 * Returns the suspended user rather than null: the dashboard layout renders an
 * explicit "account suspended" screen, and a signed-out redirect would hide the
 * reason and offer a sign-in that is also refused. Authorization for anything
 * that matters goes through `requireActiveUser` / `getEntitlement`, which do
 * treat suspension as a hard stop.
 */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const token = await readSessionCookie();
    return await getUserFromToken(token);
  } catch (e) {
    logger.warn("session-read-error", { error: String(e) });
    return null;
  }
}

export const SESSION_COOKIE = "baton_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Bootstrap admins via BATON_ADMIN_LOGINS at sign-in (server-side only). */
export function defaultRoleForLogin(login: string): string {
  return adminLogins().includes(login.toLowerCase()) ? "admin" : "user";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionInfo {
  token: string;
  expiresAt: Date;
}

/** Create a server-side session; the raw token goes into an httpOnly cookie. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<SessionInfo> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export interface SessionUser {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  suspendedAt: Date | null;
  /** BCP-47 tag the user explicitly chose, or null when they never chose. */
  preferredLanguage: string | null;
}

/**
 * How stale a session's `lastSeenAt` may get before it is refreshed.
 *
 * `lastSeenAt` is what the settings page renders as "last active" and what an
 * admin uses to spot a session that should be revoked. It is declared
 * `@updatedAt`, which only advances when the row is written — and nothing wrote
 * it after creation, so every session reported the sign-in time forever and a
 * long-lived session was indistinguishable from an abandoned one.
 *
 * The write is throttled rather than unconditional: `getUserFromToken` runs on
 * every authenticated request, and an unthrottled write would turn each one into
 * a row update. A stale read refreshes at most once per interval.
 */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

async function touchSessionLastSeen(id: string, lastSeenAt: Date): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < LAST_SEEN_REFRESH_MS) return;
  await prisma.session
    .update({ where: { id }, data: { lastSeenAt: new Date() } })
    .catch((e) => {
      // Activity tracking is not worth failing a request over; a session that
      // vanishes underneath us still fails closed on the next lookup.
      logger.warn("session-touch-failed", { sessionId: id, error: String(e) });
    });
}

/** Resolve a request's session token to its user (with expiry check). */
export async function getUserFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  await touchSessionLastSeen(session.id, session.lastSeenAt);
  const u = session.user;
  return {
    id: u.id,
    githubId: u.githubId,
    login: u.login,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: u.role,
    suspendedAt: u.suspendedAt,
    preferredLanguage: u.preferredLanguage,
  };
}

/**
 * The one definition of how the session cookie is written.
 *
 * `secure` is derived from NODE_ENV, never from a request header. Two copies of
 * these options existed and one of them derived `secure` from the request's
 * scheme, so a spoofable `x-forwarded-proto` could produce a session cookie
 * without the Secure attribute — readable by anything on the path.
 */
export const SESSION_COOKIE_BASE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function writeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_BASE_OPTS, expires: expiresAt, maxAge: SESSION_TTL_MS / 1000 });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_BASE_OPTS, maxAge: 0 });
}

/**
 * The current user, refusing anonymous and suspended accounts.
 *
 * Server actions and route handlers that change state use this rather than
 * `currentUser`, so an already-issued session (a suspension can land after
 * sign-in, and any session minted before the check existed is still valid) stops
 * being a usable credential.
 */
export async function requireActiveUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new NotAuthenticatedError();
  if (user.suspendedAt) throw new AccountSuspendedError();
  return user;
}
