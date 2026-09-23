import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_MS,
  WORKSPACE_ROLES,
  generateInviteToken,
  isGitHubLogin,
  isValidSlug,
  normalizeLogin,
  slugFromName,
  workspaceWhoseTurn,
} from "./workspace-utils";

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
    expect(slugFromName("Platform Engineering", "abc1234")).toBe("platform-engineering-abc123");
  });

  it("falls back to workspace when the name has no slug-able content", () => {
    expect(slugFromName("!!!", "xyz789")).toBe("workspace-xyz789");
  });

  it("caps the base length at 24 chars", () => {
    expect(slugFromName("a".repeat(60), "suffix")).toBe(`${"a".repeat(24)}-suffix`);
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
});