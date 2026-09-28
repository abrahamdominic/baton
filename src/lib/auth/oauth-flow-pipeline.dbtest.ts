/**
 * `finishOAuthSignIn` full-pipeline test.
 *
 * This lives in the DB-backed project, not the unit project, because it really
 * does upsert a user, create a session, and link an installation. As a unit
 * test it resolved `DATABASE_URL` from the ambient environment and therefore
 * ran against whatever database the developer happened to have configured -
 * including production. It is now pinned to the disposable SQLite mirror, so it
 * can never write to a real database again.
 */

import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { GITHUB_API, GITHUB_TOKEN_URL } from "./github-oauth";
import { finishOAuthSignIn } from "./oauth-flow";

const TEST_GITHUB_ID = 5550001;
const TEST_INSTALLATION_ID = 7770001;

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const headers = new Headers(init?.headers as HeadersInit);
    const isUserToken = (headers.get("authorization") ?? "").startsWith("Bearer ");

    if (url === GITHUB_TOKEN_URL) {
      return jsonResponse({ access_token: "ghu_flow_test_token", token_type: "bearer", scope: "" });
    }
    if (url === `${GITHUB_API}/user` && isUserToken) {
      return jsonResponse({
        id: TEST_GITHUB_ID,
        login: "oauth-flow-test",
        name: "OAuth Flow Test",
        email: "public@example.com",
        avatar_url: "https://example.com/avatar.png",
      });
    }
    if (url.startsWith(`${GITHUB_API}/user/emails`) && isUserToken) {
      return jsonResponse([{ email: "private@example.com", primary: true, verified: true }]);
    }
    if (url.startsWith(`${GITHUB_API}/user/installations`) && isUserToken) {
      return jsonResponse({ total_count: 1, installations: [{ id: TEST_INSTALLATION_ID }] });
    }
    return jsonResponse({ message: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.appInstallation
    .deleteMany({ where: { installationId: TEST_INSTALLATION_ID } })
    .catch(() => {});
  await prisma.user.deleteMany({ where: { githubId: TEST_GITHUB_ID } }).catch(() => {});
  await prisma.job
    .deleteMany({
      where: {
        kind: "install_register",
        payloadJson: JSON.stringify({ kind: "install_register", installationId: TEST_INSTALLATION_ID }),
      },
    })
    .catch(() => {});
});

describe("finishOAuthSignIn (full pipeline)", () => {
  it(
    "upserts the user, creates a session, and links installations",
    async () => {
    // No availability guard here on purpose. The old unit-project copy skipped
    // itself silently when no database answered, so a completely broken sign-in
    // pipeline still reported green. The DB-backed project guarantees a
    // disposable database, so a failure now fails.
    try {
      await prisma.appInstallation.upsert({
        where: { installationId: TEST_INSTALLATION_ID },
        create: {
          installationId: TEST_INSTALLATION_ID,
          accountLogin: "oauth-flow-test",
          accountType: "User",
          userId: null,
        },
        update: { userId: null, accountType: "User" },
      });

      const result = await finishOAuthSignIn({
        // GitHub App user-to-server token: ghu_* (only these can list installs).
        accessToken: "ghu_flow_test_token",
        next: "/dashboard?plan=team&billing=monthly",
        ip: "10.0.0.1",
        userAgent: "vitest",
      });

      expect(result.user.githubId).toBe(TEST_GITHUB_ID);
      expect(result.user.login).toBe("oauth-flow-test");
      expect(result.next).toBe("/dashboard?plan=team&billing=monthly");
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.installationIds).toContain(TEST_INSTALLATION_ID);

      const user = await prisma.user.findUnique({
        where: { githubId: TEST_GITHUB_ID },
        include: { sessions: true, installations: true },
      });
      expect(user).not.toBeNull();
      expect(user!.sessions.length).toBeGreaterThanOrEqual(1);
      expect(user!.installations.some((i) => i.installationId === TEST_INSTALLATION_ID)).toBe(true);
    } finally {
      await prisma.appInstallation.deleteMany({ where: { installationId: TEST_INSTALLATION_ID } }).catch(() => {});
      await prisma.user.deleteMany({ where: { githubId: TEST_GITHUB_ID } }).catch(() => {});
    }
  }, 45000);
});
