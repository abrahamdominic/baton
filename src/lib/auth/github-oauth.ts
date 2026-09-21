import { config } from "../env-boot";

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";

interface ExchangeResult {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

/** Build the GitHub "Sign in with GitHub" URL with a CSRF state param. */
export function oauthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: `${config.APP_URL}/auth/callback`,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_OAUTH_CLIENT_ID,
      client_secret: config.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${config.APP_URL}/auth/callback`,
    }),
  });
  return (await res.json()) as ExchangeResult;
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
    fetch(`${GITHUB_API}/user`, { headers: apiHeaders(token) }),
    fetch(`${GITHUB_API}/user/emails`, { headers: apiHeaders(token) }),
  ]);
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
        emails.find((e) => e.primary && e.verified)?.email ??
        emails[0]?.email ??
        null;
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

/** Installations available to this OAuth user token (GitHub App only). */
export async function fetchUserInstallations(token: string): Promise<number[]> {
  const res = await fetch(`${GITHUB_API}/user/installations?per_page=100`, {
    headers: apiHeaders(token),
  });
  if (!res.ok) return []; // OAuth app token or no installations — safe no-op
  const data = (await res.json()) as { installations?: { id: number }[] };
  return (data.installations ?? []).map((i) => i.id);
}