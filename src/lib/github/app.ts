import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { config } from "../env-boot";
import { resolveAppPrivateKey } from "../config";
import { logger } from "../logger";
import { metrics } from "../observability/metrics";

const privateKey = resolveAppPrivateKey(config);
const appConfigured = Boolean(config.GITHUB_APP_ID && privateKey);

export function assertAppConfigured(): void {
  if (!appConfigured) {
    throw new Error(
      "Baton GitHub App is not configured. Set GITHUB_APP_ID and a private key (GITHUB_APP_PRIVATE_KEY_BASE64 / _PATH / _KEY).",
    );
  }
}

export function isAppConfiguredFlag(): boolean {
  return appConfigured;
}

/** Human identity of the bot (used in comments / label checks via bot login). */
export const BATON_APP_SLUG = config.GITHUB_APP_SLUG || "abrahamdominic";

let appAuth:
  | (ReturnType<typeof createAppAuth> extends never ? never : ReturnType<typeof createAppAuth>)
  | undefined;

function getAppAuth() {
  assertAppConfigured();
  if (!appAuth) {
    appAuth = createAppAuth({
      appId: config.GITHUB_APP_ID as number,
      privateKey: privateKey as string,
      // The GitHub App's OWN client credentials, used by Octokit only for the
      // App's user-to-server OAuth exchanges (e.g. "Request user authorization
      // during installation"). Never the standalone OAuth App's credentials.
      clientId: config.GITHUB_APP_CLIENT_ID || undefined,
      clientSecret: config.GITHUB_APP_CLIENT_SECRET || undefined,
    });
  }
  return appAuth;
}

export function getAppOctokit(): Octokit {
  assertAppConfigured();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.GITHUB_APP_ID as number,
      privateKey: privateKey as string,
      clientId: config.GITHUB_APP_CLIENT_ID || undefined,
      clientSecret: config.GITHUB_APP_CLIENT_SECRET || undefined,
    },
  });
}

export function getAppId(): number | null {
  return config.GITHUB_APP_ID ?? null;
}

// 
// Installation access tokens (cached until they're close to expiry).
// 
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return cached.token;
  }
  const auth = getAppAuth();
  const result = (await auth({ type: "installation", installationId })) as {
    token: string;
    expiresAt: string;
  };
  const expiresAt = new Date(result.expiresAt).getTime();
  tokenCache.set(installationId, { token: result.token, expiresAt });
  return result.token;
}

export function invalidateInstallationToken(installationId: number): void {
  tokenCache.delete(installationId);
}

export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return instrumented(new Octokit({ auth: token, request: { retries: 2 } }));
}

export async function getInstallationGraphql(installationId: number): Promise<typeof graphql> {
  const token = await getInstallationToken(installationId);
  return graphql.defaults({
    headers: { authorization: `bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
}

/** Convenience: create both authenticated GitHub clients for an installation. */
export async function installationClients(installationId: number) {
  const token = await getInstallationToken(installationId);
  const rest = instrumented(new Octokit({ auth: token, request: { retries: 2 } }));
  const gql = graphql.defaults({
    headers: { authorization: `bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
  return { rest, gql };
}

/**
 * Count every REST call and failure without changing behaviour.
 *
 * `request.hook` wraps the round trip rather than the response handler, so a
 * rejected promise still increments the failure counter, the failure signal is
 * exactly the case that a `response.hook` misses. The hook is intentionally
 * allowed to throw: it must not swallow a transport error.
 *
 * This is what makes "GitHub has been failing" visible in the admin health page
 * instead of only in stdout.
 */
function instrumented(octokit: Octokit): Octokit {
  octokit.hook.wrap("request", async (request, options) => {
    const startedAt = Date.now();
    try {
      const result = await request(options);
      const status = (result as { status?: number }).status ?? 0;
      metrics.githubCall("", "", status, Date.now() - startedAt);
      logRateLimit("", "", remainingFrom(result.headers?.["x-ratelimit-remaining"]));
      return result;
    } catch (error) {
      metrics.githubCall("", "", 500, Date.now() - startedAt);
      const status = statusOf(error);
      metrics.githubFailure(String(options?.method ?? "request"), `status=${status}`);
      throw error;
    }
  });
  return octokit;
}

/** Extract an HTTP status from an Octokit error without assuming its shape. */
function statusOf(error: unknown): number {
  if (typeof error !== "object" || error === null) return 0;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : 0;
}

/**
 * Parse `x-ratelimit-remaining`.
 *
 * Octokit types this header as `string | undefined`, but GitHub can send a
 * non-numeric body when a proxy sits in front of it. Coercing with `Number`
 * would turn `"unknown"` into `NaN`, and `NaN < 200` is false, so a genuine
 * exhaustion would be silently treated as healthy. Anything unparseable is
 * reported as unknown, which the alerting path treats as a warning.
 */
function remainingFrom(raw: string | number | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function logRateLimit(owner: string, repo: string, remaining: number | null | undefined) {
  // Rate-limit pressure is recorded unconditionally, not only when low: the
  // admin view needs the trend, and "we never saw a limit signal" is itself
  // only meaningful if every observation was counted.
  metrics.githubRateLimit(remaining);
  if (typeof remaining === "number" && remaining < 200) {
    logger.warn("low-rate-limit", { owner, repo, remaining });
  }
}