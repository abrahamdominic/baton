// Participant normalization for conversation creation.
//
// `ConversationMember` has `@@unique([conversationId, userId])`, so a user must
// never be inserted twice into the same conversation. The creator is always
// inserted as the owner, which means any client that also lists the creator
// among the selected participants (including one that repeats the same id
// several times) would violate the constraint. Prisma's nested `create` has no
// `skipDuplicates`, so the duplicates must be removed before the insert rather
// than swallowed afterwards.
//
// These helpers are pure so both the server action and the client composer
// apply exactly the same rules, and so the rules are unit-testable.

/**
 * Normalize a client-supplied participant list into the ids that must be
 * inserted as non-owner conversation members:
 *   - drop empty / non-string entries,
 *   - drop duplicates (first occurrence wins, preserving order),
 *   - drop the creator, because the creator is inserted separately as `owner`.
 *
 * The result is guaranteed to contain no id equal to `creatorId` and no
 * duplicates, so it can never trip the (conversationId, userId) unique index.
 */
export function normalizeParticipantIds(
  memberIds: readonly unknown[] | null | undefined,
  creatorId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!Array.isArray(memberIds)) return out;
  for (const raw of memberIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id) continue;
    if (id === creatorId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The full membership roster (creator first) that a conversation must end up
 * with, derived from the raw client list. The creator is always present exactly
 * once, at the front, as the owner.
 */
export function normalizeRoster(
  memberIds: readonly unknown[] | null | undefined,
  creatorId: string,
): { creatorId: string; memberIds: string[]; allIds: string[] } {
  const memberIdsOut = normalizeParticipantIds(memberIds, creatorId);
  return {
    creatorId,
    memberIds: memberIdsOut,
    allIds: [creatorId, ...memberIdsOut],
  };
}

/**
 * The exact `ConversationMember.create` rows to write for a conversation:
 * one owner row for the creator followed by one row per normalized participant.
 *
 * Exported so tests can assert that the row list is duplicate-free by
 * construction rather than by catching a database error.
 */
export function conversationMemberRows(
  memberIds: readonly unknown[] | null | undefined,
  creatorId: string,
): Array<{ userId: string; role: "owner" | "member" }> {
  return [
    { userId: creatorId, role: "owner" },
    ...normalizeParticipantIds(memberIds, creatorId).map((userId) => ({
      userId,
      role: "member" as const,
    })),
  ];
}
