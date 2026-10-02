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

/**
 * `lastModified` is deliberately absent.
 *
 * The previous version stamped every route with the build time. That is not a
 * fact about the page: it tells a crawler that `/pricing` was rewritten every
 * time the app was deployed, which trains crawlers to ignore the field and makes
 * a real change indistinguishable from a no-op redeploy. Search engines treat a
 * missing `lastModified` as "unknown", which is the truth here — Baton has no
 * content store to ask when a marketing page last really changed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${config.SITE_URL}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/legal") ? 0.1 : 0.6,
  }));
}