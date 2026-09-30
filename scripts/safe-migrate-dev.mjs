#!/usr/bin/env node
/**
 * `prisma migrate dev` against a database we are certain is disposable.
 *
 * See scripts/guard-local-db.mjs for why this wrapper exists. In short:
 * `migrate dev` drops data when it decides the database has drifted, the target
 * comes from `DATABASE_URL`, and a developer's `.env` is often the production
 * URL. The raw command had no way to tell those apart.
 */
import { guardCommand } from "./guard-local-db.mjs";

guardCommand({
  command: "prisma migrate dev",
  hint: "Use `npm run db:deploy` to apply migrations to a shared database; it never drops anything.",
});
