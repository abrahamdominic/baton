import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "./redirect";

/**
 * `next` is attacker-controlled on the OAuth start route and is echoed back
 * through the signed-but-publicly-initiated `state`, so these are reachable
 * pre-authentication. Every case below resolved to `https://evil.com/` on the
 * deployed origin before the fix.
 */
function resolvesOffsite(next: string): boolean {
  try {
    return new URL(sanitizeNextPath(next), "https://baton-xi.vercel.app").origin !==
      "https://baton-xi.vercel.app";
  } catch {
    return false;
  }
}

describe("sanitizeNextPath", () => {
  it("keeps legitimate internal paths", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/dashboard?plan=team&billing=monthly")).toBe(
      "/dashboard?plan=team&billing=monthly",
    );
    expect(sanitizeNextPath("/auth/install/callback?installation_id=42")).toBe(
      "/auth/install/callback?installation_id=42",
    );
  });

  it("defaults when absent", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath("")).toBe("/dashboard");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("http://evil.com/path")).toBe("/dashboard");
  });

  it("rejects backslash forms the WHATWG parser treats as authority", () => {
    // `\` is normalized to `/` for special schemes, so these all become
    // `https://evil.com/` despite starting with a single slash.
    for (const candidate of ["/\\evil.com", "/\\evil.com/path", "/\\\\evil.com", "/\\/evil.com"]) {
      expect(sanitizeNextPath(candidate)).toBe("/dashboard");
      expect(resolvesOffsite(candidate)).toBe(false);
    }
  });

  it("rejects control characters and backslashes anywhere in the value", () => {
    expect(sanitizeNextPath("/dash\nboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/dash\rboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/dash\u0000board")).toBe("/dashboard");
    expect(sanitizeNextPath("/dash\u007fboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/dash\\board")).toBe("/dashboard");
  });

  it("never returns an off-site value, for any input shape", () => {
    const candidates = [
      null,
      "",
      "//evil.com",
      "/\\evil.com",
      "/\\\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/\t/evil.com",
      "/ /evil.com",
      "////evil.com",
      "/%09/evil.com",
      "http:evil.com",
      "/dashboard",
    ];
    for (const candidate of candidates) {
      expect(resolvesOffsite(candidate as string)).toBe(false);
    }
  });
});
