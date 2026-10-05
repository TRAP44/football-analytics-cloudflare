-- MatchRadar v6.29.1 / runtime-control schema convergence (#478)
-- Idempotent hotfix that restores the canonical public DB contract after the
-- atomic-history rollout, while keeping lockdown audit intent in snapshot metadata.

-- Remove the alternate DB-first RPC so the public function contract returns to
-- the repository-defined canonical surface.
drop function if exists public.commit_runtime_controls(
  integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,
  text,bigint,text,text,text,integer
);

-- Restore the canonical persisted action contract. Lockdown intent is carried
-- separately in snapshot.requestedAction so history remains compatible.
alter table public.runtime_control_history
  drop constraint if exists runtime_control_history_action_check;

alter table public.runtime_control_history
  add constraint runtime_control_history_action_check
  check (action in ('baseline','update','defaults','rollback'));

drop rule if exists runtime_controls_atomic_history on public.runtime_controls;

create rule runtime_controls_atomic_history as
on update to public.runtime_controls
where old.revision is distinct from new.revision
do also
  insert into public.runtime_control_history (
    revision,
    action,
    reason,
    snapshot,
    app_version,
    changed_by,
    source_revision,
    created_at
  )
  values (
    new.revision,
    case
      when (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-action'
      ) in ('defaults','rollback')
      then left(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-action',
        40
      )
      else 'update'
    end,
    case
      when coalesce(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-reason-hex',
        ''
      ) ~ '^([0-9a-fA-F]{2})*$'
      then left(
        convert_from(
          decode(
            coalesce(
              coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
                ->> 'x-runtime-reason-hex',
              ''
            ),
            'hex'
          ),
          'UTF8'
        ),
        240
      )
      else ''
    end,
    jsonb_build_object(
      'maintenanceMode', new.maintenance_mode,
      'analysisEnabled', new.analysis_enabled,
      'searchEnabled', new.search_enabled,
      'liveEnabled', new.live_enabled,
      'remindersEnabled', new.reminders_enabled,
      'expandedDataEnabled', new.expanded_data_enabled,
      'autoSettlementRecoveryEnabled', new.auto_settlement_recovery_enabled,
      'securityLockdown',
        new.maintenance_mode
        and not new.analysis_enabled
        and not new.search_enabled
        and not new.live_enabled
        and not new.reminders_enabled
        and not new.expanded_data_enabled
        and not new.auto_settlement_recovery_enabled,
      'requestedAction',
        case
          when (
            coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
              ->> 'x-runtime-action'
          ) in ('update','defaults','rollback','lockdown','lockdown_release')
          then left(
            coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
              ->> 'x-runtime-action',
            40
          )
          else 'update'
        end,
      'message', new.message,
      'revision', new.revision,
      'updatedAt', new.updated_at
    ),
    left(
      coalesce(
        nullif(
          coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
            ->> 'x-runtime-app-version',
          ''
        ),
        'database'
      ),
      120
    ),
    new.updated_by,
    case
      when coalesce(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision',
        ''
      ) ~ '^[0-9]{1,10}$'
      and (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision'
      )::bigint <= 2147483647
      then (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision'
      )::integer
      else null
    end,
    coalesce(new.updated_at, now())
  );

comment on rule runtime_controls_atomic_history on public.runtime_controls is
  'Atomically appends runtime-control history; lockdown intent is stored in snapshot.requestedAction while action remains constraint-compatible.';

create or replace function public.backend_readiness_contract_v2(
  p_expected_fingerprint text,
  p_auth_window_minutes integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_legacy_fingerprint jsonb;
  v_legacy jsonb;
  v_contract jsonb;
  v_contract_ok boolean := false;
  v_schema_ok boolean := false;
  v_failure_reasons jsonb := '[]'::jsonb;
  v_auth_window integer := greatest(1, least(coalesce(p_auth_window_minutes, 5), 60));
begin
  -- Reuse all existing readiness/security/auth checks while deliberately
  -- satisfying only the historical v1 fingerprint with its current value.
  -- This keeps v1 backward compatible and moves the new release gate to v2.
  select public.backend_schema_fingerprint() into v_legacy_fingerprint;

  select public.backend_readiness_contract(
    coalesce(v_legacy_fingerprint->>'fingerprint', ''),
    v_auth_window
  )
  into v_legacy;

  select public.backend_schema_contract_v2() into v_contract;

  v_contract_ok :=
    coalesce((v_contract->>'ok')::boolean, false)
    and coalesce((v_contract->>'version')::integer, 0) = 2
    and length(btrim(coalesce(p_expected_fingerprint, ''))) > 0
    and coalesce(v_contract->>'fingerprint', '') = coalesce(p_expected_fingerprint, '');

  v_schema_ok :=
    coalesce((v_legacy->'schema'->>'ok')::boolean, false)
    and v_contract_ok;

  v_failure_reasons := coalesce(v_legacy->'failureReasons', '[]'::jsonb);
  if not v_contract_ok then
    v_failure_reasons := v_failure_reasons || jsonb_build_array('schema_contract_v2');
  end if;

  return v_legacy || jsonb_build_object(
    'ok', coalesce((v_legacy->>'ok')::boolean, false) and v_contract_ok,
    'status',
      case
        when coalesce((v_legacy->>'ok')::boolean, false) and v_contract_ok
          then 'ok'
        else 'not_ready'
      end,
    'schemaContractVersion', 2,
    'schema',
      coalesce(v_legacy->'schema', '{}'::jsonb)
      || jsonb_build_object(
        'ok', v_schema_ok,
        'status', case when v_schema_ok then 'ok' else 'drift' end,
        'contractVersion', 2,
        'fingerprint', jsonb_build_object(
          'ok', v_contract_ok,
          'status', case when v_contract_ok then 'ok' else 'fingerprint_mismatch' end,
          'fingerprint', coalesce(v_contract->>'fingerprint', ''),
          'expected', coalesce(p_expected_fingerprint, ''),
          'parts', coalesce((v_contract->>'parts')::integer, 0),
          'checkedAt', v_contract->'checkedAt'
        ),
        'versionedContract', v_contract
      ),
    'failureReasons', v_failure_reasons
  );
end;
$$;

revoke all on function public.backend_readiness_contract_v2(text,integer)
  from public, anon, authenticated;
grant execute on function public.backend_readiness_contract_v2(text,integer)
  to service_role;

comment on function public.backend_readiness_contract_v2(text,integer) is
  'Service-role-only readiness contract for DB contract version 2. Preserves legacy checks but gates the release on the complete v2 fingerprint.';

notify pgrst, 'reload schema';
