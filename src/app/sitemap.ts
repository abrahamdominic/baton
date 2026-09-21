import type { MetadataRoute } from "next";
import { config } from "@/lib/env-boot";

/** Public, indexable pages only. Never dashboard, auth, or private surfaces. */
export const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/faq",
  "/security",
  "/docs",
  "/legal/privacy",
  "/legal/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${config.SITE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/legal") ? 0.1 : 0.6,
  }));
}