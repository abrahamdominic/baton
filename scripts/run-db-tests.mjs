#!/usr/bin/env node
/**
 * Run the database-backed test project.
 *
 * Those suites exercise real Prisma against the SQLite mirror of the canonical
 * schema, so they need the SQLite client generated. The app itself targets
 * PostgreSQL, so the PostgreSQL client is regenerated afterwards — even when the
 * tests fail — and this process always exits with the test runner's status.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, label) {
  process.stdout.write(`\n[db-tests] ${label}\n`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false });
  if (res.error) {
    process.stderr.write(`[db-tests] ${label} could not start: ${res.error.message}\n`);
    process.exit(1);
  }
  return res.status ?? 1;
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

// 1. Regenerate the SQLite mirror in case schema.prisma has moved on.
const genSqlite = run(npmCmd, ["run", "--silent", "db:sqlite:schema"], "regenerating SQLite schema");
if (genSqlite !== 0) process.exit(genSqlite);

// 2. Generate the SQLite client the db suites need.
const genClient = run(
  npmCmd,
  ["exec", "--", "prisma", "generate", "--schema", "prisma/schema.sqlite.prisma"],
  "generating SQLite Prisma client",
);
if (genClient !== 0) process.exit(genClient);

// 3. Run the database-backed project.
let status = 1;
try {
  status = run(
    npmCmd,
    ["exec", "--", "vitest", "run", "--config", "vitest.db.config.ts"],
    "running database-backed tests",
  );
} finally {
  // 4. Always restore the PostgreSQL client the app actually uses, even when the
  //    tests fail, so a red run cannot leave the workspace on the SQLite client.
  const restore = spawnSync(
    npmCmd,
    ["exec", "--", "prisma", "generate", "--schema", "prisma/schema.prisma"],
    { cwd: root, stdio: "inherit", shell: false },
  );
  if (restore.status !== 0) {
    process.stderr.write(
      "[db-tests] failed to restore the PostgreSQL client; run `npm run db:generate`\n",
    );
  }
}

process.exit(status);
