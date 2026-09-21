// Generates prisma/schema.sqlite.prisma from the canonical prisma/schema.prisma
// so the exact same client API and model shapes are used in local development
// (SQLite) and production (PostgreSQL).
//
// Usage: npm run db:sqlite:schema && npm run db:sqlite:push
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "prisma/schema.prisma");
const dst = resolve(root, "prisma/schema.sqlite.prisma");

let text = readFileSync(src, "utf8");

text = text.replace(
  'provider = "postgresql"',
  'provider = "sqlite"',
);
text = text.replace(
  'url      = env("DATABASE_URL")',
  'url      = "file:./dev.db"',
);

text = text.replace(
  "// This is the canonical schema and targets PostgreSQL in production.",
  "// AUTO-GENERATED SQLite mirror of schema.prisma. Do not edit directly —",
);
text = text.replace(
  "// this file (scripts/gen-sqlite-schema.mjs) so the exact same client API and",
  "// regeneration via scripts/gen-sqlite-schema.mjs.) Used only for local dev.",
);

writeFileSync(dst, text, "utf8");
console.log(`Wrote ${dst}`);