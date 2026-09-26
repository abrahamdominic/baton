import { describe, it, expect } from "vitest";
import {
  conversationMemberRows,
  normalizeParticipantIds,
  normalizeRoster,
} from "./participants";

/**
 * Regression coverage for the conversation unique-constraint bug:
 * `ConversationMember @@unique([conversationId, userId])` was violated whenever a
 * sender selected themselves in the new-conversation participant selector, because
 * the creator was inserted as `owner` and then again from the selected list.
 */
describe("normalizeParticipantIds", () => {
  const ME = "user_me";

  it("drops the creator so they are never inserted twice (the reported bug)", () => {
    expect(normalizeParticipantIds([ME], ME)).toEqual([]);
    expect(normalizeParticipantIds([ME, "user_b"], ME)).toEqual(["user_b"]);
    expect(normalizeParticipantIds(["user_b", ME], ME)).toEqual(["user_b"]);
  });

  it("collapses repeated ids submitted directly to the backend", () => {
    expect(normalizeParticipantIds(["a", "a", "b", "a", "b"], ME)).toEqual(["a", "b"]);
  });

  it("collapses the creator repeated many times alongside other participants", () => {
    expect(normalizeParticipantIds([ME, ME, "a", ME, "b", "a"], ME)).toEqual(["a", "b"]);
  });

  it("ignores non-string, empty and whitespace-only entries", () => {
    expect(normalizeParticipantIds(["a", "", "   ", null, 42, {}, "b"], ME)).toEqual(["a", "b"]);
  });

  it("trims ids so a padded duplicate collapses onto the canonical one", () => {
    expect(normalizeParticipantIds([" a ", "a", " a"], ME)).toEqual(["a"]);
  });

  it("preserves first-seen order", () => {
    expect(normalizeParticipantIds(["z", "m", "a", "m"], ME)).toEqual(["z", "m", "a"]);
  });

  it("tolerates a missing or non-array list", () => {
    expect(normalizeParticipantIds(undefined, ME)).toEqual([]);
    expect(normalizeParticipantIds(null, ME)).toEqual([]);
    expect(normalizeParticipantIds("nope" as unknown as string[], ME)).toEqual([]);
  });
});

describe("normalizeRoster", () => {
  const ME = "user_me";

  it("always lists the creator exactly once, first", () => {
    const roster = normalizeRoster([ME, "user_b", "user_b"], ME);
    expect(roster.creatorId).toBe(ME);
    expect(roster.allIds).toEqual([ME, "user_b"]);
    expect(roster.allIds.filter((id) => id === ME)).toHaveLength(1);
  });

  it("works for a solo conversation with nobody else selected", () => {
    const roster = normalizeRoster([ME], ME);
    expect(roster.allIds).toEqual([ME]);
  });

  it("produces an allIds list with no duplicates at all", () => {
    const roster = normalizeRoster([ME, "a", "a", "b", ME], ME);
    expect(new Set(roster.allIds).size).toBe(roster.allIds.length);
  });
});

describe("conversationMemberRows", () => {
  const ME = "user_me";

  it("emits exactly one row per user, with the creator as owner", () => {
    const rows = conversationMemberRows([ME, "b", "b", "c"], ME);
    expect(rows).toEqual([
      { userId: ME, role: "owner" },
      { userId: "b", role: "member" },
      { userId: "c", role: "member" },
    ]);
  });

  it("can never emit two rows with the same userId (the unique constraint)", () => {
    const cases: unknown[][] = [
      [ME],
      [ME, ME],
      [ME, ME, ME, ME],
      ["a", "a"],
      [ME, "a", "a", ME, "a"],
      [null, ME, "a", "a", ""],
    ];
    for (const input of cases) {
      const rows = conversationMemberRows(input, ME);
      const ids = rows.map((r) => r.userId);
      expect(new Set(ids).size, `duplicates for ${JSON.stringify(input)}`).toBe(ids.length);
      expect(ids[0]).toBe(ME);
      expect(rows[0].role).toBe("owner");
    }
  });

  it("always includes the creator exactly once even for a duplicate-only payload", () => {
    const rows = conversationMemberRows([ME, ME], ME);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ userId: ME, role: "owner" });
  });
});
