import { readFileSync } from "node:fs";
import { z } from "zod";

// DATABASE_URL is consumed by the Prisma postgres client in production and is
// not needed at build time or for the SQLite dev mirror, so it defaults to ""
// here. A production deploy without it fails loudly at the first query.
const databaseUrlSchema = z.string().default("");

// PaaS providers (Vercel, etc.) often inject empty strings for vars that were
// never configured. Treat those as unset so the sensible fallback is used.
function urlOrDefault(fallback: string) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().default(fallback),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SITE_URL: urlOrDefault("https://baton.dev"),
  APP_URL: urlOrDefault("http://localhost:3000"),

  DATABASE_URL: databaseUrlSchema,

  GITHUB_OAUTH_CLIENT_ID: z.string().default(""),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().default(""),

  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_SLUG: z.string().default("baton"),
  GITHUB_APP_PRIVATE_KEY_BASE64: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().default(""),

  BATON_WORKER_POLL_MS: z.coerce.number().default(5000),
  BATON_CRON_INTERVAL_MIN: z.coerce.number().default(720),
  BATON_JOB_CONCURRENCY: z.coerce.number().default(4),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

/** Validated environment. Call after reading .env at boot. */
export function getConfig(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Resolve the GitHub App private key from any supported input format. */
export function resolveAppPrivateKey(env: Env): string | null {
  if (env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    return Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
  }
  if (env.GITHUB_APP_PRIVATE_KEY) {
    return env.GITHUB_APP_PRIVATE_KEY;
  }
  return null;
}

export function isGitHubConfigured(env: Env = getConfig()): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET);
}

export function isAppConfigured(env: Env = getConfig()): boolean {
  return Boolean(
    env.GITHUB_APP_ID &&
      resolveAppPrivateKey(env) &&
      env.GITHUB_APP_WEBHOOK_SECRET,
  );
}

export const stableId = (n: bigint | number): string => n.toString();