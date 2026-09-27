import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Database-backed test project.
 *
 * These suites exercise real Prisma against the SQLite mirror of the canonical
 * schema, because the layer they cover (queue claiming, webhook persistence,
 * classification) had only ever been tested against in-memory mocks — which is
 * how a completely undeployed worker could pass a green test suite.
 *
 * They share a single SQLite file and truncate each other's tables, so they must
 * never run concurrently with one another. `fileParallelism: false` plus a
 * single fork guarantees that. They are kept out of the default project so the
 * mocked unit tests can still run fully parallel.
 *
 * Prerequisite (the SQLite client must be the generated one):
 *   node scripts/gen-sqlite-schema.mjs
 *   npx prisma generate --schema prisma/schema.sqlite.prisma
 *
 * `npm test` runs both projects via `test:unit` then `test:db`.
 */
export default defineConfig({
  test: {
    name: "db",
    environment: "node",
    include: ["src/**/*.dbtest.{ts,tsx}"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // One file at a time: a shared database, not a shared test.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
