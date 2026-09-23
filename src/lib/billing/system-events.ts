import "server-only";
import { getAdminClient } from "@/lib/supabase/client";

export type SystemSeverity = "info" | "warn" | "error";

export interface SystemEventInput {
  eventType: string;
  severity?: SystemSeverity;
  status?: string | null;
  message: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record an application error/event for the admin health page.
 * Safe messages only: never secrets, tokens, or raw payloads.
 */
export async function recordSystemEvent(input: SystemEventInput): Promise<void> {
  const sb = getAdminClient();
  const safeMetadata = sanitizeMetadata(input.metadata);
  await sb.from("system_events").insert({
    event_type: input.eventType,
    severity: input.severity ?? "error",
    status: input.status ?? null,
    message: String(input.message).slice(0, 500),
    user_id: input.userId ?? null,
    metadata: safeMetadata,
  });
}

const SENSITIVE_KEYS = /secret|token|password|authorization|key|signature|private/i;

function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = "[REDACTED]";
    else if (typeof v === "object" && v !== null) out[k] = "[object]";
    else out[k] = v;
  }
  return out;
}

export async function recentSystemEvents(limit = 100, severity?: SystemSeverity) {
  const sb = getAdminClient();
  let q = sb.from("system_events").select("*").order("created_at", { ascending: false }).limit(limit);
  if (severity) q = q.eq("severity", severity);
  const { data, error } = await q;
  if (error) throw new Error(`system_events.list failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    eventType: String(r.event_type),
    severity: String(r.severity),
    status: r.status ? String(r.status) : null,
    message: String(r.message),
    userId: r.user_id ? String(r.user_id) : null,
    metadata: r.metadata ?? {},
    createdAt: String(r.created_at),
  }));
}