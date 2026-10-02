import { createHash } from "node:crypto";
import { prisma } from "../db";

export type JobPayload =
  | { kind: "pr_refresh"; installationId: number; owner: string; repo: string; number: number }
  | { kind: "install_register"; installationId: number }
  | { kind: "install_unregister"; installationId: number }
  | { kind: "repo_intel"; installationId: number; owner: string; repo: string }
  | { kind: "repo_automations"; installationId: number; owner: string; repo: string };

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
  "repo_automations",
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
  if (kind === "pr_refresh" || kind === "repo_intel" || kind === "repo_automations") {
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
 * Stable occupancy key for a payload.
 *
 * Derived from the payload rather than from the row, so every producer that
 * enqueues the same logical work computes the same key. The unique index on
 * `(kind, dedupeKey)` then enforces "at most one in-flight job per payload"
 * in the database, which is the only place that can actually arbitrate between
 * concurrent writers.
 */
function dedupeKeyOf(payload: JobPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

/**
 * Enqueue a job, collapsing duplicates onto one in-flight row.
 *
 * The invariant is "no two pending/processing rows carry the same payload", and
 * it is enforced by the `Job_kind_dedupeKey_key` unique index rather than by a
 * read-then-write check. A previous version counted overlapping rows and then
 * inserted, with nothing between the two: two concurrent identical webhook
 * deliveries could both observe zero overlaps and both insert, and the same PR
 * was then classified twice, commenting twice on GitHub.
 *
 * `dedupeKey` is cleared by the runner on every terminal transition, so this
 * only ever suppresses duplicates of work that is *already queued or running*.
 * Once a job finishes, the same payload queues again normally.
 */
export async function enqueueJob(payload: JobPayload): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  try {
    await prisma.job.create({
      data: {
        kind: payload.kind,
        payloadJson,
        dedupeKey: dedupeKeyOf(payload),
        maxAttempts: 6,
      },
    });
  } catch (e) {
    // P2002 is the unique index firing, i.e. exactly the duplicate we want to
    // collapse. Anything else is a real failure and must not be swallowed.
    if (isUniqueViolation(e)) return;
    throw e;
  }
}

/** Prisma's unique-constraint violation, across client versions. */
function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (code === "P2002") return true;
  // The generated SQLite client has historically reported the constraint as a
  // message rather than a code, so accept the shape too.
  const message = (e as { message?: unknown }).message;
  return typeof message === "string" && /unique constraint failed/i.test(message);
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

/**
 * Queue the automated-workflow suite for a repository (§8).
 *
 * Separate from `repo_intel` on purpose. Intelligence collection hits the
 * GitHub API and is rate-limited; the workflow suite reads only persisted state,
 * is cheap, and must not be blocked behind (or share a dedupe slot with) an
 * expensive collection job. Sharing a kind would also make the admin latency
 * report unable to distinguish a slow API sweep from a slow analysis.
 */
export async function enqueueRepoAutomations(
  installationId: number,
  owner: string,
  repo: string,
): Promise<void> {
  await enqueueJob({ kind: "repo_automations", installationId, owner, repo });
}