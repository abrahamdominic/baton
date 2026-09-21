import { prisma } from "../db";

export type JobPayload =
  | { kind: "pr_refresh"; installationId: number; owner: string; repo: string; number: number }
  | { kind: "install_register"; installationId: number }
  | { kind: "install_unregister"; installationId: number };

export function payloadOf(job: { payloadJson: string }): JobPayload {
  return JSON.parse(job.payloadJson) as JobPayload;
}

/**
 * Enqueue a job. Idempotent-ish: a pending/processing job with the exact same
 * payload within the last 15 minutes is not duplicated. This absorbs webhook
 * duplicates and cron/sweep overlaps without loss.
 */
export async function enqueueJob(payload: JobPayload): Promise<void> {
  const overlaps = await prisma.job.count({
    where: {
      kind: payload.kind,
      status: { in: ["pending", "processing"] },
      payloadJson: JSON.stringify(payload),
      createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
    },
  });
  if (overlaps > 0) return;

  await prisma.job.create({
    data: { kind: payload.kind, payloadJson: JSON.stringify(payload), maxAttempts: 6 },
  });
}

export async function enqueuePrRefresh(
  installationId: number,
  owner: string,
  repo: string,
  number: number,
): Promise<void> {
  await enqueueJob({ kind: "pr_refresh", installationId, owner, repo, number });
}

export async function enqueueInstallRegister(installationId: number): Promise<void> {
  await enqueueJob({ kind: "install_register", installationId });
}

export async function enqueueInstallUnregister(installationId: number): Promise<void> {
  await enqueueJob({ kind: "install_unregister", installationId });
}