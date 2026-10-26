-- Run only inside an outer transaction on a disposable database. The caller
-- installs the reviewed rollout first and rolls back schema AND data afterward.
do $owner_boundary$
begin
  begin
    perform public.commit_runtime_controls_v2(1,'{}'::jsonb,'update','','ci',900000000440,null);
    raise exception 'RPC allowed non-service owner';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)','execute')
    or has_function_privilege('authenticated','public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)','execute') then
    raise exception 'RPC publicly executable';
  end if;
end $owner_boundary$;
set local role service_role;
do $runtime_proof$
declare
  original public.runtime_controls%rowtype;
  before_call public.runtime_controls%rowtype;
  result public.runtime_controls%rowtype;
  payload jsonb;
  variant jsonb;
  locked_payload jsonb;
  released_payload jsonb;
  saved_snapshot jsonb;
  field text;
  current_revision integer;
  count_rows integer;
  history_count integer;
begin
  select * into strict original from public.runtime_controls where id='global';
  payload := jsonb_build_object('maintenance_mode',original.maintenance_mode,'analysis_enabled',original.analysis_enabled,
    'search_enabled',original.search_enabled,'live_enabled',original.live_enabled,'reminders_enabled',original.reminders_enabled,
    'expanded_data_enabled',original.expanded_data_enabled,'auto_settlement_recovery_enabled',original.auto_settlement_recovery_enabled,
    'ai_enabled',original.ai_enabled,'message',original.message);
  select count(*) into history_count from public.runtime_control_history;
  for variant in select value from jsonb_array_elements(jsonb_build_array(
    payload || '{"analysis_enabled":"false"}'::jsonb,payload || '{"live_enabled":0}'::jsonb,
    payload-'reminders_enabled',payload || '{"unexpected":true}'::jsonb,'[]'::jsonb,'null'::jsonb)) loop
    begin
      perform public.commit_runtime_controls_v2(original.revision,variant,'update','typed input','ci',900000000440,null);
      raise exception 'RPC accepted malformed control vector';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.commit_runtime_controls_v2(original.revision,payload,'update','','ci',0,null);
    raise exception 'RPC accepted unattributed mutation';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.runtime_control_history)<>history_count then raise exception 'Rejected RPC changed history'; end if;

  with pgrst_source as (select * from public.commit_runtime_controls_v2(original.revision,payload,'update','Проверка транзакции','ci',900000000440,null))
    select * into strict result from pgrst_source;
  current_revision := result.revision;
  if current_revision<>original.revision+1 or result.updated_by<>900000000440 then raise exception 'RPC commit identity mismatch'; end if;
  if not exists(select 1 from public.runtime_control_history where revision=current_revision and reason='Проверка транзакции'
    and changed_by=900000000440 and snapshot->>'requestedAction'='update') then raise exception 'RPC missing audited commit'; end if;
  select count(*) into count_rows from public.commit_runtime_controls_v2(original.revision,payload,'update','duplicate','ci',900000000440,null);
  if count_rows<>0 or (select revision from public.runtime_controls where id='global')<>current_revision then raise exception 'Stale RPC committed twice'; end if;

  -- Every public switch is actually persisted and then restored on this local DB.
  foreach field in array array['maintenance_mode','analysis_enabled','search_enabled','live_enabled','reminders_enabled','expanded_data_enabled','auto_settlement_recovery_enabled','ai_enabled'] loop
    variant := jsonb_set(payload,array[field],to_jsonb(not (payload->>field)::boolean));
    select * into strict result from public.commit_runtime_controls_v2(current_revision,variant,'update','switch off/on','ci',900000000440,null);
    if to_jsonb(result)->field is distinct from variant->field then raise exception 'RPC did not persist switch %',field; end if;
    current_revision := result.revision;
    select * into strict result from public.commit_runtime_controls_v2(current_revision,payload,'update','restore switch','ci',900000000440,null);
    current_revision := result.revision;
  end loop;

  -- Match the app's older history semantics: an absent AI flag means true.
  if original.ai_enabled then update public.runtime_control_history set snapshot=snapshot-'aiEnabled' where revision=original.revision; end if;
  select * into strict result from public.commit_runtime_controls_v2(current_revision,payload,'rollback','Откат по истории','ci',900000000440,original.revision);
  current_revision := result.revision;
  if not exists(select 1 from public.runtime_control_history where revision=current_revision and action='rollback' and source_revision=original.revision) then raise exception 'RPC lost rollback lineage'; end if;
  begin
    perform public.commit_runtime_controls_v2(current_revision,payload || '{"search_enabled":false}'::jsonb,'rollback','wrong source payload','ci',900000000440,original.revision);
    raise exception 'RPC accepted forged rollback snapshot';
  exception when invalid_parameter_value then null; end;

  -- Legacy JSON null has the same default as a missing optional AI/message.
  if original.ai_enabled and original.message='' then
    for variant in select value from jsonb_array_elements('[{}, {"aiEnabled":null,"message":null}]'::jsonb) loop
      update public.runtime_control_history set snapshot=(snapshot-'aiEnabled'-'message') || variant where revision=original.revision;
      select * into strict result from public.commit_runtime_controls_v2(current_revision,payload,'rollback','legacy null/missing','ci',900000000440,original.revision);
      current_revision := result.revision;
      -- Exercise matching the CURRENT baseline, too, not only the rollback source.
      update public.runtime_control_history set snapshot=(snapshot-'aiEnabled'-'message') || variant where revision=current_revision;
      select * into strict result from public.commit_runtime_controls_v2(current_revision,payload,'update','legacy baseline','ci',900000000440,null);
      current_revision := result.revision;
    end loop;
  end if;

  locked_payload := '{"maintenance_mode":true,"analysis_enabled":false,"search_enabled":false,"live_enabled":false,"reminders_enabled":false,"expanded_data_enabled":false,"auto_settlement_recovery_enabled":false,"ai_enabled":false,"message":"ci lockdown"}'::jsonb;
  released_payload := '{"maintenance_mode":false,"analysis_enabled":true,"search_enabled":true,"live_enabled":true,"reminders_enabled":true,"expanded_data_enabled":true,"auto_settlement_recovery_enabled":false,"ai_enabled":true,"message":""}'::jsonb;
  select * into strict result from public.commit_runtime_controls_v2(current_revision,locked_payload,'lockdown','test lockdown','ci',900000000440,null);
  current_revision := result.revision;
  if not result.maintenance_mode or result.analysis_enabled or result.ai_enabled then raise exception 'RPC failed to activate lockdown'; end if;
  begin
    perform public.commit_runtime_controls_v2(current_revision,released_payload,'update','implicit release','ci',900000000440,null);
    raise exception 'RPC implicitly released lockdown';
  exception when invalid_parameter_value then null; end;
  select * into strict result from public.commit_runtime_controls_v2(current_revision,released_payload,'lockdown_release','test recovery','ci',900000000440,null);
  current_revision := result.revision;
  if result.maintenance_mode or not result.ai_enabled then raise exception 'RPC failed explicit lockdown release'; end if;
  if not exists(select 1 from public.runtime_control_history where revision=current_revision and action='update' and snapshot->>'requestedAction'='lockdown_release') then raise exception 'RPC lost lockdown history intent'; end if;

  -- Corrupt current baseline cannot be used as a trusted rollback point.
  select snapshot into saved_snapshot from public.runtime_control_history where revision=current_revision;
  update public.runtime_control_history set snapshot=snapshot || '{"searchEnabled":false}'::jsonb where revision=current_revision;
  begin
    perform public.commit_runtime_controls_v2(current_revision,released_payload,'update','bad baseline','ci',900000000440,null);
    raise exception 'RPC accepted corrupt baseline';
  exception when check_violation then null; end;
  update public.runtime_control_history set snapshot=saved_snapshot where revision=current_revision;

  -- A genuine audit INSERT failure rolls back the UPDATE, not just the response.
  select * into strict before_call from public.runtime_controls where id='global';
  insert into public.runtime_control_history(revision,action,reason,snapshot,app_version)
    values(current_revision+1,'baseline','ci injected unique conflict','{}'::jsonb,'ci');
  begin
    perform public.commit_runtime_controls_v2(current_revision,released_payload || '{"search_enabled":false}'::jsonb,'update','must roll back','ci',900000000440,null);
    raise exception 'RPC ignored failing history INSERT';
  exception when unique_violation then null; end;
  select * into strict result from public.runtime_controls where id='global';
  if to_jsonb(result) is distinct from to_jsonb(before_call) then raise exception 'Audit failure left modified runtime controls'; end if;
  delete from public.runtime_control_history where revision=current_revision+1;
end $runtime_proof$;
reset role;
