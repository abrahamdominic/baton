import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { BillingInputError } from "./errors";
import { planFromRow, type Row } from "./records";
import type { PlanRecord } from "./types";

/**
 * Plan catalog. Public pricing reads the same source of truth the admin
 * dashboard edits (supabase `plans`), so prices never drift between pages.
 */

export async function listPlans(opts: { includeInactive?: boolean } = {}): Promise<PlanRecord[]> {
  const sb = getAdminClient();
  const select = sb
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  if (!opts.includeInactive) select.eq("is_public", true).eq("is_active", true);
  const { data, error } = await select;
  if (error) throw new Error(`plans.list failed: ${error.message}`);
  return (data ?? []).map((r) => planFromRow(r as Row));
}

export async function publicPlans(): Promise<PlanRecord[]> {
  return listPlans();
}

export async function getPlanBySlug(slug: string): Promise<PlanRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb.from("plans").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`plans.get failed: ${error.message}`);
  return data ? planFromRow(data as Row) : null;
}

export async function getPlanById(id: string): Promise<PlanRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb.from("plans").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`plans.get failed: ${error.message}`);
  return data ? planFromRow(data as Row) : null;
}

export interface PlanInput {
  slug: string;
  name: string;
  description?: string | null;
  monthly_price_cents: number;
  annual_price_cents: number;
  price_custom?: boolean;
  currency?: string;
  features?: unknown;
  limits?: unknown;
  stripe_product_id?: string | null;
  stripe_monthly_price_id?: string | null;
  stripe_annual_price_id?: string | null;
  is_active?: boolean;
  is_public?: boolean;
  sort_order?: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/;

export function validatePlanInput(input: PlanInput): void {
  if (!SLUG_RE.test(input.slug)) {
    throw new BillingInputError("Plan slug may only contain lowercase letters, numbers, dashes and underscores.");
  }
  if (!input.name.trim()) throw new BillingInputError("Plan name is required.");
  if (!Number.isSafeInteger(input.monthly_price_cents) || input.monthly_price_cents < 0) {
    throw new BillingInputError("Monthly price must be a non-negative integer in cents.");
  }
  if (!Number.isSafeInteger(input.annual_price_cents) || input.annual_price_cents < 0) {
    throw new BillingInputError("Annual price must be a non-negative integer in cents.");
  }
}

/** Admin create or update a plan. All writes are validated and audited by caller. */
export async function upsertPlan(id: string | null, input: PlanInput): Promise<PlanRecord> {
  validatePlanInput(input);
  const sb = getAdminClient();
  const payload = {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    monthly_price_cents: input.monthly_price_cents,
    annual_price_cents: input.annual_price_cents,
    price_custom: input.price_custom ?? false,
    currency: input.currency ?? "USD",
    features: input.features ?? [],
    limits: input.limits ?? {},
    stripe_product_id: input.stripe_product_id ?? null,
    stripe_monthly_price_id: input.stripe_monthly_price_id ?? null,
    stripe_annual_price_id: input.stripe_annual_price_id ?? null,
    is_active: input.is_active ?? true,
    is_public: input.is_public ?? true,
    sort_order: input.sort_order ?? 0,
  };
  if (id) {
    const { data, error } = await sb
      .from("plans")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(`plans.update failed: ${error.message}`);
    return planFromRow(data as Row);
  }
  const { data, error } = await sb.from("plans").insert(payload).select("*").single();
  if (error) throw new Error(`plans.create failed: ${error.message}`);
  return planFromRow(data as Row);
}