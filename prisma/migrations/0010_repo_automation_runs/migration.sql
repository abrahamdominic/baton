-- Automated developer workflows (§8): persist the findings of the most recent
-- workflow run per repository.
--
-- Design notes
-- ------------
-- One row per repository, upserted on every run, rather than one row per
-- finding. A workflow's output is a pure function of persisted state, so the
-- previous run's findings are superseded in full; keeping them would leave
-- contradicted claims in the database ("waiting on @bob" long after the review
-- landed) with no way to tell them apart from current ones without a tombstone
-- on every row.
--
-- `runsJson` holds the serialized `WorkflowRun[]` so the exact findings a user
-- was shown can be reproduced later, including each finding's `basis` string.
-- That is what lets a later render keep FACT and INFERENCE visually distinct
-- without re-running anything.
--
-- `repoId` is UNIQUE, which is the storage-side guarantee that two concurrent
-- automation jobs for one repository cannot both insert; the upsert in
-- `processRepoAutomations` would otherwise race and one run's findings would be
-- silently lost. The unique index is also what makes the upsert atomic.
CREATE TABLE "RepoAutomationRun" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "runsJson" TEXT NOT NULL,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepoAutomationRun_repoId_key" ON "RepoAutomationRun"("repoId");

-- The admin automation-health view lists the least-recently-analysed
-- repositories, which is this index read in reverse.
CREATE INDEX "RepoAutomationRun_ranAt_idx" ON "RepoAutomationRun"("ranAt");

ALTER TABLE "RepoAutomationRun"
    ADD CONSTRAINT "RepoAutomationRun_repoId_fkey"
    FOREIGN KEY ("repoId") REFERENCES "Repo"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
