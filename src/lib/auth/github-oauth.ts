import { config } from "../env-boot";
import { getOAuthBaseUrl } from "./redirect";

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";
// GitHub appends `iss` to OAuth callbacks so clients can detect mix-up
// attacks. Validate it when present (older redirects may omit it).
export const GITHUB_OAUTH_ISSUER = "https://github.com/login/oauth";
export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/callback";

// GitHub App installation/setup callback (registered as the GitHub App's "Setup
// URL" and "User authorization callback URL"). Deliberately distinct from the
// standalone OAuth App callback so the two integrations never share a route.
export const GITHUB_APP_INSTALL_CALLBACK_PATH = "/auth/install/callback";

const GITHUB_TIMEOUT_MS = 10_000;

/**
 * Raised when GitHub itself rejects a request (auth, exchange, or user/email
 * fetch). Distinguished from database and configuration failures so callers
 * can surface the true cause instead of blaming the database.
 */
export class GitHubApiError extends Error {
  readonly status?: number;
  readonly endpoint: string;
  constructor(endpoint: string, status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

interface ExchangeResult {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

function ghFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS), ...init });
}

/** Build the GitHub "Sign in with GitHub" URL with a CSRF state param and optional PKCE challenge. */
export function oauthAuthorizeUrl(
  state: string,
  baseUrl?: string,
  codeChallenge?: string,
): string {
  const base = baseUrl ?? getOAuthBaseUrl();
  const params = new URLSearchParams({
    client_id: config.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: `${base}${GITHUB_OAUTH_CALLBACK_PATH}`,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Build the GitHub App installation URL.
 *
 * Directs users to install the Baton GitHub App on their organization or personal
 * account, and select repositories. GitHub redirects to the Setup URL on completion.
 */
export function githubAppInstallUrl(
  appSlug: string = config.GITHUB_APP_SLUG || "abrahamdominic",
  state?: string,
): string {
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

/**
 * Exchange an authorization `code` for a GitHub token. Form-encoded request
 * body per GitHub's documented token endpoint; never appears in the browser.
 * Credentials and callback are injectable so the same endpoint serves the
 * standalone OAuth App (sign-in) and the GitHub App's own user authorization
 * (used when the App has "Request user authorization during installation" on).
 */
export async function exchangeCode(
  code: string,
  baseUrl?: string,
  creds?: { clientId: string; clientSecret: string },
  callbackPath: string = GITHUB_OAUTH_CALLBACK_PATH,
  codeVerifier?: string,
): Promise<ExchangeResult> {
  const base = baseUrl ?? getOAuthBaseUrl();
  const clientId = creds?.clientId ?? config.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = creds?.clientSecret ?? config.GITHUB_OAUTH_CLIENT_SECRET;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${base}${callbackPath}`,
  });
  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }
  const res = await ghFetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as ExchangeResult;
  } catch {
    // GitHub proxies occasionally answer non-JSON (HTML, empty body).
    return {
      access_token: "",
      token_type: "",
      scope: "",
      error: "invalid_response",
      error_description: `GitHub token endpoint returned HTTP ${res.status}`,
    };
  }
}

/**
 * Exchange an authorization `code` using the GitHub App's OWN OAuth
 * credentials. Only valid for codes GitHub issued to the GitHub App (user
 * authorization during installation). Never mix in the OAuth App's secret.
 */
export function exchangeGitHubAppCode(code: string, baseUrl?: string): Promise<ExchangeResult> {
  return exchangeCode(code, baseUrl, {
    clientId: config.GITHUB_APP_CLIENT_ID,
    clientSecret: config.GITHUB_APP_CLIENT_SECRET,
  }, GITHUB_APP_INSTALL_CALLBACK_PATH);
}

export function isAppUserOAuthConfigured(): boolean {
  return Boolean(config.GITHUB_APP_CLIENT_ID && config.GITHUB_APP_CLIENT_SECRET);
}

/** Issuer GitHub appends to GitHub App user-authorization callbacks. */
export function githubAppUserIssuer(appSlug: string = config.GITHUB_APP_SLUG || "abrahamdominic"): string {
  return `https://github.com/apps/${appSlug}`;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "baton",
  };
}

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const [userRes, emailsRes] = await Promise.all([
    ghFetch(`${GITHUB_API}/user`, { headers: apiHeaders(token) }),
    ghFetch(`${GITHUB_API}/user/emails`, { headers: apiHeaders(token) }),
  ]);
  if (!userRes.ok) {
    throw new GitHubApiError("/user", userRes.status, `GitHub user endpoint failed with HTTP ${userRes.status}`);
  }
  const user = (await userRes.json()) as Record<string, unknown> & {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  let primaryEmail: string | null = null;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as
      | { email: string; primary?: boolean; verified?: boolean }[]
      | { message?: string };
    if (Array.isArray(emails)) {
      primaryEmail =
        emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
    }
  }
  return {
    id: Number(user.id),
    login: String(user.login ?? "unknown"),
    name: user.name ?? null,
    email: primaryEmail ?? (String(user.email ?? "") || null),
    avatar_url: user.avatar_url ?? null,
  };
}

/** Installations available to this GitHub App user token. */
export async function fetchUserInstallations(token: string): Promise<number[]> {
  const res = await ghFetch(`${GITHUB_API}/user/installations?per_page=100`, {
    headers: apiHeaders(token),
  });
  if (!res.ok) return []; // OAuth App token or no installations; safe no-op
  const data = (await res.json()) as { installations?: { id: number }[] };
  return (data.installations ?? []).map((i) => i.id);
}