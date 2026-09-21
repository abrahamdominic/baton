import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { payloadOf } from "@/lib/engine/jobs";
import { processPrRefresh, processInstallRegister } from "@/lib/engine/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Claim one job atomically (safe across multiple worker processes).
 * Returns the claimed Job row or null when the queue is empty.
 */
async function claimOne(): Promise<{ id: string; payloadJson: string; kind: string } | null> {
  const now = new Date();

  // Recover jobs that were claimed but never finished (crash/watchdog).
  await prisma.job.updateMany({
    where: { status: "processing", startedAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } },
    data: { status: "pending", startedAt: null },
  });

  const candidate = await prisma.job.findFirst({
    where: {
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 1,
  });
  if (!candidate) return null;

  const claimed = await prisma.job.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: { status: "processing", startedAt: now },
  });
  if (claimed.count !== 1) return null; // another worker won the race
  return { id: candidate.id, payloadJson: candidate.payloadJson, kind: candidate.kind };
}

export async function processOne(): Promise<"claimed" | "empty" | "failed"> {
  const job = await claimOne();
  if (!job) return "empty";

  const payload = payloadOf({ payloadJson: job.payloadJson });
  const startedAt = Date.now();
  try {
    if (payload.kind === "pr_refresh") {
      await processPrRefresh(payload);
    } else if (payload.kind === "install_register") {
      await processInstallRegister(payload.installationId);
    } else if (payload.kind === "install_unregister") {
      const { handleUninstall } = await import("@/lib/github/install");
      await handleUninstall(payload.installationId);
    } else {
      throw new Error("unknown job kind");
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "done", finishedAt: new Date() },
    });
    logger.debug("job-done", { id: job.id, kind: payload.kind, ms: Date.now() - startedAt });
    return "claimed";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const jobRow = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        error: message.slice(0, 2000),
        startedAt: null,
      },
    });
    const permanent = message.includes("App not installed") || message.includes("Bad credentials");
    if (jobRow.attempts >= jobRow.maxAttempts || permanent) {
      logger.warn("job-dead", {
        id: job.id,
        kind: job.kind,
        attempts: jobRow.attempts,
        error: message,
      });
      return "failed";
    }
    // Exponential-ish backoff, then re-queue.
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "pending",
        nextAttemptAt: new Date(Date.now() + 30_000 * Math.pow(2, jobRow.attempts - 1)),
      },
    });
    logger.warn("job-retry-scheduled", {
      id: job.id,
      kind: job.kind,
      attempts: jobRow.attempts,
      error: message,
    });
    return "failed";
  }
}