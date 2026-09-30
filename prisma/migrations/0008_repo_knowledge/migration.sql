-- Repository knowledge memory (skill.md §15).
--
-- One table. Entries are keyed on (repoId, stableKey) where `stableKey` is
-- derived from the claim's content rather than from a timestamp, so re-observing
-- the same fact updates one row instead of appending a near-duplicate on every
-- scheduled sweep. `status`/`missingSince` back the grace period that stops a
-- single failed collection run from erasing what was learned.
--
-- No backfill: existing repositories have no knowledge rows yet, and the next
-- collection run populates them from the evidence already collected.
CREATE TABLE "RepoKnowledge" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'observed',
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "path" TEXT,
    "strength" INTEGER NOT NULL DEFAULT 50,
    "observations" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoKnowledge_pkey" PRIMARY KEY ("id")
);

-- The upsert path: one row per claim per repository.
CREATE UNIQUE INDEX "RepoKnowledge_repoId_stableKey_key" ON "RepoKnowledge"("repoId", "stableKey");

-- Listing the live knowledge for a repository, and filtering by category.
CREATE INDEX "RepoKnowledge_repoId_status_idx" ON "RepoKnowledge"("repoId", "status");
CREATE INDEX "RepoKnowledge_repoId_kind_status_idx" ON "RepoKnowledge"("repoId", "kind", "status");
CREATE INDEX "RepoKnowledge_insightId_idx" ON "RepoKnowledge"("insightId");

ALTER TABLE "RepoKnowledge" ADD CONSTRAINT "RepoKnowledge_repoId_fkey"
    FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepoKnowledge" ADD CONSTRAINT "RepoKnowledge_insightId_fkey"
    FOREIGN KEY ("insightId") REFERENCES "RepositoryInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;