import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const noIndexTag = { key: "X-Robots-Tag", value: "noindex, nofollow" };

// Account-scoped and auth surfaces are private: even though robots.txt already
// disallows them, respond with an explicit noindex header for defense-in-depth
// against crawlers that ignore robots.txt (and to cover query-string OAuth
// URLs that robots.txt cannot enumerate).
const privateRoutes: { source: string }[] = [
  { source: "/auth/:path*" },
  { source: "/dashboard/:path*" },
  { source: "/api/:path*" },
  { source: "/install" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
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