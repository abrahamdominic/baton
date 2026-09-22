import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { logger } from "../logger";
import { adminLogins } from "../config";

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
  };
}

const cookieOpts = {
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
  store.set(SESSION_COOKIE, token, { ...cookieOpts, expires: expiresAt, maxAge: SESSION_TTL_MS / 1000 });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOpts, maxAge: 0 });
}

/** Convenience: the current signed-in user via the request cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const token = await readSessionCookie();
    return await getUserFromToken(token);
  } catch (e) {
    logger.warn("session-read-error", { error: String(e) });
    return null;
  }
}