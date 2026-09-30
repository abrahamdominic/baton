import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_MS,
  WORKSPACE_ROLES,
  generateInviteToken,
  isGitHubLogin,
  isValidSlug,
  normalizeLogin,
  seatVerdict,
  slugFromName,
  workspaceWhoseTurn,
} from "./workspace-utils";
import { FREE_MAX_MEMBERS } from "./billing/entitlement-core";

describe("normalizeLogin", () => {
  it("lowercases and trims", () => {
    expect(normalizeLogin("  OctoCat ")).toBe("octocat");
  });

  it("strips a leading @", () => {
    expect(normalizeLogin("@octocat")).toBe("octocat");
  });
});

describe("isGitHubLogin", () => {
  it("accepts valid GitHub logins", () => {
    expect(isGitHubLogin("octocat")).toBe(true);
    expect(isGitHubLogin("foo-bar")).toBe(true);
    expect(isGitHubLogin("a1-b2-3c")).toBe(true);
  });

  it("rejects invalid logins", () => {
    expect(isGitHubLogin("")).toBe(false);
    expect(isGitHubLogin("-foo")).toBe(false);
    expect(isGitHubLogin("foo-")).toBe(false);
    expect(isGitHubLogin("a b")).toBe(false);
    expect(isGitHubLogin("a".repeat(50))).toBe(false);
    expect(isGitHubLogin("WithUpper")).toBe(true); // GitHub names are case-insensitive
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase slugs with dashes", () => {
    expect(isValidSlug("platform-eng")).toBe(true);
    expect(isValidSlug("core")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Uppercase")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("double--dash")).toBe(false);
  });
});

describe("slugFromName", () => {
  it("derives a slug from a display name", () => {
    expect(slugFromName("Platform Engineering", "abc1234")).toBe(
      "platform-engineering-abc123",
    );
  });

  it("falls back to workspace when the name has no slug-able content", () => {
    expect(slugFromName("!!!", "xyz789")).toBe("workspace-xyz789");
  });

  it("caps the base length at 24 chars", () => {
    expect(slugFromName("a".repeat(60), "suffix")).toBe(
      `${"a".repeat(24)}-suffix`,
    );
  });
});

describe("generateInviteToken", () => {
  it("produces unique base64url tokens", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("workspaceWhoseTurn", () => {
  it("maps review-waiting states to Reviewers", () => {
    expect(workspaceWhoseTurn("awaiting_review")).toBe("Reviewers");
    expect(workspaceWhoseTurn("awaiting_review_after_fix")).toBe("Reviewers");
  });

  it("maps author states to Author", () => {
    expect(workspaceWhoseTurn("changes_required")).toBe("Author");
    expect(workspaceWhoseTurn("ci_failing")).toBe("Author");
    expect(workspaceWhoseTurn("conflicts")).toBe("Author");
  });

  it("maps ready-to-merge to the merger", () => {
    expect(workspaceWhoseTurn("ready_to_merge")).toBe("Author or maintainer");
  });

  it("defaults unknown states to No one", () => {
    expect(workspaceWhoseTurn("merged")).toBe("No one");
    expect(workspaceWhoseTurn("nope")).toBe("No one");
  });
});

describe("constants", () => {
  it("keeps the invite TTL at two weeks", () => {
    expect(INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("declares the three workspace roles", () => {
    expect(WORKSPACE_ROLES).toEqual(["owner", "admin", "member"]);
  });

  // The reported bug: inviting a GitHub username failed with
  // "An error occurred in the Server Components render" for every user, on
  // every workspace. The cap check counted the owner as a member, so a free
  // workspace (0 seats) evaluated `1 >= 0` and rejected the invite before any
  // row was written. Nothing a user typed could ever change that outcome.
  describe("seatVerdict", () => {
    it("admits an invite on a free workspace, which now has seats", () => {
      // Free moved from 0 to 3 seats so a free workspace can actually invite.
      // At 0 the "no seats" answer and the broken cap check were
      // indistinguishable, and both surfaced as the same opaque server error.
      expect(
        seatVerdict({ memberCount: 0, pendingCount: 0, cap: FREE_MAX_MEMBERS }),
      ).toBe("ok");
    });

    it("still stops a free workspace at its seat limit", () => {
      expect(
        seatVerdict({ memberCount: 3, pendingCount: 0, cap: FREE_MAX_MEMBERS }),
      ).toBe("no_seats");
      expect(
        seatVerdict({ memberCount: 2, pendingCount: 1, cap: FREE_MAX_MEMBERS }),
      ).toBe("no_seats");
    });

    it("reports no room only when a plan truly includes zero seats", () => {
      // Kept as a property: a 0-cap plan is a data value the resolver can still
      // produce (an org with no member feature), and it must refuse rather than
      // fall open.
      expect(seatVerdict({ memberCount: 0, pendingCount: 0, cap: 0 })).toBe(
        "no_seats",
      );
    });

    it("admits an invite while a paid workspace has room", () => {
      expect(seatVerdict({ memberCount: 3, pendingCount: 1, cap: 25 })).toBe(
        "ok",
      );
    });

    it("rejects the invite that would exceed the plan", () => {
      // 25 occupied plus 1 pending already fills a 25-seat plan.
      expect(seatVerdict({ memberCount: 25, pendingCount: 1, cap: 25 })).toBe(
        "no_seats",
      );
    });

    it("admits the invite that exactly fills the plan", () => {
      expect(seatVerdict({ memberCount: 24, pendingCount: 0, cap: 25 })).toBe(
        "ok",
      );
    });

    it("counts a pending invitation as an occupied seat", () => {
      // Otherwise the same person could be invited repeatedly and blow past the
      // limit one pending row at a time.
      expect(seatVerdict({ memberCount: 24, pendingCount: 1, cap: 25 })).toBe(
        "no_seats",
      );
    });

    it("gives a paid workspace the full number of seats that were sold", () => {
      // A 25-seat plan must seat 25 people, not 24. The owner is not one of
      // them.
      let verdict: string = "ok";
      for (let seated = 0; seated < 25; seated++) {
        verdict = seatVerdict({
          memberCount: seated,
          pendingCount: 0,
          cap: 25,
        });
      }
      expect(verdict).toBe("ok");
      expect(seatVerdict({ memberCount: 25, pendingCount: 0, cap: 25 })).toBe(
        "no_seats",
      );
    });
  });
});
