/**
 * Refuse to run a destructive or development-only database command against
 * anything that is not a local, disposable database.
 *
 * Why this exists
 * ---------------
 * `prisma migrate dev` and `prisma db push --force-reset` both decide what to
 * do by comparing the schema on disk against the schema in the database. When
 * they disagree in a way they read as drift, they *drop data* to reconcile it.
 * That is the correct behaviour for a scratch database and a data-loss bug for
 * a production one.
 *
 * The trap is that the target is chosen by `DATABASE_URL`, and a developer's
 * `.env` is frequently the production URL. There is nothing in the command that
 * distinguishes "reset my scratch file" from "reset my customer's rows", so a
 * routine `npm run db:migrate` after a pull, or a SQLite schema that silently
 * failed to rewrite its datasource, reaches straight through to production.
 *
 * A second, quieter path existed in the SQLite mirror generator: it used
 * `String.prototype.replace` without checking whether anything matched, so
 * reformatting `schema.prisma` would leave `provider = "postgresql"` and
 * `url = env("DATABASE_URL")` in the generated file. `db:sqlite:push
 * --force-reset` would then reset the production database. The generator now
 * fails loudly instead, and this module is the second line of defence.
 *
 * There is deliberately no environment-variable override. A bypass flag is
 * exactly what turns a guard back into an accident waiting to happen; the
 * supported way to work against a real database is `db:deploy`, which only ever
 * applies committed migrations and never drops anything.
 */

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "[::1]",
]);

/** Hostnames that are unambiguously a developer's own machine. */
const LOCAL_SUFFIXES = [".local", ".localhost", ".test", ".internal"];

/**
 * True when `url` cannot be a shared, customer-facing database: either a file
 * on this machine, or a loopback address.
 */
export function isLocalDatabaseUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return false;
  if (raw.startsWith("file:")) return true;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // An unparseable value is not something to guess about. Treat it as remote
    // so the command stops and a human reads the message.
    return false;
  }

  if (LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) return true;
  return LOCAL_SUFFIXES.some((suffix) =>
    parsed.hostname.toLowerCase().endsWith(suffix),
  );
}

/**
 * The database URL a command would actually use, honouring `.env` the same way
 * Prisma does when a command is run through npm.
 */
export function readDatabaseUrl() {
  // An explicit environment variable always wins, which keeps CI and the test
  // harness able to point at their own throwaway database.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return "";
}

/**
 * Throw unless `url` is a local, disposable database.
 *
 * @param {string} url       the resolved database URL
 * @param {string} command   the command being guarded, for the error message
 * @param {string} hint      what the user should run instead
 */
export function assertLocalDatabase(url, command, hint) {
  if (isLocalDatabaseUrl(url)) return;
  const shown = String(url ?? "").replace(/:[^:@/]*@/, ":***@");
  throw new Error(
    [
      `Refusing to run \`${command}\` against a non-local database.`,
      ``,
      `  target: ${shown || "(DATABASE_URL not set)"}`,
      ``,
      `This command can DROP TABLES to reconcile schema drift. It is only ever`,
      `safe against a local SQLite file or a loopback address.`,
      ``,
      `  ${hint}`,
    ].join("\n"),
  );
}

/** Guard a command that reads `DATABASE_URL` from the environment. */
export function guardCommand({ command, hint, url = readDatabaseUrl() }) {
  assertLocalDatabase(url, command, hint);
}
