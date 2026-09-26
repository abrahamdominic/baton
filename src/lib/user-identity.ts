import "server-only";

import { prisma } from "./db";

/**
 * Human-readable identity for audit rows.
 *
 * Every audit surface in Baton stores internal ids (a cuid `userId`, or a
 * Supabase `admin_user_id`). Those ids are useless to an administrator trying to
 * answer "who did this?". This module resolves a batch of ids to their GitHub
 * handle in exactly ONE query so audit listings can show `@handle` next to the
 * technical id without introducing an N+1.
 */

export interface UserIdentity {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** `@login`, the form shown in audit UIs. */
  handle: string;
  role: string;
}

const IDENTITY_SELECT = {
  id: true,
  login: true,
  name: true,
  email: true,
  avatarUrl: true,
  role: true,
} as const;

function toIdentity(row: {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}): UserIdentity {
  return { ...row, handle: `@${row.login}` };
}

/**
 * Batch-resolve user ids to identities with a single `findMany`. Unknown or
 * already-deleted ids are simply absent from the returned map.
 */
export async function userIdentitiesById(
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, UserIdentity>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.user
    .findMany({ where: { id: { in: ids } }, select: IDENTITY_SELECT })
    .catch(() => [] as Array<{ id: string; login: string; name: string | null; email: string | null; avatarUrl: string | null; role: string }>);
  return new Map(rows.map((r) => [r.id, toIdentity(r)]));
}

export async function userIdentityById(userId: string | null | undefined): Promise<UserIdentity | null> {
  if (!userId) return null;
  const map = await userIdentitiesById([userId]);
  return map.get(userId) ?? null;
}

/**
 * A readable "who" string for an audit row: `@handle (Display Name)` when both
 * are known, `@handle` when only the handle is, or `null` when the user row no
 * longer exists so the caller can fall back to the stored id.
 */
export function describeActor(identity: UserIdentity | null | undefined): string | null {
  if (!identity) return null;
  const name = identity.name?.trim();
  return name && name !== identity.login ? `${identity.handle} (${name})` : identity.handle;
}
