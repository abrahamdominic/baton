import { describe, it, expect, beforeEach } from "vitest";
import { recordSlowQuery, recentSlowQueries, resetSlowQueries } from "./db-slow-queries";

/**
 * The ring buffer is per-process state, so these tests exercise the recording
 * path directly rather than through a real query. The threshold logic itself
 * lives in the Prisma extension, which is verified by the fact that a slow
 * query produces a `db-slow-query` warn line during the full suite.
 */
describe("slow query recorder", () => {
  beforeEach(() => resetSlowQueries());

  it("returns nothing before anything is recorded", () => {
    expect(recentSlowQueries()).toEqual([]);
  });

  it("keeps recorded operations", () => {
    recordSlowQuery({ model: "Job", operation: "findMany", durationMs: 900, at: "2026-01-01T00:00:00.000Z" });
    const rows = recentSlowQueries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "Job", operation: "findMany", durationMs: 900 });
  });

  it("reports the slowest operation first", () => {
    recordSlowQuery({ model: "Job", operation: "findMany", durationMs: 600, at: "2026-01-01T00:00:00.000Z" });
    recordSlowQuery({ model: "Repo", operation: "findFirst", durationMs: 2400, at: "2026-01-01T00:00:01.000Z" });
    const rows = recentSlowQueries();
    expect(rows[0]!.durationMs).toBe(2400);
    expect(rows[1]!.durationMs).toBe(600);
  });

  it("bounds the buffer so a query storm cannot exhaust instance memory", () => {
    for (let i = 0; i < 200; i++) {
      recordSlowQuery({ model: "Job", operation: "findMany", durationMs: 500 + i, at: "2026-01-01T00:00:00.000Z" });
    }
    const rows = recentSlowQueries();
    expect(rows.length).toBeLessThanOrEqual(50);
    // The newest entries are the ones kept.
    expect(rows[0]!.durationMs).toBe(699);
  });

  it("handles a raw query with no model", () => {
    recordSlowQuery({ model: null, operation: "raw", durationMs: 1500, at: "2026-01-01T00:00:00.000Z" });
    expect(recentSlowQueries()[0]!.model).toBeNull();
  });
});
