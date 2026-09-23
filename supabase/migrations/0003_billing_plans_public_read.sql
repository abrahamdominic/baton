-- ============================================================================
-- Baton billing fix: the "public plans readable" RLS policy (0001) can only be
-- evaluated once the anon/authenticated roles hold SELECT on the table.
-- `revoke all ... from anon, authenticated` in 0001 stripped table privileges,
-- so the policy was unreachable and the public pricing surface 401'd. RLS
-- policies grant row-level access, not table privileges; restore the grant.
-- ============================================================================

grant select on public.plans to anon, authenticated;