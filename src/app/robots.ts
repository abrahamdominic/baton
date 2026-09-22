import type { MetadataRoute } from "next";
import { config } from "@/lib/env-boot";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Sensitive / account-scoped surfaces: never exposed to crawlers,
          // including GitHub OAuth entrypoints which carry an OAuth state.
          "/dashboard",
          "/auth",
          "/install",
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: `${config.SITE_URL}/sitemap.xml`,
  };
}