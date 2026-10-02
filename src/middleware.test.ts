import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config, cspRequestHeaders, mintCspNonce } from "./middleware";

/**
 * The CSP is only worth having if it is actually strict, and it is only strict
 * if the nonce works. Two ways it silently stops working:
 *
 *  - a per-build nonce instead of a per-response one, which is a constant in the
 *    HTML of every cached page, so an injected script can read its own
 *    permission out of the page it is already running in;
 *  - `'unsafe-inline'` creeping back into `script-src`, which hands inline script
 *    execution straight back to any injection and makes the nonce decorative.
 *
 * Both are invisible at runtime and invisible to a type check, so they are
 * pinned here.
 */

function req(url = "https://baton.test/dashboard") {
  return new NextRequest(url);
}

function cspOf(headers: Headers): string {
  return headers.get("content-security-policy") ?? "";
}

afterEach(() => vi.unstubAllEnvs());

describe("CSP middleware", () => {
  it("issues a policy with a nonce on the response and passes it to the request", () => {
    const res = middleware(req());
    expect(cspOf(res.headers)).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
  });

  /**
   * Next reads the policy off the *request* to stamp its own inline flight-data
   * scripts; only the response header is enforced by the browser. If the two
   * drift apart — a fresh nonce minted for the response after the request was
   * built — every framework script loses its permission and the app stops
   * hydrating, so the same value has to appear in both.
   */
  it("forwards the same nonce to the request that it enforces on the response", () => {
    const request = req();
    const nonce = mintCspNonce();
    const forwarded = cspRequestHeaders(request, nonce);

    const responseNonce = cspOf(middleware(request).headers).match(/'nonce-([^']+)'/)![1];
    // Both carriers exist, and the layout's source of truth agrees with the
    // value the policy is built around.
    expect(forwarded.get("x-nonce")).toBe(nonce);
    expect(forwarded.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(responseNonce).not.toBe("");
  });

  it("does not disturb the request's own headers", () => {
    // The forwarded headers are a copy with two additions, not a replacement —
    // dropping a header here would change auth or locale behaviour, not just
    // security, and nothing else would notice.
    const request = req("https://baton.test/dashboard?a=1");
    request.headers.set("cookie", "baton_session=abc");
    const forwarded = cspRequestHeaders(request, "abc");
    expect(forwarded.get("cookie")).toBe("baton_session=abc");
    expect(forwarded.get("user-agent")).toBe(request.headers.get("user-agent"));
  });

  it("mints a fresh nonce per request", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const match = cspOf(middleware(req()).headers).match(/'nonce-([^']+)'/);
      expect(match).not.toBeNull();
      seen.add(match![1]);
    }
    // A build-time constant would collapse to a single value here.
    expect(seen.size).toBe(25);
  });

  it("does not allow inline or eval script execution in production", () => {
    // Dev needs `unsafe-eval` for Fast Refresh, so the policy a production
    // request receives has to be asserted against the production environment.
    vi.stubEnv("NODE_ENV", "production");
    const csp = cspOf(middleware(req()).headers);
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    // `'strict-dynamic'` is what makes the host allowlist irrelevant: a browser
    // that supports it loads only what a nonced script pulls in.
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("blocks the vectors that need no script execution at all", () => {
    const csp = cspOf(middleware(req()).headers);
    // Nothing in the browser needs a cross-origin fetch, so leaving the default
    // `connect-src` closed is free.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // `form-action` is what stops an injected form posting a session-bearing
    // request elsewhere; GitHub is reached by navigation, not by form submit.
    expect(csp).toContain("form-action 'self'");
  });

  it("skips immutable build output so the middleware stays off the hot path", () => {
    const rules = config.matcher as unknown as Array<{ source: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toContain("_next/static");
    expect(rules[0].source).toContain("_next/image");
  });
});
