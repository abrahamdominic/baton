import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

/**
 * Security response headers are invisible in normal use and easy to delete by
 * accident, so the configuration is pinned here rather than trusted. A missing
 * header does not break a page; it silently removes a control.
 *
 * The Content-Security-Policy lives in `src/middleware.ts` because it needs a
 * per-request nonce, and is covered by `src/middleware.test.ts`.
 */

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function rules(): Promise<HeaderRule[]> {
  return (await nextConfig.headers!()) as HeaderRule[];
}

function headerOn(ruleset: HeaderRule[], source: string, key: string): string | undefined {
  const rule = ruleset.find((r) => r.source === source);
  return rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("security headers", () => {
  it("disables the framework signature", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("does not ship browser source maps", () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });

  it("sets the baseline hardening headers on every response", async () => {
    const ruleset = await rules();
    const all = ruleset.find((r) => r.source === "/(.*)");
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key.toLowerCase());
    for (const required of [
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
      "strict-transport-security",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
    ]) {
      expect(keys).toContain(required);
    }
    expect(headerOn(ruleset, "/(.*)", "x-content-type-options")).toBe("nosniff");
    expect(headerOn(ruleset, "/(.*)", "x-frame-options")).toBe("DENY");
    expect(headerOn(ruleset, "/(.*)", "cross-origin-opener-policy")).toBe("same-origin");
    expect(headerOn(ruleset, "/(.*)", "cross-origin-resource-policy")).toBe("same-origin");
    expect(headerOn(ruleset, "/(.*)", "strict-transport-security")).toContain("preload");
  });

  it("denies camera, microphone, geolocation and payment", async () => {
    const policy = headerOn(await rules(), "/(.*)", "permissions-policy") ?? "";
    for (const feature of ["camera=()", "microphone=()", "geolocation=()", "payment=()"]) {
      expect(policy).toContain(feature);
    }
  });

  it("marks every private route noindex", async () => {
    const ruleset = await rules();
    for (const source of ["/auth/:path*", "/dashboard/:path*", "/admin/:path*", "/api/:path*", "/install"]) {
      expect(headerOn(ruleset, source, "x-robots-tag")).toBe("noindex, nofollow");
    }
  });
});
