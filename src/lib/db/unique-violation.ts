/**
 * Recognise a PostgreSQL unique-index violation.
 *
 * Prisma surfaces the SQLSTATE on the error, and the PostgREST/Supabase client
 * surfaces it as `code`. The code is the only thing that distinguishes "this row
 * already exists, which for an insert-once table means a concurrent writer won
 * the race and its row is the one we want" from "this insert was rejected", so
 * it is the thing to branch on, not the message text, which names whichever
 * constraint happened to trip and is not a stable contract.
 *
 * `23505` is `unique_violation`; `P2002` is Prisma's rendering of the same
 * condition for its own client.
 */
const UNIQUE_VIOLATION = "23505";
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Pull an error code out of either client, if it carries one. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isUniqueViolation(error: unknown): boolean {
  const code = errorCode(error);
  return code === UNIQUE_VIOLATION || code === PRISMA_UNIQUE_VIOLATION;
}
