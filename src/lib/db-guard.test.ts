import { describe, it, expect } from "vitest";
import {
  isLocalDatabaseUrl,
  assertLocalDatabase,
} from "../../scripts/guard-local-db.mjs";

/**
 * The guard is the only thing standing between a routine `npm run db:migrate`
 * and the production database, because `prisma migrate dev` drops data when it
 * reads the schema as drifted and the target comes from `DATABASE_URL`, which a
 * developer's `.env` commonly points at production. These tests pin the
 * classification, because an over-permissive branch is the whole risk.
 */
describe("guard-local-db", () => {
  describe("isLocalDatabaseUrl", () => {
    it("treats a SQLite file as local", () => {
      expect(isLocalDatabaseUrl("file:./dev.db")).toBe(true);
      expect(isLocalDatabaseUrl("file:/tmp/baton.db")).toBe(true);
    });

    it("treats loopback addresses as local", () => {
      expect(
        isLocalDatabaseUrl("postgresql://user:pw@localhost:5432/baton"),
      ).toBe(true);
      expect(
        isLocalDatabaseUrl("postgresql://user:pw@127.0.0.1:5432/baton"),
      ).toBe(true);
      expect(isLocalDatabaseUrl("postgresql://user:pw@[::1]:5432/baton")).toBe(
        true,
      );
    });

    it("treats a hosted database as remote", () => {
      expect(
        isLocalDatabaseUrl(
          "postgresql://u:p@ep-foo.us-east-2.aws.neon.tech/baton?sslmode=require",
        ),
      ).toBe(false);
      expect(
        isLocalDatabaseUrl("postgresql://u:p@db.example.com:5432/baton"),
      ).toBe(false);
      expect(isLocalDatabaseUrl("mysql://u:p@10.0.0.4:3306/baton")).toBe(false);
    });

    it("does not let a remote host impersonate localhost in its name", () => {
      // A suffix match on a naive "localhost" test would allow this.
      expect(
        isLocalDatabaseUrl("postgresql://u:p@localhost.attacker.example/baton"),
      ).toBe(false);
      expect(isLocalDatabaseUrl("postgresql://u:p@notlocalhost/baton")).toBe(
        false,
      );
      expect(
        isLocalDatabaseUrl("postgresql://u:p@localhost.evil.co/baton"),
      ).toBe(false);
    });

    it("does not allow an unset or unparseable value through", () => {
      // Failing closed is the point: an empty DATABASE_URL must not be read as
      // "no target, so it is fine".
      expect(isLocalDatabaseUrl("")).toBe(false);
      expect(isLocalDatabaseUrl("   ")).toBe(false);
      expect(isLocalDatabaseUrl("not a url")).toBe(false);
      expect(isLocalDatabaseUrl(undefined)).toBe(false);
    });
  });

  describe("assertLocalDatabase", () => {
    const hint = "Use `npm run db:deploy`.";

    it("passes silently for a local target", () => {
      expect(() =>
        assertLocalDatabase("file:./dev.db", "cmd", hint),
      ).not.toThrow();
    });

    it("throws for a hosted target", () => {
      expect(() =>
        assertLocalDatabase(
          "postgresql://u:p@ep-foo.aws.neon.tech/baton",
          "cmd",
          hint,
        ),
      ).toThrow(/Refusing to run/);
    });

    it("names the command and the remedy so the failure is actionable", () => {
      expect(() =>
        assertLocalDatabase(
          "postgresql://u:p@ep-foo.aws.neon.tech/baton",
          "prisma migrate dev",
          hint,
        ),
      ).toThrow(/prisma migrate dev/);
      expect(() =>
        assertLocalDatabase(
          "postgresql://u:p@ep-foo.aws.neon.tech/baton",
          "prisma migrate dev",
          hint,
        ),
      ).toThrow(/db:deploy/);
    });

    it("does not echo the password back into the error", () => {
      let message = "";
      try {
        assertLocalDatabase(
          "postgresql://admin:hunter2@ep-foo.aws.neon.tech/baton",
          "cmd",
          hint,
        );
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).not.toContain("hunter2");
      // The rest of the target stays useful for diagnosis.
      expect(message).toContain("ep-foo.aws.neon.tech");
    });
  });
});
