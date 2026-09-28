-- Add the account-level language preference.
--
-- Nullable with no default: existing users have not chosen a language, and
-- conflating that with "English" would suppress browser auto-detection for
-- every current account. Adding a nullable column is metadata-only in
-- PostgreSQL, so this does not rewrite the table or lock it against reads.
ALTER TABLE "User" ADD COLUMN "preferredLanguage" TEXT;
