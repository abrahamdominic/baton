import { describe, it, expect } from "vitest";

/**
 * Live check of the invitation's GitHub existence probe.
 *
 * The database suite stubs `fetch`, which proves the *handling* of each status
 * but says nothing about whether the endpoint or the handle is real. This test
 * deliberately hits api.github.com unauthenticated -- the same fallback
 * `verifyGitHubUserExists` uses when the inviting user has no installation
 * token -- and is the evidence that "dconco" is an account that can be invited.
 *
 * It is skipped unless BATON_LIVE_GITHUB=1, so the normal suite stays offline
 * and deterministic.
 */
const live = process.env.BATON_LIVE_GITHUB === "1";
const GITHUB_USER_TIMEOUT_MS = 8_000;

async function get(login: string): Promise<Response> {
  return fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "baton-invite-validation-test",
    },
    signal: AbortSignal.timeout(GITHUB_USER_TIMEOUT_MS),
    cache: "no-store",
  });
}

describe.skipIf(!live)("GitHub user lookup (live)", () => {
  it("resolves dconco, the handle from the bug report", async () => {
    const res = await get("dconco");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      login: string;
      id: number;
      type: string;
    };
    expect(body.login.toLowerCase()).toBe("dconco");
    expect(typeof body.id).toBe("number");
    // The invite flow keys on a real account, not an organization.
    expect(body.type).toBe("User");
  });

  it("is case-insensitive, matching how the invite normalises a handle", async () => {
    const res = await get("DCONCO");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { login: string };
    expect(body.login.toLowerCase()).toBe("dconco");
  });

  it("returns 404 for a handle that cannot exist, so the invite is refused", async () => {
    const res = await get("dconco-this-user-should-not-exist-918273645");
    expect(res.status).toBe(404);
  });

  it("resolves a well-known account, so the probe is not specific to one user", async () => {
    const res = await get("octocat");
    expect(res.status).toBe(200);
  });
});
