-- AlterTable: account role + suspension (server-side admin controls).
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");