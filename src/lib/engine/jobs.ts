import { prisma } from "../db";

export type JobPayload =
  | { kind: "pr_refresh"; installationId: number; owner: string; repo: string; number: number }
  | { kind: "install_register"; installationId: number }
  | { kind: "install_unregister"; installationId: number };

/**
 * Kinds the runner knows how to execute. Enforced here so a payload with an
 * unknown or malformed shape is rejected at the boundary rather than deep
 * inside `processPrRefresh`, where it would be far harder to attribute.
 */
const KNOWN_KINDS = new Set<JobPayload["kind"]>([
  "pr_refresh",
  "install_register",
  "install_unregister",
]);

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Parse and validate a persisted job payload.
 *
 * Throws a stable, greppable message for anything malformed. `job-runner`
 * recognises that message and dead-letters the row on first sight; a poison row
 * can therefore never be reclaimed and retried in a loop.
 */
export function payloadOf(job: { payloadJson: string }): JobPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(job.payloadJson);
  } catch {
    throw new Error(`malformed job payload: not valid JSON`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("malformed job payload: not an object");
  }
  const p = raw as Record<string, unknown>;
  const kind = p.kind;

  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind as JobPayload["kind"])) {
    throw new Error("malformed job payload: unknown kind");
  }
  if (!isPositiveInt(p.installationId)) {
    throw new Error("malformed job payload: installationId must be a positive integer");
  }

  if (kind === "pr_refresh") {
    if (!isNonEmptyString(p.owner) || !isNonEmptyString(p.repo)) {
      throw new Error("malformed job payload: pr_refresh requires owner and repo");
    }
    if (!isPositiveInt(p.number)) {
      throw new Error("malformed job payload: pr_refresh number must be a positive integer");
    }
  }

  return raw as JobPayload;
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