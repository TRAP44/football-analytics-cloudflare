-- MatchRadar v6.29 / atomic runtime controls + immutable history (#466)
-- Runtime-control state and audit history must share one PostgreSQL commit point.
-- The RPC is service-role only and keeps optimistic revision checks inside the transaction.

alter table public.runtime_control_history
  drop constraint if exists runtime_control_history_action_check;

alter table public.runtime_control_history
  add constraint runtime_control_history_action_check
  check (action in ('baseline','update','defaults','rollback','lockdown','lockdown_release'));

create or replace function public.commit_runtime_controls(
  p_expected_revision integer,
  p_maintenance_mode boolean,
  p_analysis_enabled boolean,
  p_search_enabled boolean,
  p_live_enabled boolean,
  p_reminders_enabled boolean,
  p_expanded_data_enabled boolean,
  p_auto_settlement_recovery_enabled boolean,
  p_message text,
  p_updated_by bigint,
  p_action text,
  p_reason text,
  p_app_version text,
  p_source_revision integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_current public.runtime_controls%rowtype;
  v_next public.runtime_controls%rowtype;
  v_now timestamptz := now();
  v_action text := lower(btrim(coalesce(p_action,'update')));
  v_reason text := left(btrim(coalesce(p_reason,'')),240);
  v_snapshot jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    return jsonb_build_object('ok',false,'reason','invalid_expected_revision');
  end if;

  if v_action not in ('update','defaults','rollback','lockdown','lockdown_release') then
    v_action := 'update';
  end if;

  select *
  into v_current
  from public.runtime_controls
  where id='global'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','runtime_controls_missing');
  end if;

  if v_current.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok',false,
      'reason','revision_conflict',
      'current',to_jsonb(v_current)
    );
  end if;

  insert into public.runtime_control_history(
    revision,action,reason,snapshot,app_version,changed_by,source_revision,created_at
  )
  values (
    v_current.revision,
    'baseline',
    'Базовое состояние сохранено перед атомарным изменением настроек функций.',
    jsonb_build_object(
      'maintenanceMode',v_current.maintenance_mode,
      'analysisEnabled',v_current.analysis_enabled,
      'searchEnabled',v_current.search_enabled,
      'liveEnabled',v_current.live_enabled,
      'remindersEnabled',v_current.reminders_enabled,
      'expandedDataEnabled',v_current.expanded_data_enabled,
      'autoSettlementRecoveryEnabled',v_current.auto_settlement_recovery_enabled,
      'message',v_current.message,
      'revision',v_current.revision,
      'updatedAt',v_current.updated_at
    ),
    left(coalesce(p_app_version,''),80),
    v_current.updated_by,
    null,
    v_current.updated_at
  )
  on conflict (revision) do nothing;

  update public.runtime_controls
  set maintenance_mode = coalesce(p_maintenance_mode,false),
      analysis_enabled = coalesce(p_analysis_enabled,true),
      search_enabled = coalesce(p_search_enabled,true),
      live_enabled = coalesce(p_live_enabled,true),
      reminders_enabled = coalesce(p_reminders_enabled,true),
      expanded_data_enabled = coalesce(p_expanded_data_enabled,true),
      auto_settlement_recovery_enabled = coalesce(p_auto_settlement_recovery_enabled,false),
      message = left(coalesce(p_message,''),280),
      revision = p_expected_revision + 1,
      updated_at = v_now,
      updated_by = p_updated_by
  where id='global'
    and revision=p_expected_revision
  returning * into v_next;

  if not found then
    return jsonb_build_object(
      'ok',false,
      'reason','revision_conflict',
      'current',to_jsonb(v_current)
    );
  end if;

  v_snapshot := jsonb_build_object(
    'maintenanceMode',v_next.maintenance_mode,
    'analysisEnabled',v_next.analysis_enabled,
    'searchEnabled',v_next.search_enabled,
    'liveEnabled',v_next.live_enabled,
    'remindersEnabled',v_next.reminders_enabled,
    'expandedDataEnabled',v_next.expanded_data_enabled,
    'autoSettlementRecoveryEnabled',v_next.auto_settlement_recovery_enabled,
    'message',v_next.message,
    'revision',v_next.revision,
    'updatedAt',v_next.updated_at
  );

  insert into public.runtime_control_history(
    revision,action,reason,snapshot,app_version,changed_by,source_revision,created_at
  )
  values (
    v_next.revision,
    v_action,
    v_reason,
    v_snapshot,
    left(coalesce(p_app_version,''),80),
    p_updated_by,
    p_source_revision,
    v_now
  );

  return jsonb_build_object(
    'ok',true,
    'reason','committed',
    'row',to_jsonb(v_next),
    'historyRevision',v_next.revision
  );
end;
$$;

revoke all on function public.commit_runtime_controls(
  integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,bigint,text,text,text,integer
) from public, anon, authenticated;

grant execute on function public.commit_runtime_controls(
  integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,bigint,text,text,text,integer
) to service_role;

comment on function public.commit_runtime_controls(
  integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,bigint,text,text,text,integer
) is 'Service-role-only atomic compare-and-swap for runtime_controls plus immutable runtime_control_history revision.';

-- During the DB-first rollout the currently deployed Worker still supplies the
-- v6.28 production fingerprint. Accept that exact old->new transition only;
-- arbitrary schema drift remains fail-closed.
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
  v_actual_fingerprint text := '';
  v_expected text := btrim(coalesce(p_expected_fingerprint,''));
begin
  select public.backend_schema_fingerprint() into v_legacy_fingerprint;

  select public.backend_readiness_contract(
    coalesce(v_legacy_fingerprint->>'fingerprint', ''),
    v_auth_window
  )
  into v_legacy;

  select public.backend_schema_contract_v2() into v_contract;
  v_actual_fingerprint := coalesce(v_contract->>'fingerprint','');

  v_contract_ok :=
    coalesce((v_contract->>'ok')::boolean, false)
    and coalesce((v_contract->>'version')::integer, 0) = 2
    and length(v_expected) > 0
    and (
      v_actual_fingerprint = v_expected
      or (
        v_expected = '6a7f0fe444f49a2a52c4603e952ee9ea'
        and v_actual_fingerprint = '69a437fa853ee80fb0b1122c32d83848'
      )
    );

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
          'fingerprint', v_actual_fingerprint,
          'expected', v_expected,
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

notify pgrst, 'reload schema';
