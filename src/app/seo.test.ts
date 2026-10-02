import { describe, it, expect, vi } from "vitest";
import { PUBLIC_ROUTES, default as sitemap } from "./sitemap";
import { default as robots } from "./robots";

/**
 * Tests for the indexing surface.
 *
 * `robots.txt` is advisory — a crawler that ignores it still gets a URL — so the
 * load-bearing protection is the `X-Robots-Tag` header in `next.config.ts`. These
 * tests exist mainly to catch *drift*: a new private surface added to one list
 * and not the other. That failure is silent, it ships, and it publishes private
 * repository names to a search index.
 */

vi.mock("server-only", () => ({}));

const PRIVATE_PREFIXES = ["/dashboard", "/admin", "/auth", "/install", "/api/"];

describe("sitemap", () => {
  it("lists only public routes", () => {
    const entries = sitemap();
    const urls = entries.map((e) => new URL(e.url).pathname);
    // The site root is served as "/", so the sitemap's "" normalises.
    expect(urls).toEqual(PUBLIC_ROUTES.map((r) => (r === "" ? "/" : r)));
    for (const privatePrefix of PRIVATE_PREFIXES) {
      expect(urls.some((u) => u.startsWith(privatePrefix))).toBe(false);
    }
  });

  it("claims no modification date it cannot know", () => {
    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it("points every entry at the configured site origin", () => {
    for (const entry of sitemap()) {
      expect(new URL(entry.url).origin).toBe(new URL(process.env.SITE_URL ?? "http://localhost:3000").origin);
    }
  });

  it("ranks the landing page first and legal pages last", () => {
    const entries = sitemap();
    expect(entries[0]!.priority).toBe(1);
    for (const entry of entries) {
      if (entry.url.includes("/legal/")) expect(entry.priority).toBeLessThan(0.5);
    }
  });
});

describe("robots", () => {
  it("disallows every private surface", () => {
    // Next types `rules` as either an array or a single rule object; this site
    // uses the array form, and the normaliser keeps the test honest about which.
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(true);
    const first = (rules as { disallow?: string | string[] }[])[0];
    expect(first).toBeDefined();
    const disallow = [first!.disallow ?? []].flat();
    for (const privatePrefix of PRIVATE_PREFIXES) {
      expect(disallow).toContain(privatePrefix);
    }
  });

  it("advertises the sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("robots and the noindex header agree", async () => {
  it("covers the same private surfaces in next.config.ts", async () => {
    const { default: nextConfig } = await import("../../next.config");
    const rules = await (nextConfig.headers?.() ?? []);
    const headerSources = rules.flatMap((rule) =>
      (rule.headers ?? []).some((h) => h.key === "X-Robots-Tag") ? [rule.source] : [],
    );

    // Each disallowed robots.txt prefix needs a matching header rule, otherwise
    // the prefix is only nominally protected.
    const expected = ["/auth/:path*", "/dashboard/:path*", "/admin/:path*", "/api/:path*", "/install"];
    for (const source of expected) {
      expect(headerSources).toContain(source);
    }
  });
});