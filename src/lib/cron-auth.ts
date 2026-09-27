import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/env-boot";
import { logger } from "@/lib/logger";

/**
 * Authorization for scheduled/internal endpoints (queue drains, repo sweeps).
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is
 * configured, so verifying that header is the documented mechanism rather than
 * an invention.
 *
 * Fails CLOSED: if `CRON_SECRET` is unset, the endpoint rejects every request.
 * The alternative — allowing unauthenticated drains so that "it just works" —
 * would let anyone on the internet trigger a repository sweep and a job drain,
 * which is a free amplification vector against both our database and the
 * GitHub API rate limit of every connected installation.
 */
export function isCronAuthorized(req: Request): boolean {
  const expected = config.CRON_SECRET.trim();
  if (!expected) {
    logger.error("cron-auth-misconfigured", {
      hint: "Set CRON_SECRET in the hosting provider's environment variables.",
    });
    return false;
  }

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1].trim());
  const want = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first. The
  // length of a secret is not itself sensitive here.
  if (provided.length !== want.length) return false;
  return timingSafeEqual(provided, want);
}

/** True when cron auth can ever succeed; surfaced in admin readiness. */
export function isCronConfigured(): boolean {
  return config.CRON_SECRET.trim().length >= 16;
}

export function cronMisconfigurationIssue(): string | null {
  const secret = config.CRON_SECRET.trim();
  if (!secret) {
    return "CRON_SECRET is not set. Scheduled queue drains and repository sweeps will reject every request, so webhooks will queue work that nothing processes.";
  }
  if (secret.length < 16) {
    return "CRON_SECRET is shorter than 16 characters. Use a long random value (for example, 32+ characters) so scheduled endpoints cannot be guessed.";
  }
  return null;
}
