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
    z.string().trim().url().default(fallback),
  );
}

/**
 * A single-line env string. Trims surrounding whitespace so pasted values with
 * stray newlines or padding (a real production hazard for wallet addresses and
 * keys) never flow into payment rows or on-chain comparisons. Empty strings are
 * kept as "" (callers treat them as unset).
 */
const trimmedString = z.string().trim();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SITE_URL: urlOrDefault("https://baton-xi.vercel.app"),
  APP_URL: urlOrDefault("https://baton-xi.vercel.app"),

  DATABASE_URL: databaseUrlSchema,

  GITHUB_OAUTH_CLIENT_ID: trimmedString.default(""),
  GITHUB_OAUTH_CLIENT_SECRET: trimmedString.default(""),

  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_SLUG: trimmedString.default("abrahamdominic"),
  // GitHub App's own OAuth credentials (App settings → "Client ID" / "Client
  // secrets"). These are the GitHub App's, NOT the standalone OAuth App's
  // (GITHUB_OAUTH_*). Required only if the App has "Request user authorization
  // (OAuth) during installation" enabled.
  GITHUB_APP_CLIENT_ID: trimmedString.default(""),
  GITHUB_APP_CLIENT_SECRET: trimmedString.default(""),
  GITHUB_APP_PRIVATE_KEY_BASE64: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: trimmedString.default(""),

  BATON_WORKER_POLL_MS: z.coerce.number().default(5000),
  BATON_CRON_INTERVAL_MIN: z.coerce.number().default(720),
  BATON_JOB_CONCURRENCY: z.coerce.number().default(4),

  // ---------------------------------------------------------------
  // Supabase backend (billing, payments, subscriptions, admin store).
  // The service-role key must ONLY ever be used server-side.
  // ---------------------------------------------------------------
  SUPABASE_URL: trimmedString.default(""),
  SUPABASE_PUBLISHABLE_KEY: trimmedString.default(""),
  SUPABASE_SERVICE_ROLE_KEY: trimmedString.default(""),

  // Comma-separated GitHub logins granted the admin role at sign-in
  // (bootstrap only; real admins are managed server-side afterwards).
  BATON_ADMIN_LOGINS: trimmedString.default(""),

  // ---------------------------------------------------------------
  // USDC payments on Base.
  // ---------------------------------------------------------------
  USDC_NETWORK: trimmedString.default("base"),
  USDC_TOKEN: trimmedString.default("USDC"),
  USDC_PAYMENT_WALLET_ADDRESS: trimmedString.default(""),
  USDC_RPC_URL: urlOrDefault("https://mainnet.base.org"),
  // Native Bridged USDC (axlUSDC) contract on Base.
  USDC_TOKEN_ADDRESS: trimmedString.default("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  USDC_MIN_CONFIRMATIONS: z.coerce.number().default(12),
  // Allowed mismatch (minor units) between on-chain transfer and expected
  // amount. 0 means the exact amount must be received.
  USDC_AMOUNT_TOLERANCE_MINOR: z.coerce.number().default(0),

  // ---------------------------------------------------------------
  // Stripe.
  // ---------------------------------------------------------------
  STRIPE_SECRET_KEY: trimmedString.default(""),
  STRIPE_WEBHOOK_SECRET: trimmedString.default(""),
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
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
  let key: string | null = null;
  if (env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    const raw = env.GITHUB_APP_PRIVATE_KEY_BASE64.trim();
    // Guard against accidentally pasting a SHA256 key fingerprint
    if (raw.startsWith("SHA256:")) {
      return null;
    }
    try {
      key = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      return null;
    }
  } else if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    try {
      key = readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
    } catch {
      return null;
    }
  } else if (env.GITHUB_APP_PRIVATE_KEY) {
    key = env.GITHUB_APP_PRIVATE_KEY;
  }

  if (!key) return null;
  // Guard against non-PEM format
  if (!key.includes("-----BEGIN") || !key.includes("PRIVATE KEY-----")) {
    return null;
  }
  return key;
}

/** Check if the configured private key has a specific format issue (e.g. fingerprint). */
export function appPrivateKeyIssue(env: Env = getConfig()): string | null {
  if (env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim().startsWith("SHA256:")) {
    return "GITHUB_APP_PRIVATE_KEY_BASE64 contains a SHA256 key fingerprint, not an RSA PEM private key. Download the private key PEM file from GitHub App settings and base64-encode it.";
  }
  if (
    !resolveAppPrivateKey(env) &&
    (env.GITHUB_APP_PRIVATE_KEY_BASE64 || env.GITHUB_APP_PRIVATE_KEY_PATH || env.GITHUB_APP_PRIVATE_KEY)
  ) {
    return "GitHub App private key format is invalid. Expected a PEM containing '-----BEGIN RSA PRIVATE KEY-----'.";
  }
  return null;
}

export function isAppInstallConfigured(env: Env = getConfig()): boolean {
  return Boolean(env.GITHUB_APP_SLUG);
}

export function isGitHubConfigured(env: Env = getConfig()): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET);
}

/**
 * Return a human-readable explanation of why DATABASE_URL cannot serve the
 * canonical PostgreSQL schema, or null when it is a usable connection string.
 * Does NOT verify reachability: a syntactically valid URL may still point at
 * a host that is down, in which case the first Prisma query throws.
 */
export function databaseUrlIssue(env: Env = getConfig()): string | null {
  const url = env.DATABASE_URL.trim();
  if (!url) return "DATABASE_URL is not set on this deployment.";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    return "DATABASE_URL is not a PostgreSQL connection string (expected the protocol postgresql:// or postgres://).";
  }
  return null;
}

export function isAppConfigured(env: Env = getConfig()): boolean {
  return Boolean(
    env.GITHUB_APP_ID &&
      resolveAppPrivateKey(env) &&
      env.GITHUB_APP_WEBHOOK_SECRET,
  );
}

export function isSupabaseConfigured(env: Env = getConfig()): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function isSupabasePublishableConfigured(env: Env = getConfig()): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Return a human-readable explanation of why the Stripe webhook signing secret
 * is unusable, or null when it is unset or a valid `whsec_…` secret.
 */
export function stripeWebhookSecretIssue(env: Env = getConfig()): string | null {
  const secret = env.STRIPE_WEBHOOK_SECRET.trim();
  if (!secret) return null;
  if (!secret.startsWith("whsec_")) {
    return "STRIPE_WEBHOOK_SECRET is not a Stripe signing secret (expected a value starting with 'whsec_'). Every webhook event will fail signature validation, so orders can never be finalized.";
  }
  return null;
}

export function isStripeConfigured(env: Env = getConfig()): boolean {
  const secret = env.STRIPE_WEBHOOK_SECRET.trim();
  return Boolean(env.STRIPE_SECRET_KEY && secret.startsWith("whsec_"));
}

export function isUsdcConfigured(env: Env = getConfig()): boolean {
  // Payments are recorded in Supabase, so the backend must be reachable and a
  // receiving wallet must be configured before USDC checkout can be offered.
  return Boolean(isSupabaseConfigured(env) && env.USDC_PAYMENT_WALLET_ADDRESS);
}

export interface UsdcSettings {
  network: string;
  token: string;
  tokenAddress: string;
  rpcUrl: string;
  walletAddress: string;
  minConfirmations: number;
  amountToleranceMinor: number;
}

export function usdcSettings(env: Env = getConfig()): UsdcSettings {
  return {
    network: env.USDC_NETWORK,
    token: env.USDC_TOKEN,
    tokenAddress: env.USDC_TOKEN_ADDRESS,
    rpcUrl: env.USDC_RPC_URL,
    walletAddress: env.USDC_PAYMENT_WALLET_ADDRESS,
    minConfirmations: env.USDC_MIN_CONFIRMATIONS,
    amountToleranceMinor: env.USDC_AMOUNT_TOLERANCE_MINOR,
  };
}

/** GitHub logins that are auto-granted the admin role at sign-in (bootstrap). */
export function adminLogins(env: Env = getConfig()): string[] {
  return env.BATON_ADMIN_LOGINS
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const stableId = (n: bigint | number): string => n.toString();