import { config } from "../env-boot";
import { getAppBaseUrl } from "./redirect";

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";
// GitHub appends `iss` to OAuth callbacks so clients can detect mix-up
// attacks. Validate it when present (older redirects may omit it).
export const GITHUB_OAUTH_ISSUER = "https://github.com/login/oauth";
export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/callback";

const GITHUB_TIMEOUT_MS = 10_000;

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

/** Build the GitHub "Sign in with GitHub" URL with a CSRF state param. */
export function oauthAuthorizeUrl(state: string, baseUrl?: string): string {
  const base = baseUrl ?? getAppBaseUrl();
  const params = new URLSearchParams({
    client_id: config.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: `${base}${GITHUB_OAUTH_CALLBACK_PATH}`,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization `code` for a GitHub token. Form-encoded request
 * body per GitHub's documented token endpoint; never appears in the browser.
 */
export async function exchangeCode(code: string, baseUrl?: string): Promise<ExchangeResult> {
  const base = baseUrl ?? getAppBaseUrl();
  const body = new URLSearchParams({
    client_id: config.GITHUB_OAUTH_CLIENT_ID,
    client_secret: config.GITHUB_OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: `${base}${GITHUB_OAUTH_CALLBACK_PATH}`,
  });
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
    throw new Error(`GitHub user endpoint failed with HTTP ${userRes.status}`);
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