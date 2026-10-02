-- One digest per (user, repo, kind, slot, revision).
--
-- `saveDigest` decided whether to insert by reading for an existing row and then
-- inserting. Two concurrent generations of the same briefing — a double click, a
-- retried request, two workers — both saw no row and both inserted, so the
-- dashboard rendered the same bullets twice and the "have I already shown you
-- this?" watermark counted rows it should not have.
--
-- Scope notes:
--
--   * `repoId IS NOT NULL` keeps the append-only catch-up briefings out of it.
--     Those rows deliberately accumulate per user per day with the same
--     revision and are ordered by `createdAt`; a slot-unique index over them
--     would drop every briefing after the first. `saveDigest` always passes a
--     repo, so this index covers exactly the rows that raced.
--
--   * Two indexes rather than one `NULLS NOT DISTINCT` index because a repo-level
--     briefing has no user (`userId` is nullable and is populated for per-user
--     digests only), and the nullable column is part of the key. A plain unique
--     index treats each NULL as distinct, which would leave the
--     `userId IS NULL` case unconstrained — exactly the rows a shared repo-level
--     digest produces. `NULLS NOT DISTINCT` would be tidier but needs
--     PostgreSQL 15+, and this schema still has to apply to older instances.
--
-- Duplicates are collapsed rather than aborting the migration. These rows are
-- derived content, regenerable from the same repository facts, and `readAt` is
-- carried over so collapsing cannot turn an already-read briefing back into an
-- unread one. The newest row is kept, which is the one the ordering in
-- `loadDigest` already prefers.

create temporary table insight_digest_dupes on commit drop as
select
  "id",
  row_number() over (
    partition by "userId", "repoId", "kind", "slot", "revision"
    order by "createdAt" desc, "id" desc
  ) as rank_in_group,
  min("readAt") over (
    partition by "userId", "repoId", "kind", "slot", "revision"
  ) as earliest_read
from "InsightDigest"
where "repoId" is not null
  and exists (
    select 1
    from "InsightDigest" other
    where other."repoId" is not distinct from "InsightDigest"."repoId"
      and other."userId" is not distinct from "InsightDigest"."userId"
      and other."kind" = "InsightDigest"."kind"
      and other."slot" = "InsightDigest"."slot"
      and other."revision" = "InsightDigest"."revision"
  );

-- A briefing that was read in any of the duplicate rows stays read.
update "InsightDigest" digest
set "readAt" = dupes.earliest_read
from insight_digest_dupes dupes
where dupes.rank_in_group = 1
  and dupes."id" = digest."id"
  and digest."readAt" is distinct from dupes.earliest_read;

delete from "InsightDigest" digest
using insight_digest_dupes dupes
where dupes.rank_in_group > 1
  and dupes."id" = digest."id";

drop table insight_digest_dupes;

create unique index if not exists insight_digest_user_slot_revision_key
  on "InsightDigest" ("userId", "repoId", "kind", "slot", "revision")
  where "repoId" is not null and "userId" is not null;

create unique index if not exists insight_digest_anon_slot_revision_key
  on "InsightDigest" ("repoId", "kind", "slot", "revision")
  where "repoId" is not null and "userId" is null;
