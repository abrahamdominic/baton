import { getConfig } from "./config";

// Load .env for CLI tooling (worker/cron/scripts) that runs outside Next.js.
// Next.js loads .env itself; loadEnvFile is a no-op without the file present.
try {
  process.loadEnvFile?.();
} catch {
  // no .env file — leave process.env as-is
}

/**
 * Eagerly-loaded validated environment. Import { config } from anywhere in
 * the server graph; throws a friendly error at boot if the environment is
 * misconfigured so misconfigurations never fail silently in production.
 */
export const config = getConfig();
export { getConfig } from "./config";