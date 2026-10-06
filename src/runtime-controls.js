import {
  failClosedRuntimeControls,
  isSecurityLockdownControls,
  runtimeLockdownDecision,
} from './runtime-lockdown.js';

const MAX_REVISION=2147483647;
const MAX_TIMESTAMP_MS=8.64e15;
const MAX_CACHE_MS=5*60_000;
const RUNTIME_ACTIONS=new Set(['update','defaults','rollback','lockdown','lockdown_release']);
const CONTROL_BOOLEAN_FIELDS=Object.freeze([
  'maintenanceMode',
  'analysisEnabled',
  'searchEnabled',
  'liveEnabled',
  'remindersEnabled',
  'expandedDataEnabled',
  'autoSettlementRecoveryEnabled',
]);

function required(name,value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveRevision(value,fallback=1) {
  const number=integerCandidate(value);
  return number !== null && number >= 1 && number <= MAX_REVISION ? number : fallback;
}

function positiveId(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function strictBoolean(value,fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanText(value,fallback='',maxLength=280) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function timestampString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw=value.trim();
  const timestamp=Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function safeClock(clock) {
  try {
    const value=clock();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

function safeCacheMs(value) {
  const number=integerCandidate(value);
  if (number === null || number < 1) return 30_000;
  return Math.min(MAX_CACHE_MS,number);
}

function strictSupabaseAvailable(hasSupabase,cfg) {
  try {
    return hasSupabase(cfg) === true;
  } catch {
    return false;
  }
}

function supabaseOrigin(cfg) {
  if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl.trim()) return '';
  try {
    const url=new URL(cfg.supabaseUrl.trim());
    return ['http:','https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function normalizeDefaults(defaults) {
  const source=plainObject(defaults);
  return {
    maintenanceMode:strictBoolean(source.maintenanceMode,false),
    analysisEnabled:strictBoolean(source.analysisEnabled,true),
    searchEnabled:strictBoolean(source.searchEnabled,true),
    liveEnabled:strictBoolean(source.liveEnabled,true),
    remindersEnabled:strictBoolean(source.remindersEnabled,true),
    expandedDataEnabled:strictBoolean(source.expandedDataEnabled,true),
    autoSettlementRecoveryEnabled:strictBoolean(source.autoSettlementRecoveryEnabled,false),
    message:cleanText(source.message,'',280),
    revision:positiveRevision(source.revision,1),
    updatedAt:timestampString(source.updatedAt),
  };
}

function controlInputValue(row,snake,camel) {
  const source=plainObject(row);
  if (Object.hasOwn(source,snake)) return source[snake];
  if (Object.hasOwn(source,camel)) return source[camel];
  return undefined;
}

function inspectRuntimeControls(row,defaults,{requireComplete=false}={}) {
  const source=plainObject(row);
  if (source !== row) return {valid:false,value:{...defaults}};
  let valid=true;

  const booleanField=(snake,camel,fallback)=>{
    const raw=controlInputValue(source,snake,camel);
    if (raw === undefined || raw === null) {
      if (requireComplete) valid=false;
      return fallback;
    }
    if (typeof raw !== 'boolean') {
      valid=false;
      return fallback;
    }
    return raw;
  };

  const rawRevision=controlInputValue(source,'revision','revision');
  const revision=rawRevision === undefined || rawRevision === null
    ? defaults.revision
    : positiveRevision(rawRevision,0);
  if ((requireComplete && (rawRevision === undefined || rawRevision === null)) || !revision) valid=false;

  const rawUpdatedAt=controlInputValue(source,'updated_at','updatedAt');
  const updatedAt=rawUpdatedAt === undefined || rawUpdatedAt === null || rawUpdatedAt === ''
    ? null
    : timestampString(rawUpdatedAt);
  if (rawUpdatedAt && !updatedAt) valid=false;

  const rawMessage=controlInputValue(source,'message','message');
  if (rawMessage !== undefined && rawMessage !== null && typeof rawMessage !== 'string') valid=false;

  return {
    valid,
    value:{
      maintenanceMode:booleanField('maintenance_mode','maintenanceMode',defaults.maintenanceMode),
      analysisEnabled:booleanField('analysis_enabled','analysisEnabled',defaults.analysisEnabled),
      searchEnabled:booleanField('search_enabled','searchEnabled',defaults.searchEnabled),
      liveEnabled:booleanField('live_enabled','liveEnabled',defaults.liveEnabled),
      remindersEnabled:booleanField('reminders_enabled','remindersEnabled',defaults.remindersEnabled),
      expandedDataEnabled:booleanField('expanded_data_enabled','expandedDataEnabled',defaults.expandedDataEnabled),
      autoSettlementRecoveryEnabled:booleanField(
        'auto_settlement_recovery_enabled',
        'autoSettlementRecoveryEnabled',
        defaults.autoSettlementRecoveryEnabled,
      ),
      message:cleanText(rawMessage,'',280),
      revision:revision || defaults.revision,
      updatedAt,
    },
  };
}

function validMutationControls(body) {
  const source=plainObject(body);
  return CONTROL_BOOLEAN_FIELDS.every(key=>typeof source[key] === 'boolean');
}

// Bounded runtime-controls domain extracted from worker.js.
// DB/network/clock/response dependencies are injected by the composition root.
export function createRuntimeControlsRuntime({
  memory,
  DEFAULT_RUNTIME_CONTROLS,
  RUNTIME_CONTROLS_CACHE_MS,
  SUPABASE_SCHEMA_GUIDANCE,
  APP_VERSION,
  hasSupabase,
  supaSelectOne,
  supaInsertIgnore,
  supaSelectMany,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
  json,
  isAdminUser,
  clock = () => Date.now(),
}) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  required('hasSupabase',hasSupabase);
  required('supaSelectOne',supaSelectOne);
  required('supaInsertIgnore',supaInsertIgnore);
  required('supaSelectMany',supaSelectMany);
  required('fetchWithTimeout',fetchWithTimeout);
  required('supaHeaders',supaHeaders);
  required('recordOpsEvent',recordOpsEvent);
  required('redactOpsString',redactOpsString);
  required('json',json);
  required('isAdminUser',isAdminUser);
  required('clock',clock);

  const defaults=normalizeDefaults(DEFAULT_RUNTIME_CONTROLS);
  const cacheMs=safeCacheMs(RUNTIME_CONTROLS_CACHE_MS);
  const appVersion=cleanText(APP_VERSION,'unknown',120);
  const schemaGuidance=cleanText(
    SUPABASE_SCHEMA_GUIDANCE,
    'Схема управления функциями временно недоступна.',
    240,
  );

  function runtimeControlsSnapshot() {
    const current=memory.runtimeControls?.value;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {...defaults};
    const inspected=inspectRuntimeControls(current,defaults,{requireComplete:true});
    if (!inspected.valid) {
      return failClosedRuntimeControls(defaults,'runtime_state_invalid');
    }
    return {
      ...inspected.value,
      ...(current.controlPlaneFailClosed === true
        ? {
            controlPlaneFailClosed:true,
            controlPlaneReason:cleanText(current.controlPlaneReason,'control_plane_unavailable',80),
          }
        : {}),
    };
  }

  function normalizeRuntimeControls(row = {}) {
    return inspectRuntimeControls(row,defaults).value;
  }

  function publicRuntimeControls(value = runtimeControlsSnapshot()) {
    const inspected=inspectRuntimeControls(value,defaults);
    const normalized=inspected.value;
    const controlPlaneFailClosed=value?.controlPlaneFailClosed === true;
    return {
      ...normalized,
      securityLockdown:isSecurityLockdownControls(normalized),
      controlPlaneFailClosed,
    };
  }

  async function loadRuntimeControls(cfg, options = {}) {
    const force=plainObject(options).force === true;
    const now=safeClock(clock);
    const loadedAt=memory.runtimeControls?.loadedAt;
    const loadedAtValue=typeof loadedAt === 'number' && Number.isFinite(loadedAt) && loadedAt >= 0
      ? loadedAt
      : null;
    if (
      !force
      && memory.runtimeControls?.value
      && loadedAtValue !== null
      && now >= loadedAtValue
      && now-loadedAtValue < cacheMs
    ) {
      const cachedValue=inspectRuntimeControls(
        memory.runtimeControls.value,
        defaults,
        {requireComplete:true},
      );
      if (cachedValue.valid) return {...memory.runtimeControls,cached:true};
    }

    const activateFailClosed = (reason, error = null) => {
      const previous=normalizeRuntimeControls(memory.runtimeControls?.value);
      const value=failClosedRuntimeControls(previous,cleanText(reason,'control_plane_unavailable',80));
      memory.runtimeControls={
        value,
        loadedAt:now,
        source:'fail_closed',
        schemaReady:false,
        failClosed:true,
        ...(error ? {error:redactOpsString(error?.message || error,160)} : {}),
      };
      return {...memory.runtimeControls,cached:false};
    };

    if (!strictSupabaseAvailable(hasSupabase,cfg)) {
      return activateFailClosed('supabase_not_configured');
    }

    try {
      const row=await supaSelectOne(cfg,'runtime_controls',{id:'eq.global'});
      if (!row) return activateFailClosed('runtime_controls_missing');
      const inspected=inspectRuntimeControls(row,defaults,{requireComplete:true});
      if (!inspected.valid) return activateFailClosed('runtime_controls_invalid');
      memory.runtimeControls={
        value:inspected.value,
        loadedAt:now,
        source:'supabase',
        schemaReady:true,
        failClosed:false,
      };
      return {...memory.runtimeControls,cached:false};
    } catch (error) {
      return activateFailClosed('runtime_controls_unavailable',error);
    }
  }

  function runtimeHistorySnapshot(value) {
    const c=publicRuntimeControls(value);
    return {
      maintenanceMode:c.maintenanceMode,
      analysisEnabled:c.analysisEnabled,
      searchEnabled:c.searchEnabled,
      liveEnabled:c.liveEnabled,
      remindersEnabled:c.remindersEnabled,
      expandedDataEnabled:c.expandedDataEnabled,
      autoSettlementRecoveryEnabled:c.autoSettlementRecoveryEnabled,
      securityLockdown:c.securityLockdown === true,
      message:c.message,
      revision:c.revision,
      updatedAt:c.updatedAt,
    };
  }

  async function probeRuntimeHistorySchema(cfg) {
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return {ok:false,status:'not_configured'};
    const origin=supabaseOrigin(cfg);
    if (!origin) return {ok:false,status:'invalid_configuration'};
    try {
      const url=new URL(`${origin}/rest/v1/runtime_control_history`);
      url.searchParams.set('select','id,revision,action,reason,snapshot,app_version,source_revision,created_at');
      url.searchParams.set('limit','1');
      const r=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase runtime history schema');
      const ok=r?.ok === true;
      const status=integerCandidate(r?.status);
      return {ok,status:ok ? 'ok' : status ? `http_${status}` : 'http_error'};
    } catch (error) {
      return {ok:false,status:cleanText(error?.code,'error',80)};
    }
  }

  async function ensureRuntimeHistoryBaseline(cfg,value,user) {
    const snapshot=runtimeHistorySnapshot(value);
    await supaInsertIgnore(cfg,'runtime_control_history',{
      revision:snapshot.revision,
      action:'baseline',
      reason:'Базовое состояние сохранено перед первым изменением настроек функций.',
      snapshot,
      app_version:appVersion,
      changed_by:positiveId(user?.id) || null,
      source_revision:null,
      created_at:snapshot.updatedAt || new Date(safeClock(clock)).toISOString(),
    },'revision');
  }

  async function appendRuntimeHistory(cfg,value,user,meta = {}) {
    const snapshot=runtimeHistorySnapshot(value);
    const source=plainObject(meta);
    const sourceRevision=positiveRevision(source.sourceRevision,0);
    await supaInsertIgnore(cfg,'runtime_control_history',{
      revision:snapshot.revision,
      action:RUNTIME_ACTIONS.has(source.action) ? source.action : 'update',
      reason:cleanText(source.reason,'',240),
      snapshot,
      app_version:appVersion,
      changed_by:positiveId(user?.id) || null,
      source_revision:sourceRevision || null,
      created_at:new Date(safeClock(clock)).toISOString(),
    },'revision');
  }

  async function listRuntimeHistory(cfg, limit = 12) {
    const requested=integerCandidate(limit);
    const safeLimit=requested !== null && requested >= 1 ? Math.min(30,requested) : 12;
    const rows=await supaSelectMany(cfg,'runtime_control_history',{},{
      limit:safeLimit,
      order:'revision.desc',
    });

    const output=[];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const id=positiveId(row.id);
      const revision=positiveRevision(row.revision,0);
      const snapshotInspection=inspectRuntimeControls(row.snapshot,defaults,{requireComplete:true});
      if (!id || !revision || !snapshotInspection.valid || snapshotInspection.value.revision !== revision) continue;
      const sourceRevision=positiveRevision(row.source_revision,0);
      output.push({
        id,
        revision,
        action:RUNTIME_ACTIONS.has(row.action) ? row.action : 'update',
        reason:cleanText(row.reason,'',240),
        appVersion:cleanText(row.app_version,'',120),
        sourceRevision:sourceRevision || null,
        createdAt:timestampString(row.created_at),
        controls:publicRuntimeControls(snapshotInspection.value),
      });
    }
    return output;
  }

  async function rollbackRuntimeControls(cfg,user,body = {}) {
    const historySchema=await probeRuntimeHistorySchema(cfg);
    if (!historySchema.ok) {
      const historyReason='Журнал изменений недоступен. Откат не выполнен, чтобы не создавать неаудируемую версию.';
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'release',
        eventType:'runtime_history',
        code:'RUNTIME_HISTORY_REQUIRED',
        message:historyReason,
        endpoint:'/api/runtime-controls/rollback',
        meta:{schemaStatus:cleanText(historySchema.status,'unknown',80)},
      }).catch(()=>{});
      return {
        error:historyReason,
        code:'RUNTIME_HISTORY_REQUIRED',
        status:503,
        historyReady:false,
        historyReason,
      };
    }

    const source=plainObject(body);
    const expectedRevision=positiveRevision(source.expectedRevision,0);
    const historyId=positiveId(source.historyId);
    if (!expectedRevision || !historyId) {
      return {
        error:'Не хватает номера текущей версии или идентификатора точки восстановления для отката.',
        code:'RUNTIME_ROLLBACK_INPUT',
        status:400,
      };
    }

    const row=await supaSelectOne(cfg,'runtime_control_history',{id:`eq.${historyId}`});
    if (!row?.snapshot || positiveId(row.id) !== historyId) {
      return {
        error:'Точка восстановления настроек функций не найдена.',
        code:'RUNTIME_ROLLBACK_NOT_FOUND',
        status:404,
      };
    }

    const rowRevision=positiveRevision(row.revision,0);
    const targetInspection=inspectRuntimeControls(row.snapshot,defaults,{requireComplete:true});
    if (!rowRevision || !targetInspection.valid || targetInspection.value.revision !== rowRevision) {
      return {
        error:'Точка восстановления повреждена и не может быть применена.',
        code:'RUNTIME_ROLLBACK_SNAPSHOT_INVALID',
        status:409,
      };
    }

    const target=targetInspection.value;
    if (target.revision === expectedRevision) {
      return {
        error:'Выбрана уже активная версия.',
        code:'RUNTIME_ROLLBACK_SAME_REVISION',
        status:409,
      };
    }

    return await saveRuntimeControls(cfg,user,{
      expectedRevision,
      maintenanceMode:target.maintenanceMode,
      analysisEnabled:target.analysisEnabled,
      searchEnabled:target.searchEnabled,
      liveEnabled:target.liveEnabled,
      remindersEnabled:target.remindersEnabled,
      expandedDataEnabled:target.expandedDataEnabled,
      autoSettlementRecoveryEnabled:target.autoSettlementRecoveryEnabled,
      message:target.message,
      reason:cleanText(source.reason,`Rollback to revision ${rowRevision}`,240),
      action:'rollback',
      sourceRevision:rowRevision,
    },{trustedRollback:true});
  }

  async function saveRuntimeControls(cfg,user,body = {},options = {}) {
    const currentState=await loadRuntimeControls(cfg,{force:true});
    if (!currentState.schemaReady) {
      return {
        error:schemaGuidance,
        code:'RUNTIME_CONTROLS_SCHEMA',
        status:503,
        current:publicRuntimeControls(currentState.value),
      };
    }

    const current=currentState.value;
    const source=plainObject(body);
    const expectedRevision=positiveRevision(source.expectedRevision,0);
    if (!expectedRevision || expectedRevision !== current.revision) {
      return {
        error:'Настройки уже изменились в другой сессии. Обновите панель и повторите.',
        code:'RUNTIME_CONTROLS_CONFLICT',
        status:409,
        current:publicRuntimeControls(current),
      };
    }

    const requestedAction=typeof source.action === 'string' ? source.action.trim() : '';
    const trustedRollback=plainObject(options).trustedRollback === true;
    if (requestedAction === 'rollback' && !trustedRollback) {
      return {
        error:'Откат разрешён только через проверенную точку истории.',
        code:'RUNTIME_CONTROLS_ACTION_INVALID',
        status:400,
        current:publicRuntimeControls(current),
      };
    }
    const changeAction=RUNTIME_ACTIONS.has(requestedAction) ? requestedAction : 'update';
    if (!['lockdown','lockdown_release'].includes(changeAction) && !validMutationControls(source)) {
      return {
        error:'Флаги настроек имеют некорректный формат. Обновите панель и повторите.',
        code:'RUNTIME_CONTROLS_INPUT',
        status:400,
        current:publicRuntimeControls(current),
      };
    }

    const historySchema=await probeRuntimeHistorySchema(cfg);
    if (!historySchema.ok) {
      const historyReason='Журнал изменений недоступен. Настройки не применены, чтобы не создавать неаудируемую версию.';
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'release',
        eventType:'runtime_history',
        code:'RUNTIME_HISTORY_REQUIRED',
        message:historyReason,
        endpoint:'/api/runtime-controls',
        meta:{revision:current.revision,schemaStatus:cleanText(historySchema.status,'unknown',80)},
      }).catch(()=>{});
      return {
        error:historyReason,
        code:'RUNTIME_HISTORY_REQUIRED',
        status:503,
        current:publicRuntimeControls(current),
        historyReady:false,
        historyReason,
      };
    }

    try {
      await ensureRuntimeHistoryBaseline(cfg,current,user);
    } catch (error) {
      const historyReason='Журнал изменений недоступен: базовая точка не сохранена. Настройки не применены.';
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'release',
        eventType:'runtime_history',
        code:'RUNTIME_HISTORY_BASELINE_WRITE_FAILED',
        message:redactOpsString(error?.message || error,160),
        endpoint:'/api/runtime-controls',
        meta:{revision:current.revision},
      }).catch(()=>{});
      return {
        error:historyReason,
        code:'RUNTIME_HISTORY_BASELINE_WRITE_FAILED',
        status:503,
        current:publicRuntimeControls(current),
        historyReady:false,
        historyReason,
      };
    }

    const historyReady=true;
    const historyReason='';
    const sourceRevision=trustedRollback
      ? positiveRevision(source.sourceRevision,0) || null
      : null;
    const wasSecurityLockdown=isSecurityLockdownControls(current);
    const lockdownRequested=changeAction === 'lockdown';
    const lockdownReleaseRequested=changeAction === 'lockdown_release';
    const proposed={
      maintenanceMode:lockdownRequested ? true : lockdownReleaseRequested ? false : source.maintenanceMode,
      analysisEnabled:lockdownRequested ? false : lockdownReleaseRequested ? true : source.analysisEnabled,
      searchEnabled:lockdownRequested ? false : lockdownReleaseRequested ? true : source.searchEnabled,
      liveEnabled:lockdownRequested ? false : lockdownReleaseRequested ? true : source.liveEnabled,
      remindersEnabled:lockdownRequested ? false : lockdownReleaseRequested ? true : source.remindersEnabled,
      expandedDataEnabled:lockdownRequested ? false : lockdownReleaseRequested ? true : source.expandedDataEnabled,
      autoSettlementRecoveryEnabled:lockdownRequested || lockdownReleaseRequested
        ? false
        : source.autoSettlementRecoveryEnabled,
    };

    if (wasSecurityLockdown && changeAction === 'update' && !isSecurityLockdownControls(proposed)) {
      return {
        error:'Аварийный Security Lockdown можно снять только явным восстановлением, откатом или безопасными настройками.',
        code:'SECURITY_LOCKDOWN_EXPLICIT_RELEASE_REQUIRED',
        status:409,
        current:publicRuntimeControls(current),
      };
    }

    const changeReason=cleanText(
      source.reason,
      lockdownRequested
        ? 'Аварийный Security Lockdown включён администратором.'
        : lockdownReleaseRequested
          ? 'Аварийный Security Lockdown снят администратором.'
          : '',
      240,
    );

    const currentTime=safeClock(clock);
    if (current.revision >= MAX_REVISION) {
      return {
        error:'Достигнут предел версии настроек. Требуется обслуживание схемы.',
        code:'RUNTIME_CONTROLS_REVISION_EXHAUSTED',
        status:503,
        current:publicRuntimeControls(current),
      };
    }

    const next={
      maintenance_mode:proposed.maintenanceMode,
      analysis_enabled:proposed.analysisEnabled,
      search_enabled:proposed.searchEnabled,
      live_enabled:proposed.liveEnabled,
      reminders_enabled:proposed.remindersEnabled,
      expanded_data_enabled:proposed.expandedDataEnabled,
      auto_settlement_recovery_enabled:proposed.autoSettlementRecoveryEnabled,
      message:lockdownRequested
        ? cleanText(source.message,'Аварийный режим безопасности активен. Изменения временно недоступны.',280)
        : lockdownReleaseRequested
          ? ''
          : cleanText(source.message,'',280),
      revision:expectedRevision+1,
      updated_at:new Date(currentTime).toISOString(),
      updated_by:positiveId(user?.id) || null,
    };

    const reasonHex=Array.from(
      new TextEncoder().encode(changeReason),
      byte=>byte.toString(16).padStart(2,'0'),
    ).join('');
    const origin=supabaseOrigin(cfg);
    if (!origin) {
      return {
        error:schemaGuidance,
        code:'RUNTIME_CONTROLS_SCHEMA',
        status:503,
        current:publicRuntimeControls(current),
      };
    }
    const url=new URL(`${origin}/rest/v1/runtime_controls`);
    url.searchParams.set('id','eq.global');
    url.searchParams.set('revision',`eq.${expectedRevision}`);
    const response=await fetchWithTimeout(url,{
      method:'PATCH',
      headers:supaHeaders(cfg,{
        Prefer:'return=representation',
        'X-Runtime-Action':changeAction,
        'X-Runtime-Reason-Hex':reasonHex,
        'X-Runtime-App-Version':appVersion,
        ...(sourceRevision ? {'X-Runtime-Source-Revision':String(sourceRevision)} : {}),
      }),
      body:JSON.stringify(next),
    },7000,'Supabase atomic runtime controls');

    if (response?.ok !== true) {
      let responseText='';
      if (typeof response?.text === 'function') {
        try { responseText=await response.text(); } catch {}
      }
      const status=integerCandidate(response?.status);
      const failureReason='Настройки не применены: состояние и журнал не удалось сохранить одной транзакцией.';
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'release',
        eventType:'runtime_history',
        code:'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED',
        message:redactOpsString(responseText || `HTTP ${status || 'unknown'}`,160),
        endpoint:'/api/runtime-controls',
        status:status || null,
        meta:{revision:expectedRevision,action:changeAction,sourceRevision},
      }).catch(()=>{});
      return {
        error:failureReason,
        code:'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED',
        status:503,
        current:publicRuntimeControls(current),
        historyReady:false,
        historyReason:failureReason,
      };
    }

    let rows=null;
    if (typeof response?.json === 'function') {
      try { rows=await response.json(); } catch {}
    }
    if (!Array.isArray(rows) || rows.length !== 1) {
      return {
        error:'Настройки изменились до сохранения. Обновите панель и повторите.',
        code:'RUNTIME_CONTROLS_CONFLICT',
        status:409,
        current:publicRuntimeControls((await loadRuntimeControls(cfg,{force:true})).value),
      };
    }

    const committed=inspectRuntimeControls(rows[0],defaults,{requireComplete:true});
    const value=committed.value;
    const committedMatches=committed.valid
      && value.revision === expectedRevision+1
      && CONTROL_BOOLEAN_FIELDS.every(key=>value[key] === proposed[key])
      && value.message === next.message;
    if (!committedMatches) {
      const failureReason='Настройки не подтверждены: база данных вернула некорректное состояние.';
      return {
        error:failureReason,
        code:'RUNTIME_CONTROLS_ATOMIC_COMMIT_INVALID',
        status:503,
        current:publicRuntimeControls(current),
        historyReady:false,
        historyReason:failureReason,
      };
    }

    memory.runtimeControls={
      value,
      loadedAt:currentTime,
      source:'supabase',
      schemaReady:true,
      failClosed:false,
    };

    const securityLockdown=isSecurityLockdownControls(value);
    const lockdownTransition=!wasSecurityLockdown && securityLockdown
      ? 'enabled'
      : wasSecurityLockdown && !securityLockdown ? 'released' : '';

    await recordOpsEvent(cfg,{
      severity:securityLockdown ? 'critical' : value.maintenanceMode ? 'warning' : 'info',
      source:'release',
      eventType:lockdownTransition ? 'security_lockdown' : 'runtime_controls',
      code:lockdownTransition === 'enabled'
        ? 'SECURITY_LOCKDOWN_ENABLED'
        : lockdownTransition === 'released'
          ? 'SECURITY_LOCKDOWN_RELEASED'
          : value.maintenanceMode ? 'MAINTENANCE_ENABLED' : 'RUNTIME_CONTROLS_UPDATED',
      message:lockdownTransition === 'enabled'
        ? `Аварийный Security Lockdown включён на версии ${value.revision}.`
        : lockdownTransition === 'released'
          ? `Аварийный Security Lockdown снят на версии ${value.revision}.`
          : `Настройки функций обновлены до версии ${value.revision}.`,
      endpoint:'/api/runtime-controls',
      meta:{
        revision:value.revision,
        maintenanceMode:value.maintenanceMode,
        analysisEnabled:value.analysisEnabled,
        searchEnabled:value.searchEnabled,
        liveEnabled:value.liveEnabled,
        remindersEnabled:value.remindersEnabled,
        expandedDataEnabled:value.expandedDataEnabled,
        autoSettlementRecoveryEnabled:value.autoSettlementRecoveryEnabled,
        securityLockdown,
        action:changeAction,
        reason:changeReason,
        sourceRevision,
        historyReady,
      },
    }).catch(()=>{});
    return {value,status:200,historyReady,historyReason};
  }

  function runtimeFeatureResponse(code,message,runtime,status = 503) {
    const safeCode=cleanText(code,'FEATURE_DISABLED',80);
    const category=safeCode.startsWith('SECURITY_LOCKDOWN_')
      ? 'security_lockdown'
      : safeCode === 'MAINTENANCE_MODE' ? 'maintenance' : 'feature_disabled';
    const safeStatus=integerCandidate(status);
    return json({
      error:cleanText(message,'Функция временно недоступна.',280),
      code:safeCode,
      category,
      recoverable:true,
      runtime:publicRuntimeControls(runtime),
    },safeStatus !== null && safeStatus >= 400 && safeStatus <= 599 ? safeStatus : 503);
  }

  function runtimeGuard(request,user,cfg,runtime) {
    let admin=false;
    try {
      admin=isAdminUser(user,cfg) === true;
    } catch {
      admin=false;
    }
    const runtimeInspection=inspectRuntimeControls(runtime,defaults,{requireComplete:true});
    const guardRuntime=runtimeInspection.valid
      ? runtime
      : failClosedRuntimeControls(defaults,'runtime_state_invalid');
    const normalizedRuntime=publicRuntimeControls(guardRuntime);
    let requestUrl;
    try {
      requestUrl=new URL(typeof request?.url === 'string' ? request.url : '');
    } catch {
      return runtimeFeatureResponse(
        'RUNTIME_REQUEST_INVALID',
        'Запрос не может быть безопасно обработан.',
        normalizedRuntime,
        400,
      );
    }
    const method=typeof request?.method === 'string' ? request.method.trim().toUpperCase() : '';
    const lockdown=runtimeLockdownDecision(
      {url:requestUrl.toString(),method:method || 'INVALID'},
      {runtime:normalizedRuntime,isAdmin:admin},
    );
    if (lockdown.blocked) {
      const path=requestUrl.pathname;
      const current=safeClock(clock);
      const minuteBucket=new Date(current).toISOString().slice(0,16);
      void recordOpsEvent(cfg,{
        severity:'warning',
        source:'release',
        eventType:'security_lockdown_block',
        code:cleanText(lockdown.code,'SECURITY_LOCKDOWN_WRITE_BLOCKED',80),
        message:'Запрос остановлен активным аварийным режимом безопасности.',
        endpoint:path,
        status:integerCandidate(lockdown.status) || 503,
        transitionKey:`security-lockdown:${cleanText(lockdown.code,'blocked',80)}:${path}:${minuteBucket}`,
        meta:{
          method:typeof request?.method === 'string' ? request.method.toUpperCase() : 'UNKNOWN',
          admin,
          providerFanout:lockdown.providerFanout === true,
          controlPlaneFailClosed:lockdown.controlPlaneFailClosed === true,
          minuteBucket,
        },
      }).catch(()=>{});
      return runtimeFeatureResponse(lockdown.code,lockdown.message,normalizedRuntime,lockdown.status);
    }

    if (admin) return null;
    const path=requestUrl.pathname;

    const footballRoutes=new Set([
      '/api/matches','/api/search','/api/tournament','/api/team','/api/team/intelligence',
      '/api/team/squad','/api/match-center','/api/analyze',
    ]);

    if (normalizedRuntime.maintenanceMode === true && footballRoutes.has(path)) {
      return runtimeFeatureResponse(
        'MAINTENANCE_MODE',
        normalizedRuntime.message || 'Приложение временно находится на техническом обслуживании. Попробуйте позже.',
        normalizedRuntime,
        503,
      );
    }
    if (path === '/api/analyze' && method === 'POST' && normalizedRuntime.analysisEnabled === false) {
      return runtimeFeatureResponse('ANALYSIS_DISABLED','Полный анализ временно приостановлен администратором.',normalizedRuntime,503);
    }
    if (path === '/api/search' && normalizedRuntime.searchEnabled === false) {
      return runtimeFeatureResponse('SEARCH_DISABLED','Удалённый поиск временно приостановлен. Локальный каталог остаётся доступен.',normalizedRuntime,503);
    }
    if (path === '/api/reminders' && method === 'POST' && normalizedRuntime.remindersEnabled === false) {
      return runtimeFeatureResponse('REMINDERS_DISABLED','Новые уведомления временно приостановлены. Уже созданные можно удалить.',normalizedRuntime,503);
    }
    return null;
  }

  async function apiRuntimeControls(request,cfg,user) {
    if (request?.method === 'GET') {
      let refresh=false;
      try {
        refresh=new URL(request.url).searchParams.get('refresh') === '1';
      } catch {}
      const state=await loadRuntimeControls(cfg,{force:refresh});
      const historySchema=await probeRuntimeHistorySchema(cfg);
      let history=[];
      let historyReady=historySchema.ok === true;
      let historyReason=historyReady ? '' : schemaGuidance;
      if (historyReady) {
        try {
          history=await listRuntimeHistory(cfg,12);
        } catch (error) {
          historyReady=false;
          historyReason='История изменений временно недоступна. Обновите панель позже.';
          void recordOpsEvent(cfg,{
            severity:'warning',
            source:'release',
            eventType:'runtime_history',
            code:'RUNTIME_HISTORY_READ_FAILED',
            message:redactOpsString(error?.message || error,160),
            endpoint:'/api/runtime-controls',
          }).catch(()=>{});
        }
      }
      return json({
        available:state.schemaReady === true,
        source:cleanText(state.source,'unknown',40),
        schemaReady:state.schemaReady === true,
        historyReady,
        controls:publicRuntimeControls(state.value),
        history,
        cacheSeconds:Math.round(cacheMs/1000),
        reason:state.schemaReady === true ? '' : schemaGuidance,
        historyReason,
      });
    }

    if (request?.method === 'PATCH' || request?.method === 'POST') {
      let body={};
      try {
        const parsed=await request.json();
        body=plainObject(parsed);
      } catch {}
      const result=await saveRuntimeControls(cfg,user,body);
      if (result.error) {
        return json({error:result.error,code:result.code,current:result.current},result.status || 400);
      }

      let history=[];
      let historyReady=result.historyReady === true;
      let historyReason=cleanText(result.historyReason,'',240);
      if (historyReady) {
        try {
          history=await listRuntimeHistory(cfg,12);
        } catch (error) {
          historyReady=false;
          historyReason='Настройки применены, но журнал изменений временно не удалось перечитать.';
          void recordOpsEvent(cfg,{
            severity:'warning',
            source:'release',
            eventType:'runtime_history',
            code:'RUNTIME_HISTORY_POST_WRITE_READ_FAILED',
            message:redactOpsString(error?.message || error,160),
            endpoint:'/api/runtime-controls',
            meta:{revision:positiveRevision(result.value?.revision,0) || null},
          }).catch(()=>{});
        }
      }
      return json({
        ok:true,
        controls:publicRuntimeControls(result.value),
        historyReady,
        historyReason,
        history,
      });
    }

    return json({error:'Метод не поддерживается.'},405);
  }

  async function apiRuntimeRollback(request,cfg,user) {
    if (request?.method !== 'POST') return json({error:'Метод не поддерживается.'},405);

    let body={};
    try {
      const parsed=await request.json();
      body=plainObject(parsed);
    } catch {}
    const result=await rollbackRuntimeControls(cfg,user,body);
    if (result.error) {
      return json({
        error:result.error,
        code:result.code,
        current:result.current,
      },result.status || 400);
    }

    let history=[];
    let historyReady=result.historyReady === true;
    let historyReason=cleanText(result.historyReason,'',240);
    if (historyReady) {
      try {
        history=await listRuntimeHistory(cfg,12);
      } catch (error) {
        historyReady=false;
        historyReason='Откат выполнен, но журнал изменений временно не удалось перечитать.';
        void recordOpsEvent(cfg,{
          severity:'warning',
          source:'release',
          eventType:'runtime_history',
          code:'RUNTIME_HISTORY_ROLLBACK_READ_FAILED',
          message:redactOpsString(error?.message || error,160),
          endpoint:'/api/runtime-controls/rollback',
          meta:{revision:positiveRevision(result.value?.revision,0) || null},
        }).catch(()=>{});
      }
    }
    return json({
      ok:true,
      controls:publicRuntimeControls(result.value),
      historyReady,
      historyReason,
      history,
    });
  }

  return Object.freeze({
    runtimeControlsSnapshot,
    normalizeRuntimeControls,
    publicRuntimeControls,
    loadRuntimeControls,
    runtimeHistorySnapshot,
    probeRuntimeHistorySchema,
    ensureRuntimeHistoryBaseline,
    appendRuntimeHistory,
    listRuntimeHistory,
    rollbackRuntimeControls,
    saveRuntimeControls,
    runtimeFeatureResponse,
    runtimeGuard,
    apiRuntimeControls,
    apiRuntimeRollback,
  });
}
