#!/usr/bin/env node
/**
 * `prisma db push --force-reset` against the disposable local SQLite file.
 *
 * The generated mirror is expected to hard-code `file:./dev.db`, so the target
 * is verified here rather than assumed. If the schema ever stops being a local
 * mirror, this stops the reset instead of performing it.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDatabase } from "./guard-local-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(
  resolve(root, "prisma/schema.sqlite.prisma"),
  "utf8",
);

const match = schema.match(/datasource\s+\w+\s*\{[^}]*url\s*=\s*"([^"]+)"/s);
if (!match) {
  // Almost always `url = env("DATABASE_URL")`, which is the exact configuration
  // that turns this command into a production reset, so say that rather than
  // leaving the reader to work it out.
  const looksRemote = /url\s*=\s*env\("DATABASE_URL"\)/.test(schema);
  throw new Error(
    looksRemote
      ? "prisma/schema.sqlite.prisma resolves its datasource from DATABASE_URL.\n" +
          "\n" +
          "This script then runs `prisma db push --force-reset`, so it would drop data in\n" +
          "whatever DATABASE_URL happens to point at -- which in a developer checkout is\n" +
          "usually the production database. Refusing to run.\n" +
          "\n" +
          "  Run `npm run db:sqlite:schema` to regenerate the mirror with a file: url."
      : "prisma/schema.sqlite.prisma does not declare a literal datasource url.\n" +
          "Run `npm run db:sqlite:schema` to regenerate it before pushing.",
  );
}

assertLocalDatabase(
  match[1],
  "prisma db push --force-reset",
  "The SQLite mirror must target a local file. Use `npm run db:deploy` for a shared database.",
);

process.stdout.write(
  `[db:sqlite:push] target is local (${match[1]}); --force-reset is safe\n`,
);
