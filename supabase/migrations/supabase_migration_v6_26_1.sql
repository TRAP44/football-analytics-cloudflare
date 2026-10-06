-- MatchRadar v6.26.1 / Scheduled job lease least-privilege hardening
-- Follow-up to v6.26. The lease schema and RPC signatures are unchanged.
-- This migration only removes table privileges that are not required by the Worker.
--
-- HISTORICAL / FROZEN MIGRATION:
-- Keep this migration in the upgrade chain. The current Worker still needs
-- SELECT/INSERT/UPDATE/DELETE on scheduled_job_leases: lease RPCs mutate rows
-- and maintenance-runtime directly deletes expired lease records.
-- TRUNCATE, REFERENCES and TRIGGER remain intentionally absent from service_role;
-- anon/authenticated have no table access and no lease-RPC execution rights.
-- v6.27.1 later adds renew_scheduled_job() without broadening table privileges.
-- The complete schema contract v2 also fingerprints effective app-role grants.
-- Do not rewrite applied privilege history here; corrections belong in a new
-- forward migration.

revoke all privileges on table public.scheduled_job_leases
  from public, anon, authenticated;

revoke truncate, references, trigger
  on table public.scheduled_job_leases
  from service_role;

grant select, insert, update, delete
  on table public.scheduled_job_leases
  to service_role;

revoke execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.complete_scheduled_job(text,text)
  from public, anon, authenticated;
revoke execute on function public.release_scheduled_job(text,text)
  from public, anon, authenticated;

grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  to service_role;
grant execute on function public.complete_scheduled_job(text,text)
  to service_role;
grant execute on function public.release_scheduled_job(text,text)
  to service_role;

notify pgrst, 'reload schema';
