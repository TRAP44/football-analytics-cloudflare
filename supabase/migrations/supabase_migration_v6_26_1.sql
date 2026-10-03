-- MatchRadar v6.26.1 / Scheduled job lease least-privilege hardening
-- Follow-up to v6.26. The lease schema and RPC signatures are unchanged.
-- This migration only removes table privileges that are not required by the Worker.

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
