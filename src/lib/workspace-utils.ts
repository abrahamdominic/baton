import { randomBytes } from "node:crypto";

/**
 * Pure helpers for team/organization workspaces, kept free of server
 * dependencies so they can be unit tested in isolation.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().replace(/^@/, "");
}

const LOGIN_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
export function isGitHubLogin(value: string): boolean {
  return LOGIN_RE.test(value.trim());
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value.trim());
}

export function slugFromName(name: string, suffix: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace";
  return `${base}-${suffix.slice(0, 6)}`;
}

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Whose ball is it for a Baton state (shared board + queue rows). */
export function workspaceWhoseTurn(state: string): string {
  switch (state) {
    case "awaiting_review":
    case "awaiting_review_after_fix":
      return "Reviewers";
    case "changes_required":
    case "ci_failing":
    case "conflicts":
      return "Author";
    case "ready_to_merge":
      return "Author or maintainer";
    default:
      return "No one";
  }
}