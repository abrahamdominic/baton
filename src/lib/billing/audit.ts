import "server-only";
import { getAdminClient } from "@/lib/supabase/client";

export interface AdminAuditInput {
  adminUserId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append to the administrative audit log. Rows are immutable (see migration
 * trigger); nothing can silently edit or delete history afterwards.
 */
export async function logAdminAudit(input: AdminAuditInput): Promise<void> {
  const sb = getAdminClient();
  const detail = sanitize(input.detail);
  await sb.from("audit_logs").insert({
    admin_user_id: input.adminUserId,
    action: input.action,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    detail,
    ip: input.ip ?? null,
  });
}

function sanitize(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!detail) return out;
  for (const [k, v] of Object.entries(detail)) {
    if (/secret|token|password|key/i.test(k)) out[k] = "[REDACTED]";
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface AdminAuditRow {
  id: string;
  adminUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export async function listAdminAudit(opts: { limit?: number; offset?: number; action?: string } = {}) {
  const sb = getAdminClient();
  const limit = Math.min(200, opts.limit ?? 50);
  let q = sb
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + limit - 1);
  if (opts.action) q = q.eq("action", opts.action);
  const { data, error } = await q;
  if (error) throw new Error(`audit.list failed: ${error.message}`);
  return (data ?? []).map((r): AdminAuditRow => ({
    id: String(r.id),
    adminUserId: r.admin_user_id ? String(r.admin_user_id) : null,
    action: String(r.action),
    resourceType: r.resource_type ? String(r.resource_type) : null,
    resourceId: r.resource_id ? String(r.resource_id) : null,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    ip: r.ip ? String(r.ip) : null,
    createdAt: String(r.created_at),
  }));
}