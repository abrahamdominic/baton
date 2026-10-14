import type { NextConfig } from "next";

/**
 * Response headers that do not vary per request.
 *
 * Content-Security-Policy is NOT here — see the note below.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `frame-ancestors 'none'` in the CSP is the modern control; X-Frame-Options
  // is kept for clients that predate it. The two must agree.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Isolate this browsing context from windows opened by other origins, and
  // stop other origins from reading our responses as a subresource. Baton uses
  // redirect-based OAuth, never a popup, so `same-origin` breaks nothing.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const noIndexTag = { key: "X-Robots-Tag", value: "noindex, nofollow" };

// Account-scoped and auth surfaces are private: even though robots.txt already
// disallows them, respond with an explicit noindex header for defense-in-depth
// against crawlers that ignore robots.txt (and to cover query-string OAuth
// URLs that robots.txt cannot enumerate).
const privateRoutes: { source: string }[] = [
  { source: "/auth/:path*" },
  { source: "/dashboard/:path*" },
  { source: "/admin/:path*" },
  { source: "/api/:path*" },
  { source: "/install" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Never ship browser source maps to production: they hand an attacker the
  // original TypeScript, comments and file layout for zero runtime benefit.
  productionBrowserSourceMaps: false,
  serverExternalPackages: [
    "@prisma/client",
    "@octokit/rest",
    "@octokit/graphql",
    "@octokit/auth-app",
  ],
  async headers() {
    return [
      // Private paths first so they always carry the robots tag regardless of
      // how overlapping header rules are merged, then the global defaults.
      ...privateRoutes.map((route) => ({
        source: route.source,
        headers: [...securityHeaders, noIndexTag],
      })),
      { source: "/(.*)", headers: securityHeaders },
    ];
  },
};

export default nextConfig;