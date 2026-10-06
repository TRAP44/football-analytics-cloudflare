// Supabase schema probes, fingerprint checks and drift confirmation extracted from worker.js.
// Database, telemetry and release-contract primitives are injected by the composition root.
export function createSupabaseSchemaRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Supabase schema runtime dependencies are required.');
  }
  const {
    EXPECTED_SCHEMA_FINGERPRINT,
    PERSONAL_WRITE_LIMITS,
    bumpTelemetry,
    fetchWithTimeout,
    hasSupabase,
    readProviderIncidentAlertDeliveryContract,
    redactOpsString,
    sleepMs,
    supaHeaders,
    supaRpc,
  } = deps;

  async function probeOptionalTable(cfg, table) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
      url.searchParams.set('select', '*');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table} probe`);
      if (r.ok) return { ok: true, status: 'ok' };
      return { ok: false, status: `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: 'network_error', detail: redactOpsString(error?.message || error, 120) };
    }
  }
  
  
  async function probeTableColumns(cfg, table, columns = []) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
      url.searchParams.set('select', columns.join(','));
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase schema probe ${table}`);
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: 'network_error', detail: redactOpsString(error?.message || error, 120) };
    }
  }
  
  function summarizeSupabaseSchemaChecks(checks = []) {
    const normalized = (checks || []).map(item => ({
      id: String(item?.id || ''),
      table: String(item?.table || ''),
      columns: Array.isArray(item?.columns) ? item.columns.map(String) : [],
      ok: Boolean(item?.ok),
      status: String(item?.status || (item?.ok ? 'ok' : 'unknown')),
    }));
    const missing = normalized.filter(item => !item.ok).map(item => item.id);
    return {
      ok: missing.length === 0,
      status: missing.length === 0 ? 'ok' : 'drift',
      checked: normalized.length,
      missing,
      checks: normalized,
    };
  }
  
  async function readSupabaseSchemaFingerprint(cfg) {
    if (!hasSupabase(cfg)) return { ok:false, status:'not_configured', fingerprint:'', expected:EXPECTED_SCHEMA_FINGERPRINT };
    try {
      const raw=await supaRpc(cfg,'backend_schema_fingerprint',{},4000);
      const fingerprint=String(raw?.fingerprint || '');
      return {
        ok:Boolean(raw?.ok) && fingerprint===EXPECTED_SCHEMA_FINGERPRINT,
        status:fingerprint===EXPECTED_SCHEMA_FINGERPRINT ? 'ok' : 'fingerprint_mismatch',
        fingerprint,
        expected:EXPECTED_SCHEMA_FINGERPRINT,
        parts:Number(raw?.parts || 0),
        checkedAt:raw?.checked_at || null,
      };
    } catch (error) {
      return {ok:false,status:error?.code || 'error',fingerprint:'',expected:EXPECTED_SCHEMA_FINGERPRINT,detail:redactOpsString(error?.message || error,160)};
    }
  }
  
  async function readPersonalWriteGuardContract(cfg) {
    if (!hasSupabase(cfg)) return { ok:false, status:'not_configured' };
    try {
      const raw = await supaRpc(cfg, 'personal_write_guard_contract', {}, 3000);
      const version=String(raw?.version || '');
      const favoritesLimit=Number(raw?.favoritesLimit || 0);
      const favoritePlayersLimit=Number(raw?.favoritePlayersLimit || 0);
      const remindersLimit=Number(raw?.remindersLimit || 0);
      const canonicalReminders=raw?.canonicalReminders === true;
      const explicitRearm=raw?.explicitRearm === true;
      const reminderRetentionDays=Number(raw?.reminderRetentionDays || 0);
      const ok = Boolean(raw?.ok)
        && version === 'v2'
        && favoritesLimit === PERSONAL_WRITE_LIMITS.favorites
        && favoritePlayersLimit === PERSONAL_WRITE_LIMITS.favoritePlayers
        && remindersLimit === PERSONAL_WRITE_LIMITS.reminders
        && canonicalReminders
        && explicitRearm
        && reminderRetentionDays === 90;
      return {
        ok,
        status: ok ? 'ok' : 'contract_mismatch',
        version,
        favoritesLimit,
        favoritePlayersLimit,
        remindersLimit,
        canonicalReminders,
        explicitRearm,
        reminderRetentionDays,
      };
    } catch (error) {
      return { ok:false, status:error?.code || 'error', detail:redactOpsString(error?.message || error,160) };
    }
  }
  
  function schemaProbeStatusKind(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized || normalized === 'ok') return 'ok';
  
    const driftStatuses = new Set([
      'fingerprint_mismatch',
      'contract_mismatch',
      'http_400',
      'http_404',
      'pgrst202',
      '42883',
      '42703',
      '42p01',
    ]);
    if (driftStatuses.has(normalized)) return 'drift';
  
    if (
      normalized === 'not_configured'
      || normalized === 'network_error'
      || normalized === 'error'
      || normalized === 'timeout'
      || normalized === 'aborterror'
      || ['http_401','http_403','http_408','http_425','http_429'].includes(normalized)
      || /^http_5\d\d$/.test(normalized)
      || /timeout|network|temporar|unavailable|fetch|abort/.test(normalized)
    ) return 'unavailable';
  
    // Unknown probe failures must fail the release gate, but should not be
    // misreported as proven schema loss in production monitoring.
    return 'unavailable';
  }
  
  function classifySupabaseSchemaProbeFailures(checks = [], fingerprint = {}, personalWriteGuards = {}) {
    const failures = [];
    for (const item of checks || []) {
      if (!item?.ok) failures.push({ id: String(item?.id || 'schema_check'), status: String(item?.status || 'error') });
    }
    if (!fingerprint?.ok) failures.push({ id: 'schema_fingerprint', status: String(fingerprint?.status || 'error') });
    if (!personalWriteGuards?.ok) failures.push({ id: 'personal_write_guards', status: String(personalWriteGuards?.status || 'error') });
  
    const drift = [];
    const unavailable = [];
    for (const failure of failures) {
      if (schemaProbeStatusKind(failure.status) === 'drift') drift.push(failure.id);
      else unavailable.push(failure.id);
    }
  
    const uniqueDrift = [...new Set(drift)];
    const uniqueUnavailable = [...new Set(unavailable)];
    const failed = [...new Set(failures.map(item => item.id))];
    const failureMode = uniqueDrift.length && uniqueUnavailable.length
      ? 'mixed'
      : uniqueDrift.length
        ? 'drift'
        : uniqueUnavailable.length
          ? 'unavailable'
          : 'ok';
  
    return { failureMode, drift: uniqueDrift, unavailable: uniqueUnavailable, failed };
  }
  
  async function probeSupabaseSchemaDrift(cfg) {
    const specs = [
      { id: 'users_acquisition', table: 'users', columns: ['telegram_id','acquisition_source','acquisition_campaign','acquisition_content'] },
      { id: 'analysis_history_ai', table: 'analysis_history', columns: ['telegram_id','fixture_id','ai_signal_code','analysis_version'] },
      { id: 'favorite_players', table: 'favorite_players', columns: ['telegram_id','player_id','player_name','team_id','created_at'] },
      { id: 'smart_notification_preferences', table: 'user_preferences', columns: ['telegram_id','notification_preferences','updated_at'] },
      { id: 'smart_notification_deliveries', table: 'smart_notification_deliveries', columns: ['telegram_id','fixture_id','event_type','category','dedupe_key','status','attempts','claimed_at','sent_at','retry_at'] },
      { id: 'user_entitlements', table: 'user_entitlements', columns: ['id','telegram_id','entitlement_type','fixture_id','starts_at','expires_at','usage_limit','usage_count','payment_charge_id','status'] },
      { id: 'calibration_transitions', table: 'model_calibration_transitions', columns: ['id','action','resulting_revision','created_at'] },
      { id: 'digest_subscriptions', table: 'bot_digest_subscriptions', columns: ['telegram_id','enabled','hour_utc','delivery_claim_date','delivery_locked_until'] },
      { id: 'referee_history', table: 'referee_match_history', columns: ['fixture_id','referee_key','yellow_cards'] },
      { id: 'growth_events', table: 'growth_events', columns: ['id','event_name','metadata','created_at'] },
      { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['update_key','status','locked_until','expires_at','duplicate_count','last_duplicate_at'] },
      { id: 'provider_rate_windows', table: 'provider_rate_windows', columns: ['bucket_key','window_started_at','request_count','updated_at'] },
      { id: 'scheduled_job_leases', table: 'scheduled_job_leases', columns: ['job_key','group_key','status','lease_token','scheduled_at','claimed_at','locked_until','completed_at','expires_at'] },
      { id: 'cache_provenance', table: 'analysis_cache', columns: ['cache_key','provider','source_updated_at','freshness_status','updated_at'] },
      { id: 'odds_provenance', table: 'odds_snapshots', columns: ['fixture_id','provider','bookmaker_count','source_updated_at'] },
      { id: 'model_provenance', table: 'model_predictions', columns: ['fixture_id','data_provenance','model_inputs_version'] },
      { id: 'ai_timeline_snapshots', table: 'analysis_timeline_snapshots', columns: ['snapshot_key','fixture_id','captured_at','home_prob','draw_prob','away_prob','causal_relation','provenance'] },
      { id:'provider_incident_alert_delivery', table:'provider_incident_alert_deliveries', columns:['incident_id','transition','alert_key','destination_key','status','attempts','retry_at','unknown_at'] },
    ];
    const [tableChecks,fingerprint,personalWriteGuards,providerIncidentAlertDeliveryContract] = await Promise.all([
      Promise.all(specs.map(async spec => ({ ...spec, ...(await probeTableColumns(cfg, spec.table, spec.columns)) }))),
      readSupabaseSchemaFingerprint(cfg),
      readPersonalWriteGuardContract(cfg),
      readProviderIncidentAlertDeliveryContract(cfg),
    ]);
    const checks=[
      ...tableChecks,
      {
        id:'provider_incident_alert_delivery_contract',
        table:'rpc',
        columns:[],
        ok:Boolean(providerIncidentAlertDeliveryContract.ok),
        status:String(providerIncidentAlertDeliveryContract.status || 'error'),
      },
    ];
    const summary=summarizeSupabaseSchemaChecks(checks);
    // Preserve the historical fail-closed dependency list for release-contract
    // regression tests while exposing a more precise drift/unavailable split.
    const missing=[...(summary.missing || [])];
    if (!fingerprint.ok) missing.push('schema_fingerprint');
    if (!personalWriteGuards.ok) missing.push('personal_write_guards');
    const classification=classifySupabaseSchemaProbeFailures(checks,fingerprint,personalWriteGuards);
    const ok = Boolean(summary.ok && fingerprint.ok && personalWriteGuards.ok);
    return {
      ...summary,
      ok,
      status:ok ? 'ok' : classification.failureMode,
      failureMode:ok ? 'ok' : classification.failureMode,
      missing:classification.drift,
      unavailable:classification.unavailable,
      failed:[...new Set(missing)],
      fingerprint,
      personalWriteGuards,
      providerIncidentAlertDeliveryContract,
    };
  }
  
  
  function combineSupabaseSchemaProbeAttempts(first = {}, second = null) {
    const firstOk = Boolean(first?.ok);
    const initialMissing = Array.isArray(first?.missing) ? first.missing.map(String) : [];
    const initialUnavailable = Array.isArray(first?.unavailable) ? first.unavailable.map(String) : [];
    const initialFailureMode = String(first?.failureMode || first?.status || (firstOk ? 'ok' : 'unavailable'));
    if (firstOk) {
      return {
        ...first,
        attempts: 1,
        recovered: false,
        confirmedFailure: false,
        initialMissing,
        initialUnavailable,
        initialFailureMode,
      };
    }
  
    if (second && second.ok) {
      return {
        ...second,
        attempts: 2,
        recovered: true,
        confirmedFailure: false,
        initialMissing,
        initialUnavailable,
        initialFailureMode,
      };
    }
  
    const final = second || first;
    return {
      ...final,
      attempts: second ? 2 : 1,
      recovered: false,
      confirmedFailure: true,
      initialMissing,
      initialUnavailable,
      initialFailureMode,
    };
  }
  
  async function probeSupabaseSchemaDriftConfirmed(cfg, options = {}) {
    const first = await probeSupabaseSchemaDrift(cfg);
    if (first.ok || !hasSupabase(cfg)) return combineSupabaseSchemaProbeAttempts(first);
  
    const retryDelayMs = Math.max(0, Math.min(1500, Number(options.retryDelayMs ?? 250)));
    if (retryDelayMs) await sleepMs(retryDelayMs);
  
    const second = await probeSupabaseSchemaDrift(cfg);
    const combined = combineSupabaseSchemaProbeAttempts(first, second);
    if (combined.recovered) bumpTelemetry('supabaseSchemaProbeRecoveries');
    if (combined.confirmedFailure) bumpTelemetry('supabaseSchemaProbeConfirmedFailures');
    return combined;
  }
  
  function supabaseSchemaProbeConfirmationSelfTest() {
    const direct = combineSupabaseSchemaProbeAttempts({
      ok: true, status: 'ok', checked: 7, missing: [],
    });
    const recovered = combineSupabaseSchemaProbeAttempts(
      { ok: false, status: 'drift', checked: 7, missing: ['growth_events'] },
      { ok: true, status: 'ok', checked: 7, missing: [] }
    );
    const confirmed = combineSupabaseSchemaProbeAttempts(
      { ok: false, status: 'drift', failureMode: 'drift', checked: 7, missing: ['growth_events'], unavailable: [] },
      { ok: false, status: 'drift', failureMode: 'drift', checked: 7, missing: ['growth_events'], unavailable: [] }
    );
    const unavailable = combineSupabaseSchemaProbeAttempts(
      { ok: false, status: 'unavailable', failureMode: 'unavailable', checked: 7, missing: [], unavailable: ['growth_events'] },
      { ok: false, status: 'unavailable', failureMode: 'unavailable', checked: 7, missing: [], unavailable: ['growth_events'] }
    );
    return {
      pass: direct.ok && direct.attempts === 1
        && recovered.ok && recovered.attempts === 2 && recovered.recovered && !recovered.confirmedFailure
        && !confirmed.ok && confirmed.attempts === 2 && confirmed.confirmedFailure && confirmed.failureMode === 'drift'
        && !unavailable.ok && unavailable.confirmedFailure && unavailable.failureMode === 'unavailable',
      direct: direct.ok,
      recovered: recovered.recovered,
      confirmedFailure: confirmed.confirmedFailure,
      unavailableFailure: unavailable.failureMode,
    };
  }
  
  function supabaseSchemaDriftSelfTest() {
    const healthy = summarizeSupabaseSchemaChecks([
      { id: 'users_acquisition', table: 'users', columns: ['acquisition_source'], ok: true, status: 'ok' },
      { id: 'growth_events', table: 'growth_events', columns: ['event_name'], ok: true, status: 'ok' },
      { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['status'], ok: true, status: 'ok' },
    ]);
    const drift = summarizeSupabaseSchemaChecks([
      { id: 'users_acquisition', table: 'users', columns: ['acquisition_source'], ok: true, status: 'ok' },
      { id: 'growth_events', table: 'growth_events', columns: ['event_name'], ok: true, status: 'ok' },
      { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['status'], ok: false, status: 'http_400' },
    ]);
    return {
      pass: healthy.ok && !drift.ok && drift.status === 'drift' && drift.missing.length === 1 && drift.missing[0] === 'telegram_update_claims',
      healthy: healthy.ok,
      missing: drift.missing,
    };
  }

  return {
    probeOptionalTable,
    probeTableColumns,
    summarizeSupabaseSchemaChecks,
    readSupabaseSchemaFingerprint,
    readPersonalWriteGuardContract,
    schemaProbeStatusKind,
    classifySupabaseSchemaProbeFailures,
    probeSupabaseSchemaDrift,
    combineSupabaseSchemaProbeAttempts,
    probeSupabaseSchemaDriftConfirmed,
    supabaseSchemaProbeConfirmationSelfTest,
    supabaseSchemaDriftSelfTest,
  };
}
