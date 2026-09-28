-- Make repository merge throughput explicitly unknown-able.
--
-- `mergedLast30Days` was NOT NULL DEFAULT 0, so the collector could not
-- distinguish "GitHub reported no merges in the last 30 days" from "the search
-- API failed, or does not index this private repository". Both landed in the
-- same column as 0, and the developer briefing rendered the failure case as a
-- red risk bullet: "No pull requests merged in the last 30 days."
--
-- Dropping NOT NULL lets the collector record the difference. The DEFAULT is
-- dropped too: the datamodel no longer declares one, so leaving it behind would
-- be schema drift that the next `migrate dev` tries to reconcile. Existing rows
-- keep their 0 values, which are genuine observations made before this change.
--
-- Sub-clause order is required by PostgreSQL: DROP DEFAULT precedes DROP NOT NULL.

ALTER TABLE "RepositoryInsight" ALTER COLUMN "mergedLast30Days" DROP DEFAULT;
ALTER TABLE "RepositoryInsight" ALTER COLUMN "mergedLast30Days" DROP NOT NULL;
