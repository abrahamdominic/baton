import { prisma } from "../db";

export type JobPayload =
  | { kind: "pr_refresh"; installationId: number; owner: string; repo: string; number: number }
  | { kind: "install_register"; installationId: number }
  | { kind: "install_unregister"; installationId: number }
  | { kind: "repo_intel"; installationId: number; owner: string; repo: string };

/**
 * Kinds the runner knows how to execute. Enforced here so a payload with an
 * unknown or malformed shape is rejected at the boundary rather than deep
 * inside `processPrRefresh`, where it would be far harder to attribute.
 */
const KNOWN_KINDS = new Set<JobPayload["kind"]>([
  "pr_refresh",
  "install_register",
  "install_unregister",
  "repo_intel",
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

  // `owner` and `repo` are required for every kind that addresses a repository.
  // Grouping them is deliberate: adding a new repository-addressing kind without
  // listing it here would let a payload with a blank owner reach the processor,
  // which then makes GitHub requests for a repository that does not exist.
  if (kind === "pr_refresh" || kind === "repo_intel") {
    if (!isNonEmptyString(p.owner) || !isNonEmptyString(p.repo)) {
      throw new Error(`malformed job payload: ${kind} requires owner and repo`);
    }
  }

  if (kind === "pr_refresh") {
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

/**
 * Queue a repository-intelligence collection.
 *
 * Intentionally fire-and-forget-callers-await-this: enqueueing must survive a
 * failure in the *caller* (a webhook handler, a cron sweep), and the queue's own
 * retry and backoff own the work once it is queued.
 */
export async function enqueueRepoIntel(
  installationId: number,
  owner: string,
  repo: string,
): Promise<void> {
  await enqueueJob({ kind: "repo_intel", installationId, owner, repo });
}