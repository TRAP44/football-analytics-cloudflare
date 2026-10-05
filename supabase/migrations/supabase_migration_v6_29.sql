-- MatchRadar v6.29 / atomic runtime-control history (#466)
-- The UPDATE rule is part of the same PostgreSQL statement/transaction as the
-- runtime_controls mutation. If the immutable history insert fails, PostgreSQL
-- rolls the control update back as well.
--
-- The rule intentionally lives in pg_rewrite rather than adding a new public
-- RPC/function signature, so the established public schema-contract fingerprint
-- remains unchanged during this backward-compatible rollout.

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
      ) in ('update','defaults','rollback','lockdown','lockdown_release')
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
  'Atomically appends the immutable runtime-control revision in the same transaction as every revision-changing UPDATE.';

notify pgrst, 'reload schema';
