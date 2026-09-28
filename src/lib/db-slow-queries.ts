import { logger } from "./logger";

/**
 * Slow-query visibility (aa.md §26).
 *
 * Prisma will happily execute a query that takes four seconds inside a request
 * that is supposed to be fast, and the only trace is a user staring at a
 * spinner. Every query over the threshold is logged as a structured warning so
 * it lands in production logs, and kept in a small in-process ring buffer so the
 * admin health page can show the worst recent offenders.
 *
 * Scope and honesty about the buffer: this is per-instance state. On a
 * serverless platform each warm function has its own buffer, so the admin view
 * shows slow queries observed by whichever instance served the request. It is a
 * diagnostic aid, not a fleet-wide metric — the log lines are the durable
 * record, and a proper fleet view would need a metrics backend. The page labels
 * it accordingly rather than presenting it as complete.
 */

export interface SlowQueryRecord {
  model: string | null;
  operation: string;
  durationMs: number;
  at: string;
}

const THRESHOLD_MS = 500;
const MAX_RECORDS = 50;

const globalForSlow = globalThis as unknown as { __batonSlowQueries?: SlowQueryRecord[] };

function buffer(): SlowQueryRecord[] {
  globalForSlow.__batonSlowQueries ??= [];
  return globalForSlow.__batonSlowQueries;
}

/** Exposed for tests; production code should go through `prisma`. */
export function recordSlowQuery(rec: SlowQueryRecord): void {
  const b = buffer();
  b.push(rec);
  if (b.length > MAX_RECORDS) b.splice(0, b.length - MAX_RECORDS);
  logger.warn("db-slow-query", {
    model: rec.model,
    operation: rec.operation,
    durationMs: rec.durationMs,
  });
}

export function recentSlowQueries(): SlowQueryRecord[] {
  return [...buffer()].sort((a, b) => b.durationMs - a.durationMs);
}

export function resetSlowQueries(): void {
  buffer().length = 0;
}

/**
 * Prisma client extension that times every model operation.
 *
 * Applied via `$extends` rather than the deprecated `$use` middleware. Only
 * `query`/`create`/`update`/`delete` are wrapped: a raw `$queryRaw` call is left
 * alone because those are migrations and analytics reads, where a long duration
 * is expected rather than a defect.
 */
export function slowQueryExtension(thresholdMs = THRESHOLD_MS) {
  return (client: {
    $extends: (ext: Record<string, unknown>) => unknown;
  }): unknown =>
    client.$extends({
      name: "baton-slow-query-timing",
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model?: string;
            operation: string;
            args?: unknown;
            query: (args: unknown) => Promise<unknown>;
          }): Promise<unknown> {
            const started = Date.now();
            try {
              return await query(args);
            } finally {
              const durationMs = Date.now() - started;
              if (durationMs >= thresholdMs) {
                recordSlowQuery({
                  model: model ?? null,
                  operation,
                  durationMs,
                  at: new Date().toISOString(),
                });
              }
            }
          },
        },
      },
    });
}
