-- Queue durability: fencing tokens, leases, and a database-enforced dedupe.
--
-- Three defects are addressed here, all in the background job queue.
--
-- 1. RECLAIM NEVER COUNTED AN ATTEMPT. `recoverStaleJobs` reset a claimed-but-
--    unfinished row from `processing` back to `pending` without touching
--    `attempts`. A job that hard-kills its executor every time (OOM, a frozen
--    serverless instance, SIGKILL) was therefore reclaimed forever and could
--    never reach `maxAttempts`, so it could never be dead-lettered. The reclaim
--    now increments `attempts` in the same UPDATE and dead-letters once the
--    budget is spent, rather than requeueing an unrunnable row indefinitely.
--
-- 2. NO FENCE BETWEEN ATTEMPTS. `startedAt` was the only liveness signal, so a
--    job legitimately running past the stale threshold was reclaimed while its
--    original executor was still working, and the reclaiming executor would
--    write a terminal status over the top. `leaseToken` (minted per claim,
--    echoed on every terminal write) makes that write impossible, and
--    `leaseExpiresAt` gives the running executor something to refresh.
--
-- 3. ENQUEUE DEDUPE WAS CHECK-THEN-ACT. `enqueueJob` counted overlapping
--    pending rows and then inserted, with no constraint between the two, so two
--    concurrent identical webhook deliveries could both pass the count and both
--    insert. The dedupe is now enforced by a unique index over
--    (kind, dedupeKey). The key is cleared on every terminal transition, so the
--    index only constrains in-flight work and the same payload can be re-queued
--    once the previous run has finished. NULLs are distinct in PostgreSQL and
--    SQLite alike, which is what allows any number of finished rows to coexist.
--
-- All three columns are nullable and additive, so existing rows need no
-- backfill: a pre-existing pending row has dedupeKey NULL and is reclaimable as
-- before, and the very next enqueue of that payload inserts cleanly.
ALTER TABLE "Job" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "Job" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "Job" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- `enqueueJob` has always written 6 explicitly; the schema default said 5, so
-- any row created without an explicit value got a shorter budget than intended.
ALTER TABLE "Job" ALTER COLUMN "maxAttempts" SET DEFAULT 6;

CREATE UNIQUE INDEX "Job_kind_dedupeKey_key" ON "Job"("kind", "dedupeKey");

-- The reclaim sweep filters on (status, leaseExpiresAt); without this index it
-- degrades to a sequential scan of the whole table on every drain.
CREATE INDEX "Job_status_leaseExpiresAt_idx" ON "Job"("status", "leaseExpiresAt");
