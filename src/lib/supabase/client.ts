import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import { BackendNotConfiguredError } from "@/lib/billing/errors";

/**
 * Server-only Supabase access.
 *
 * The admin client uses the service-role key and is NEVER imported from
 * browser code (`server-only` enforces this at build time). The roles granted
 * to the anon/publishable key are revoked from all billing tables (see
 * supabase/migrations) so a leaked public key cannot read them either.
 */
let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  const cfg = getConfig();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
    throw new BackendNotConfiguredError(
      "The Baton backend is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (!admin) {
    admin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export { isSupabaseConfigured as isBillingConfigured } from "@/lib/config";