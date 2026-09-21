import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { config } from "../env-boot";
import { resolveAppPrivateKey } from "../config";
import { logger } from "../logger";

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
export const BATON_APP_SLUG = "baton";

let appAuth:
  | (ReturnType<typeof createAppAuth> extends never ? never : ReturnType<typeof createAppAuth>)
  | undefined;

function getAppAuth() {
  assertAppConfigured();
  if (!appAuth) {
    appAuth = createAppAuth({
      appId: config.GITHUB_APP_ID as number,
      privateKey: privateKey as string,
      clientId: config.GITHUB_OAUTH_CLIENT_ID || undefined,
      clientSecret: config.GITHUB_OAUTH_CLIENT_SECRET || undefined,
    });
  }
  return appAuth;
}

export function getAppOctokit(): Octokit {
  return new Octokit({ authStrategy: createAppAuth, auth: getAppAuth() });
}

export function getAppId(): number | null {
  return config.GITHUB_APP_ID ?? null;
}

// ---------------------------------------------------------------------------
// Installation access tokens (cached until they're close to expiry).
// ---------------------------------------------------------------------------
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
  return new Octokit({ auth: token, request: { retries: 2 } });
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
  const rest = new Octokit({ auth: token, request: { retries: 2 } });
  const gql = graphql.defaults({
    headers: { authorization: `bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
  return { rest, gql };
}

export function logRateLimit(owner: string, repo: string, remaining: number | null | undefined) {
  if (typeof remaining === "number" && remaining < 200) {
    logger.warn("low-rate-limit", { owner, repo, remaining });
  }
}