-- CreateTable
CREATE TABLE "RepositoryInsight" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "description" TEXT,
    "homepage" TEXT,
    "topics" TEXT NOT NULL DEFAULT '[]',
    "languages" TEXT NOT NULL DEFAULT '[]',
    "hasReadme" BOOLEAN NOT NULL DEFAULT false,
    "hasCodeowners" BOOLEAN NOT NULL DEFAULT false,
    "hasContributing" BOOLEAN NOT NULL DEFAULT false,
    "hasCiWorkflows" BOOLEAN NOT NULL DEFAULT false,
    "hasSecurityPolicy" BOOLEAN NOT NULL DEFAULT false,
    "hasLicense" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT,
    "openPullRequests" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "mergedLast30Days" INTEGER NOT NULL DEFAULT 0,
    "contributorCount" INTEGER NOT NULL DEFAULT 0,
    "topContributors" TEXT NOT NULL DEFAULT '[]',
    "lastReleaseTag" TEXT,
    "lastReleaseAt" TIMESTAMP(3),
    "structure" TEXT NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoEvidence" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT,
    "ref" TEXT,
    "excerpt" TEXT,
    "url" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 100,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkContext" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "insightId" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pr',
    "targetUrl" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "restoredFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "repoId" TEXT,
    "insightId" TEXT,
    "kind" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '[]',
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsightDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryInsight_repoId_key" ON "RepositoryInsight"("repoId");

-- CreateIndex
CREATE INDEX "RepositoryInsight_collectedAt_idx" ON "RepositoryInsight"("collectedAt");

-- CreateIndex
CREATE INDEX "RepoEvidence_repoId_kind_idx" ON "RepoEvidence"("repoId", "kind");

-- CreateIndex
CREATE INDEX "RepoEvidence_insightId_rank_idx" ON "RepoEvidence"("insightId", "rank");

-- CreateIndex
CREATE INDEX "RepoEvidence_observedAt_idx" ON "RepoEvidence"("observedAt");

-- CreateIndex
CREATE INDEX "WorkContext_userId_lastUsedAt_idx" ON "WorkContext"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "WorkContext_repoId_idx" ON "WorkContext"("repoId");

-- CreateIndex
CREATE INDEX "InsightDigest_userId_kind_slot_idx" ON "InsightDigest"("userId", "kind", "slot");

-- CreateIndex
CREATE INDEX "InsightDigest_repoId_kind_idx" ON "InsightDigest"("repoId", "kind");

-- CreateIndex
CREATE INDEX "InsightQuestion_insightId_createdAt_idx" ON "InsightQuestion"("insightId", "createdAt");

-- CreateIndex
CREATE INDEX "InsightQuestion_userId_createdAt_idx" ON "InsightQuestion"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepositoryInsight" ADD CONSTRAINT "RepositoryInsight_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoEvidence" ADD CONSTRAINT "RepoEvidence_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "RepositoryInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkContext" ADD CONSTRAINT "WorkContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkContext" ADD CONSTRAINT "WorkContext_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkContext" ADD CONSTRAINT "WorkContext_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "RepositoryInsight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightDigest" ADD CONSTRAINT "InsightDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightDigest" ADD CONSTRAINT "InsightDigest_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "RepositoryInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightQuestion" ADD CONSTRAINT "InsightQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightQuestion" ADD CONSTRAINT "InsightQuestion_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "RepositoryInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

