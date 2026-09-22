-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInstallation" (
    "id" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repoId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoSetting" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "statusCommentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "labelsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nudgesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "firstResponseHours" INTEGER NOT NULL DEFAULT 24,
    "reviewFollowUpHours" INTEGER NOT NULL DEFAULT 36,
    "changesRequiredHours" INTEGER NOT NULL DEFAULT 72,
    "ciFailHours" INTEGER NOT NULL DEFAULT 24,
    "conflictHours" INTEGER NOT NULL DEFAULT 12,
    "readyToMergeHours" INTEGER NOT NULL DEFAULT 48,
    "maxNudgesPerState" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "ghNodeId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "githubState" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "mergeableState" TEXT,
    "reviewDecision" TEXT,
    "requestedReviewersJson" TEXT NOT NULL DEFAULT '[]',
    "labelsJson" TEXT NOT NULL DEFAULT '[]',
    "checksJson" TEXT NOT NULL DEFAULT '[]',
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "stateEnteredAt" TIMESTAMP(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nudgeBucketsJson" TEXT NOT NULL DEFAULT '[]',
    "statusCommentId" BIGINT,
    "firstResponseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "payloadJson" TEXT NOT NULL,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "repoId" TEXT,
    "prId" TEXT,
    "type" TEXT NOT NULL,
    "targetJson" TEXT,
    "ghReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "detailJson" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "User_login_idx" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstallation_installationId_key" ON "AppInstallation"("installationId");

-- CreateIndex
CREATE INDEX "AppInstallation_accountLogin_idx" ON "AppInstallation"("accountLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_repoId_key" ON "Repo"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_fullName_key" ON "Repo"("fullName");

-- CreateIndex
CREATE INDEX "Repo_installationId_idx" ON "Repo"("installationId");

-- CreateIndex
CREATE INDEX "Repo_owner_name_idx" ON "Repo"("owner", "name");

-- CreateIndex
CREATE INDEX "Repo_enabled_idx" ON "Repo"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "RepoSetting_repoId_key" ON "RepoSetting"("repoId");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_state_idx" ON "PullRequest"("repoId", "state");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_githubUpdatedAt_idx" ON "PullRequest"("repoId", "githubUpdatedAt");

-- CreateIndex
CREATE INDEX "PullRequest_stateEnteredAt_idx" ON "PullRequest"("stateEnteredAt");

-- CreateIndex
CREATE INDEX "PullRequest_githubState_idx" ON "PullRequest"("githubState");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repoId_number_key" ON "PullRequest"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_deliveryId_eventType_key" ON "WebhookEvent"("deliveryId", "eventType");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Action_repoId_createdAt_idx" ON "Action"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "Action_prId_idx" ON "Action"("prId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoSetting" ADD CONSTRAINT "RepoSetting_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

