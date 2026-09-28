-- Clear the personal owner stamp from Organization-type installations.
--
-- `AppInstallation.userId` means "this installation belongs to one person". An
-- Organization installation is shared by every admin of that GitHub
-- organization, so a personal stamp on one is always wrong.
--
-- Rows in this state were written by a bug that ran an unconditional
-- `updateMany({ data: { userId } })` over every installation a user administers:
-- for an Organization account the last admin to sign in took the stamp, and the
-- previous admin silently lost visibility of their own organization's
-- repositories. The write path is fixed in code (claimUnownedInstallations only
-- claims unowned User-type installations), but rows written while the bug was
-- live still carry the wrong value.
--
-- Clearing it is the correct end state rather than a loss of access: visibility
-- for a shared installation comes from Baton organization or team membership,
-- which is what `myInstallations` uses. An installation that is a member of
-- neither organization nor team becomes invisible, which is the honest outcome
-- for a shared resource that nobody has claimed.
--
-- Idempotent: a no-op once no such rows remain. `accountType` is compared
-- case-insensitively because GitHub has used both 'Organization' and
-- 'organization' across API versions.
UPDATE "AppInstallation"
SET "userId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "userId" IS NOT NULL
  AND LOWER("accountType") = 'organization';
