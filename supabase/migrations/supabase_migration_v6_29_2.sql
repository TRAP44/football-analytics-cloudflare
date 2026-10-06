-- MatchRadar v6.29.2 / restore favorite-player personal write guard contract
-- Forward hotfix for the v6.25.2 personal_write_guard_contract() regression.
-- Restores the favoritePlayersLimit field required by the current Worker while
-- preserving the reminder canonicalization/rearm fields introduced in v6.25.2.
--
-- This replaces only the function body. The public function signature and
-- execution attributes are unchanged, so legacy and v2 schema fingerprints
-- remain stable.

create or replace function public.personal_write_guard_contract()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'version', 'v2',
    'favoritesLimit', 50,
    'favoritePlayersLimit', 50,
    'remindersLimit', 50,
    'canonicalReminders', true,
    'explicitRearm', true,
    'reminderRetentionDays', 90
  );
$$;

revoke all on function public.personal_write_guard_contract()
  from public, anon, authenticated;
grant execute on function public.personal_write_guard_contract()
  to service_role;

comment on function public.personal_write_guard_contract() is
  'v6.29.2 service-role-only personal-write contract restoring favoritePlayersLimit while preserving canonical reminder/rearm guarantees.';

notify pgrst, 'reload schema';
