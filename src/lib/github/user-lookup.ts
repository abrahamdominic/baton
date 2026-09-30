import { GITHUB_API } from "../auth/github-oauth";
import { getInstallationToken } from "./app";
import { logger } from "../logger";
import { myInstallations } from "../queries/dashboard";
import type { SessionUser } from "../auth/session";

/**
 * Confirm a GitHub username exists before an invitation is created.
 *
 * `new.md` requires that inviting a handle which does not exist says so, rather
 * than silently succeeding and leaving a pending invite that can never be
 * accepted. A regex is not enough: `@octocat` is a valid login shape and is
 * still not a real account.
 *
 * Two rules govern how this failure is allowed to behave:
 *
 *  1. Only a definitive **404** means "no such user". Anything else -- timeout,
 *     5xx, rate limit, missing installation token -- is an *infrastructure*
 *     problem and must not block the invite. Making a billing outage or a GitHub
 *     incident a hard dependency of team invitations would turn an unrelated
 *     blip into "I cannot invite anyone".
 *  2. The token is never logged, and the failure reason is recorded server-side
 *     only. The caller learns a boolean.
 */

const GITHUB_USER_TIMEOUT_MS = 8_000;

export type GitHubUserCheck =
  | { ok: true; login: string; id: number }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * @param token An installation access token. `null` falls back to an
 *   unauthenticated request, which GitHub rate-limits hard; that is acceptable
 *   only because the result degrades to "cannot tell".
 */
async function fetchGitHubUser(
  login: string,
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "baton-invite-validation",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${GITHUB_API}/users/${encodeURIComponent(login)}`, {
    headers,
    signal: AbortSignal.timeout(GITHUB_USER_TIMEOUT_MS),
    cache: "no-store",
  });
}

/**
 * Best-effort existence check for `login`, using the inviting user's own
 * installation so the request is attributed to a real identity rather than a
 * shared server IP.
 */
export async function verifyGitHubUserExists(
  user: SessionUser,
  login: string,
): Promise<GitHubUserCheck> {
  let token: string | null = null;
  try {
    const installations = await myInstallations(user);
    const withToken = installations.find(
      (i) => typeof i.installationId === "number",
    );
    if (withToken) {
      token = await getInstallationToken(withToken.installationId);
    }
  } catch (e) {
    // No usable token. Continue unauthenticated: the answer we need is public
    // information, and failing here would make token availability a hard
    // precondition for inviting.
    logger.info("invite-validation-no-installation-token", {
      login,
      error: String(e),
    });
  }

  let res: Response;
  try {
    res = await fetchGitHubUser(login, token);
  } catch (e) {
    logger.warn("invite-validation-unavailable", { login, error: String(e) });
    return { ok: false, reason: "unavailable" };
  }

  if (res.status === 404) {
    logger.info("invite-validation-not-found", { login });
    return { ok: false, reason: "not_found" };
  }

  if (!res.ok) {
    // Rate limited, 5xx, bad credentials: we genuinely do not know.
    logger.warn("invite-validation-unavailable", { login, status: res.status });
    return { ok: false, reason: "unavailable" };
  }

  try {
    const body = (await res.json()) as { login?: unknown; id?: unknown };
    if (typeof body.id !== "number") {
      logger.warn("invite-validation-malformed-response", { login });
      return { ok: false, reason: "unavailable" };
    }
    return {
      ok: true,
      // Trust GitHub's canonical casing, not what was typed.
      login: typeof body.login === "string" ? body.login : login,
      id: body.id,
    };
  } catch (e) {
    logger.warn("invite-validation-unparseable-response", {
      login,
      error: String(e),
    });
    return { ok: false, reason: "unavailable" };
  }
}
