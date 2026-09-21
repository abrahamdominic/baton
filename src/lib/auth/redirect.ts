import { config } from "../env-boot";
import { logger } from "../logger";
import type { NextRequest } from "next/server";

export function getAppBaseUrl(req?: NextRequest): string {
  // Allow localhost only during local development / testing
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    if (req) {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (host) {
        const proto =
          req.headers.get("x-forwarded-proto") ??
          (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
        return `${proto}://${host}`;
      }
    }
    if (config.APP_URL) return config.APP_URL;
    return "http://localhost:3000";
  }

  // In production: Always resolve to production domain, never localhost
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
      return `${proto}://${host}`;
    }
  }
  if (config.APP_URL && !config.APP_URL.includes("localhost") && !config.APP_URL.includes("127.0.0.1")) {
    return config.APP_URL;
  }
  if (config.SITE_URL && !config.SITE_URL.includes("localhost") && !config.SITE_URL.includes("127.0.0.1")) {
    return config.SITE_URL;
  }
  return "https://baton-xi.vercel.app";
}

/** post-login `next` is only honored for internal paths (anti open-redirect). */
export function sanitizeNextPath(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export function absoluteUrl(path: string, req?: NextRequest): string {
  return `${getAppBaseUrl(req)}${path}`;
}

export function logAuth(actor: string, action: string, detail: Record<string, unknown> = {}) {
  logger.info(`auth:${action}`, { actor, ...detail });
}