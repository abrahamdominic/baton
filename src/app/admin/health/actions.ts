"use server";

import { revalidatePath } from "next/cache";
import { clientIpFromHeaders } from "@/lib/net";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import { requeueDeadLetter } from "@/lib/engine/queue-metrics";
import { logAdminAudit } from "@/lib/billing/audit";
import { logger } from "@/lib/logger";

export interface QueueActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

async function requireAdmin() {
  const user = await currentUser();
  if (!user) throw new Error("Authentication required.");
  if (user.role !== "admin" || user.suspendedAt) throw new Error("Unauthorized.");
  return user;
}

async function auditIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

/**
 * Requeue a dead-lettered job.
 *
 * Dead-lettering is terminal on purpose, so recovery has to be an explicit
 * operator decision rather than something the queue does to itself. That
 * decision is privileged (it can re-run arbitrary work against a connected
 * installation's GitHub quota) and externally visible (the job comments on a
 * pull request), so it is admin-only, requires an explicit confirmation, and is
 * written to the immutable audit log with the job's kind and prior attempt count.
 */
export async function requeueJobAction(
  _prev: QueueActionResult,
  formData: FormData,
): Promise<QueueActionResult> {
  try {
    const admin = await requireAdmin();
    if (formData.get("confirm") !== "on") {
      return { ok: false, error: "Confirmation is required before requeueing a job." };
    }

    const jobId = String(formData.get("jobId") ?? "").trim();
    if (!jobId) return { ok: false, error: "A job id is required." };

    const outcome = await requeueDeadLetter(jobId);
    if (outcome === "not_found") {
      return { ok: false, error: "That job no longer exists." };
    }
    if (outcome === "not_failed") {
      return {
        ok: false,
        error: "That job is not in the dead-letter state, so there is nothing to requeue.",
      };
    }

    await logAdminAudit({
      adminUserId: admin.id,
      action: "queue.requeue_dead_letter",
      resourceType: "job",
      resourceId: jobId,
      ip: await auditIp(),
    });

    logger.info("admin-requeued-job", { jobId, adminId: admin.id });
    revalidatePath("/admin/health");
    return { ok: true, detail: "Job requeued. It will run on the next drain." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not requeue the job.";
    return { ok: false, error: message };
  }
}
