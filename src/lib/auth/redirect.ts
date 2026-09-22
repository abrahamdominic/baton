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

/**
 * Canonical base URL used ONLY for building the GitHub OAuth `redirect_uri`.
 *
 * In production this ALWAYS resolves to the canonical APP_URL/SITE_URL
 * (`https://baton-xi.vercel.app`), never the request host. GitHub only allows
 * an OAuth `redirect_uri` that exactly matches a callback URL registered on
 * the OAuth App. If a user reaches the site through a custom/preview domain
 * and the redirect_uri is built from that host, GitHub rejects the request
 * with `redirect_uri_mismatch` and the user lands on `/?oauth_error=1`.
 * Both the authorize step (login) and the code exchange (callback) must agree
 * on this value or the exchange is rejected as well.
 */
export function getOAuthBaseUrl(req?: NextRequest): string {
  if (process.env.NODE_ENV === "production") {
    for (const candidate of [config.APP_URL, config.SITE_URL]) {
      if (candidate && !candidate.includes("localhost") && !candidate.includes("127.0.0.1")) {
        return candidate;
      }
    }
    return "https://baton-xi.vercel.app";
  }
  // Local development: localhost (or an explicit APP_URL) is what GitHub has
  // registered for the dev callback, and request-host resolution keeps
  // cross-device testing sane.
  return getAppBaseUrl(req);
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