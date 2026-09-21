import type { MetadataRoute } from "next";
import { config } from "@/lib/env-boot";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/auth",
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: `${config.SITE_URL}/sitemap.xml`,
  };
}