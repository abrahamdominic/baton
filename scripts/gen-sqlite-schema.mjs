// Generates prisma/schema.sqlite.prisma from the canonical prisma/schema.prisma
// so the exact same client API and model shapes are used in local development
// (SQLite) and production (PostgreSQL).
//
// Usage: npm run db:sqlite:schema && npm run db:sqlite:push
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDatabase } from "./guard-local-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "prisma/schema.prisma");
const dst = resolve(root, "prisma/schema.sqlite.prisma");

let text = readFileSync(src, "utf8");

/**
 * Replace `needle`, or refuse to continue.
 *
 * `String.prototype.replace` returns the input unchanged when nothing matches,
 * and this file used to discard that signal. A reformat of `schema.prisma` was
 * therefore enough to emit a "SQLite" schema that still said
 * `provider = "postgresql"` and `url = env("DATABASE_URL")`, after which
 * `db:sqlite:push --force-reset` would reset the production database. Failing
 * here turns that silent path into a build error.
 */
function replaceChecked(haystack, needle, replacement, what) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `Cannot generate ${dst}: expected to find ${what} in ${src}, but it is not there.\n` +
        `Looking for: ${JSON.stringify(needle)}\n\n` +
        `Update this script to match the current formatting of the canonical schema. ` +
        `Refusing to write a SQLite mirror that may still point at production.`,
    );
  }
  return haystack.replace(needle, replacement);
}

text = replaceChecked(
  text,
  'provider = "postgresql"',
  'provider = "sqlite"',
  "the PostgreSQL datasource provider",
);
text = replaceChecked(
  text,
  'url      = env("DATABASE_URL")',
  'url      = "file:./dev.db"',
  "the env() datasource url",
);

// The header swap is cosmetic, so it must never be the thing that fails. Apply
// it only while the markers are present.
text = text.replace(
  "// This is the canonical schema and targets PostgreSQL in production.",
  "// AUTO-GENERATED SQLite mirror of schema.prisma. Do not edit directly, ",
);
text = text.replace(
  "// this file (scripts/gen-sqlite-schema.mjs) so the exact same client API and",
  "// regeneration via scripts/gen-sqlite-schema.mjs.) Used only for local dev.",
);

// Final assertion on the emitted document, independent of the replacements
// above. This is what the destructive consumer of this file reads.
if (text.includes('env("DATABASE_URL")')) {
  throw new Error(
    `Refusing to write ${dst}: it still resolves its datasource from DATABASE_URL.\n` +
      `The consumer of this file runs \`prisma db push --force-reset\`, so a schema that\n` +
      `can point at a shared database is a data-loss hazard.`,
  );
}
if (!/provider\s*=\s*"sqlite"/.test(text)) {
  throw new Error(
    `Refusing to write ${dst}: the datasource provider is not "sqlite".`,
  );
}
if (!/url\s*=\s*"file:/.test(text)) {
  throw new Error(
    `Refusing to write ${dst}: the datasource url is not a local file.`,
  );
}

// `db push --force-reset` is the only consumer, and it is destructive, so the
// final target is asserted here as well as at the call site. This catches a
// hand-edited schema file as well as a bad generation.
assertLocalDatabase(
  "file:./dev.db",
  "prisma db push --force-reset (prisma/schema.sqlite.prisma)",
  "A SQLite mirror must use a file: url. Remove the hard-coded reset and use `npm run db:deploy`.",
);

writeFileSync(dst, text, "utf8");
console.log(`Wrote ${dst}`);
