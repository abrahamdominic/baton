import { config } from "../env-boot";
import { logger } from "../logger";

/** post-login `next` is only honored for internal paths (anti open-redirect). */
export function sanitizeNextPath(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export function absoluteUrl(path: string): string {
  return `${config.APP_URL}${path}`;
}

export function logAuth(actor: string, action: string, detail: Record<string, unknown> = {}) {
  logger.info(`auth:${action}`, { actor, ...detail });
}