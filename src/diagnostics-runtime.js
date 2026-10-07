export function createDiagnosticsRuntime({
  memory,
  appVersion,
  supabaseSchemaGuidance,
  hasSupabase,
  fetchWithTimeout,
  supaHeaders,
  probeSupabaseConfirmed,
  readIntegrityDiagnostics,
  readTelegramDedupeHealth,
  providerSloReport,
  providerSnapshot,
  footballCooldownRemaining,
  telemetrySnapshot,
  now=()=>new Date(),
} = {}) {
  if (!memory || typeof memory!=='object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  for (const [name,fn] of Object.entries({
    hasSupabase,
    fetchWithTimeout,
    supaHeaders,
    probeSupabaseConfirmed,
    readIntegrityDiagnostics,
    readTelegramDedupeHealth,
    providerSloReport,
    providerSnapshot,
    footballCooldownRemaining,
    telemetrySnapshot,
    now,
  })) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value) ? value : null;
  }

  function safeRead(value,key) {
    try {
      return value?.[key];
    } catch {
      return undefined;
    }
  }

  function safeText(value,max=240,fallback='') {
    if (!['string','number','bigint'].includes(typeof value)) return fallback;
    try {
      const text=String(value)
        .replace(/[\u0000-\u001f\u007f]+/g,' ')
        .trim()
        .slice(0,max);
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  function finiteNumber(value,{min=-Infinity,max=Infinity}={}) {
    if (typeof value!=='number' || !Number.isFinite(value)) return null;
    if (value<min || value>max) return null;
    return value;
  }

  function sanitizeDiagnosticValue(value,depth=0,seen=new WeakSet()) {
    if (value===null || typeof value==='boolean') return value;
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value==='string') return safeText(value,1000);
    if (typeof value==='bigint') return safeText(value,120);
    if (value instanceof Date) return strictTimestamp(value);
    if (depth>=5 || !value || typeof value!=='object') return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      return value
        .slice(0,50)
        .map(item=>sanitizeDiagnosticValue(item,depth+1,seen))
        .filter(item=>item!==undefined);
    }

    const object=plainObject(value);
    if (!object) return null;
    const out={};
    let keys=[];
    try {
      keys=Object.keys(object).slice(0,80);
    } catch {
      return out;
    }
    for (const rawKey of keys) {
      const key=safeText(rawKey,120);
      if (!key || Object.prototype.hasOwnProperty.call(out,key)) continue;
      const sanitized=sanitizeDiagnosticValue(safeRead(object,rawKey),depth+1,seen);
      if (sanitized!==undefined) out[key]=sanitized;
    }
    return out;
  }

  function diagnosticObject(value,fallback) {
    const sanitized=sanitizeDiagnosticValue(value);
    return plainObject(sanitized) || fallback;
  }

  function telemetryValue(name) {
    const telemetry=plainObject(safeRead(memory,'telemetry'));
    return finiteNumber(safeRead(telemetry,name),{min:0}) ?? 0;
  }

  function strictTimestamp(value) {
    if (value instanceof Date) {
      const ms=value.getTime();
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    if (typeof value!=='string' || !value.trim()) return null;
    const raw=value.trim();
    const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
    if (!calendar) return null;
    const year=Number(calendar[1]);
    const month=Number(calendar[2]);
    const day=Number(calendar[3]);
    if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day>maxDay) return null;
    if (
      raw.length>10
      && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    ) return null;
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  function normalizeOpsLimit(limit=10) {
    if (typeof limit!=='number' || !Number.isFinite(limit)) return 10;
    return Math.max(1,Math.min(20,Math.trunc(limit)));
  }

  function normalizeRetentionDays(value) {
    if (typeof value!=='number' || !Number.isFinite(value)) return 14;
    return Math.max(1,Math.min(365,Math.trunc(value)));
  }

  function safeHasSupabase(cfg) {
    try {
      return hasSupabase(cfg)===true;
    } catch {
      return false;
    }
  }

  function sanitizeOpsEvent(value) {
    const row=plainObject(value);
    if (!row) return null;
    const out={};
    const createdAt=strictTimestamp(safeRead(row,'created_at'));
    if (createdAt) out.created_at=createdAt;
    for (const [key,max] of [
      ['severity',24],
      ['source',40],
      ['event_type',80],
      ['code',120],
      ['message',500],
      ['endpoint',180],
    ]) {
      const text=safeText(safeRead(row,key),max);
      if (text) out[key]=text;
    }
    const status=finiteNumber(safeRead(row,'status'),{min:100,max:599});
    if (status!==null && Number.isInteger(status)) out.status=status;
    const durationMs=finiteNumber(safeRead(row,'duration_ms'),{min:0,max:3_600_000});
    if (durationMs!==null) out.duration_ms=durationMs;
    const metadata=diagnosticObject(safeRead(row,'metadata'),null);
    if (metadata) out.metadata=metadata;
    return Object.keys(out).length ? out : null;
  }

  function fallbackOpsItems(limit) {
    const rows=Array.isArray(safeRead(memory,'opsEvents'))
      ? safeRead(memory,'opsEvents')
      : [];
    return rows
      .slice(0,limit)
      .map(sanitizeOpsEvent)
      .filter(Boolean);
  }

  async function readRecentOpsEvents(cfg,limit=10) {
    const safeLimit=normalizeOpsLimit(limit);
    const fallback=()=>({
      persistent:false,
      migrationReady:false,
      items:fallbackOpsItems(safeLimit),
    });
    if (!safeHasSupabase(cfg)) return fallback();
    try {
      const supabaseUrl=safeText(safeRead(cfg,'supabaseUrl'),2048);
      if (!supabaseUrl) return fallback();
      const url=new URL('/rest/v1/ops_events',supabaseUrl.endsWith('/') ? supabaseUrl : supabaseUrl+'/');
      url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('order','created_at.desc');
      url.searchParams.set('limit',String(safeLimit));
      const response=await fetchWithTimeout(
        url,
        {headers:supaHeaders(cfg)},
        7000,
        'Supabase ops',
      );
      if (!response || safeRead(response,'ok')!==true) return fallback();
      const json=safeRead(response,'json');
      if (typeof json!=='function') return fallback();
      const items=await json.call(response);
      if (!Array.isArray(items)) return fallback();
      return {
        persistent:true,
        migrationReady:true,
        items:items
          .slice(0,safeLimit)
          .map(sanitizeOpsEvent)
          .filter(Boolean),
      };
    } catch {
      return fallback();
    }
  }

  async function safeAsyncCall(fn,args,fallback) {
    try {
      const value=await fn(...args);
      return value;
    } catch {
      return typeof fallback==='function' ? fallback() : fallback;
    }
  }

  function safeSyncCall(fn,args,fallback) {
    try {
      return fn(...args);
    } catch {
      return typeof fallback==='function' ? fallback() : fallback;
    }
  }

  function safeGeneratedAt() {
    const value=safeSyncCall(now,[],null);
    return strictTimestamp(value) || new Date().toISOString();
  }

  async function collectDiagnostics(cfg) {
    const supabaseConfigured=safeHasSupabase(cfg);
    const [supabaseRaw,ops,integrityRaw,telegramRaw,providerObservabilityRaw]=await Promise.all([
      safeAsyncCall(
        probeSupabaseConfirmed,
        [cfg],
        ()=>({
          configured:supabaseConfigured,
          ok:false,
          status:'diagnostics_error',
          diagnosticsError:true,
        }),
      ),
      readRecentOpsEvents(cfg,12),
      safeAsyncCall(
        readIntegrityDiagnostics,
        [cfg,12],
        ()=>({
          available:false,
          migrationReady:false,
          lastRun:null,
          recentIssues:[],
          diagnosticsError:true,
        }),
      ),
      safeAsyncCall(
        readTelegramDedupeHealth,
        [cfg,60],
        ()=>({
          available:false,
          state:'unknown',
          staleProcessing:0,
          failedCurrent:0,
          diagnosticsError:true,
        }),
      ),
      safeAsyncCall(
        providerSloReport,
        [cfg,24],
        ()=>({
          available:false,
          overall:{state:'unknown'},
          incident:{activeIncident:null},
          diagnosticsError:true,
        }),
      ),
    ]);

    const supabase=diagnosticObject(supabaseRaw,{
      configured:supabaseConfigured,
      ok:false,
      status:'invalid_diagnostics',
      diagnosticsError:true,
    });
    const integrity=diagnosticObject(integrityRaw,{
      available:false,
      migrationReady:false,
      lastRun:null,
      recentIssues:[],
      diagnosticsError:true,
    });
    const telegramWebhook=diagnosticObject(telegramRaw,{
      available:false,
      state:'unknown',
      staleProcessing:0,
      failedCurrent:0,
      diagnosticsError:true,
    });
    const providerObservability=diagnosticObject(providerObservabilityRaw,{
      available:false,
      overall:{state:'unknown'},
      incident:{activeIncident:null},
      diagnosticsError:true,
    });

    const providerRaw=safeSyncCall(
      providerSnapshot,
      [],
      ()=>({
        health:'warning',
        cooldownActive:false,
        dailyUsedPct:null,
        diagnosticsError:true,
      }),
    );
    const provider=diagnosticObject(providerRaw,{
      health:'warning',
      cooldownActive:false,
      dailyUsedPct:null,
      diagnosticsError:true,
    });
    const runtimeRaw=safeSyncCall(telemetrySnapshot,[],()=>({diagnosticsError:true}));
    const runtime=diagnosticObject(runtimeRaw,{diagnosticsError:true});

    const providerHealth=safeText(safeRead(provider,'health'),32,'warning');
    const providerOverall=plainObject(safeRead(providerObservability,'overall')) || {};
    const providerSloState=safeText(safeRead(providerOverall,'state'),32,'unknown');
    const telegramState=safeText(safeRead(telegramWebhook,'state'),32,'unknown');
    const integrityLastRun=plainObject(safeRead(integrity,'lastRun')) || {};
    const integrityHealth=safeText(safeRead(integrityLastRun,'health'),32,'unknown');

    let overall;
    if (safeRead(supabase,'configured')===true && safeRead(supabase,'ok')!==true) {
      overall={state:'critical',label:'Нужна проверка Supabase'};
    } else if (safeRead(supabase,'recovered')===true) {
      overall={state:'warning',label:'Supabase ответил после подтверждающего probe'};
    } else if (providerHealth==='critical') {
      overall={state:'critical',label:'API-Football временно ограничен'};
    } else if (safeRead(provider,'diagnosticsError')===true) {
      overall={state:'warning',label:'Диагностика API-Football недоступна'};
    } else if (providerSloState==='incident') {
      overall={state:'warning',label:'Provider SLO нарушен'};
    } else if (safeRead(providerObservability,'diagnosticsError')===true) {
      overall={state:'warning',label:'Provider SLO временно недоступен'};
    } else if (!safeRead(ops,'migrationReady') && supabaseConfigured) {
      overall={state:'warning',label:'Проверьте актуальную схему Supabase'};
    } else if (safeRead(integrity,'diagnosticsError')===true) {
      overall={state:'warning',label:'Диагностика целостности данных недоступна'};
    } else if (!safeRead(integrity,'migrationReady') && supabaseConfigured) {
      overall={state:'warning',label:'Проверьте актуальную схему Supabase'};
    } else if (safeRead(telegramWebhook,'diagnosticsError')===true) {
      overall={state:'warning',label:'Диагностика Telegram webhook недоступна'};
    } else if (!safeRead(telegramWebhook,'available') && supabaseConfigured) {
      overall={state:'warning',label:'Нужна миграция наблюдаемости Telegram webhook'};
    } else if (telegramState==='incident') {
      overall={state:'warning',label:'Persistent Telegram dedupe требует проверки'};
    } else if (integrityHealth==='critical') {
      overall={state:'warning',label:'Есть проблемы качества футбольных данных'};
    } else if (telemetryValue('analysisHistoryWriteLosses')>=3) {
      overall={state:'warning',label:'Есть потери истории AI-анализов'};
    } else if (
      telegramState==='watch'
      || providerHealth==='warning'
      || providerSloState==='watch'
      || integrityHealth==='warning'
      || telemetryValue('routeErrors')>0
      || telemetryValue('cacheWriteErrors')>0
    ) {
      overall={state:'warning',label:'Есть предупреждения'};
    } else if (providerHealth==='waiting') {
      overall={state:'waiting',label:'Ожидаем первый запрос к источнику данных'};
    } else {
      overall={state:'ok',label:'Системы работают штатно'};
    }

    const recommendations=[];
    const pushRecommendation=value=>{
      if (recommendations.length>=8) return;
      const text=safeText(value,500);
      if (!text || recommendations.includes(text)) return;
      recommendations.push(text);
    };
    const schemaGuidance=safeText(supabaseSchemaGuidance,500);

    if (safeRead(supabase,'ok')===true && !safeRead(ops,'migrationReady') && supabaseConfigured) {
      pushRecommendation(`Схема постоянного журнала событий недоступна. ${schemaGuidance}`);
    }
    if (safeRead(integrity,'diagnosticsError')===true) {
      pushRecommendation('Не удалось прочитать диагностику целостности данных; повторите проверку и проверьте доступность Supabase.');
    } else if (!safeRead(integrity,'migrationReady') && supabaseConfigured) {
      pushRecommendation(`Схема постоянного журнала целостности недоступна. ${schemaGuidance}`);
    }
    if (safeRead(telegramWebhook,'diagnosticsError')===true) {
      pushRecommendation('Не удалось прочитать состояние persistent Telegram dedupe; повторите проверку и проверьте Supabase.');
    } else if (!safeRead(telegramWebhook,'available') && supabaseConfigured) {
      pushRecommendation(`Диагностика persistent Telegram dedupe недоступна. ${schemaGuidance}`);
    }

    const staleProcessing=finiteNumber(safeRead(telegramWebhook,'staleProcessing'),{min:0}) ?? 0;
    const failedCurrent=finiteNumber(safeRead(telegramWebhook,'failedCurrent'),{min:0}) ?? 0;
    if (staleProcessing>0 || failedCurrent>0) {
      pushRecommendation(
        `Проверьте Telegram webhook claims: stale=${staleProcessing}, failed=${failedCurrent}.`,
      );
    }

    if (safeRead(provider,'cooldownActive')===true) {
      const cooldown=safeSyncCall(footballCooldownRemaining,[],0);
      const seconds=finiteNumber(cooldown,{min:0,max:86_400}) ?? 0;
      pushRecommendation(
        `API-Football находится на паузе ещё примерно ${Math.round(seconds)} сек.; приложение должно использовать последние сохранённые данные.`,
      );
    }

    if (providerSloState==='incident') {
      pushRecommendation('Provider SLO за 24 часа нарушен: проверьте success rate, timeout/rate-limit долю и задержку по источникам.');
    } else if (providerSloState==='watch') {
      pushRecommendation('Provider SLO за 24 часа вышел из целевого диапазона; наблюдайте provider/operation breakdown перед расширением нагрузки.');
    } else if (safeRead(providerObservability,'diagnosticsError')===true) {
      pushRecommendation('Не удалось прочитать Provider SLO; повторите диагностику перед изменением лимитов или нагрузки.');
    }

    const incident=plainObject(safeRead(providerObservability,'incident')) || {};
    const activeIncident=plainObject(safeRead(incident,'activeIncident')) || {};
    const runbook=Array.isArray(safeRead(activeIncident,'runbook'))
      ? safeRead(activeIncident,'runbook')
      : [];
    for (const step of runbook.slice(0,8)) pushRecommendation(step);

    if (safeRead(supabase,'configured')===true && safeRead(supabase,'ok')!==true) {
      pushRecommendation('Проверьте адрес Supabase, сервисный ключ и доступность интерфейса базы данных.');
    }
    if (safeRead(supabase,'recovered')===true) {
      const initialStatus=safeText(safeRead(supabase,'initialStatus'),80,'unknown');
      pushRecommendation(
        `Первый Supabase probe не прошёл (${initialStatus}), подтверждающий запрос успешно восстановился. Наблюдайте частоту transient recoveries.`,
      );
    }

    const dailyUsedPct=finiteNumber(safeRead(provider,'dailyUsedPct'),{min:0,max:100});
    if (dailyUsedPct!==null && dailyUsedPct>=90) {
      pushRecommendation('Дневная квота API-Football использована более чем на 90%; до сброса лимита работаем в экономном режиме.');
    }

    const quarantined=finiteNumber(safeRead(integrityLastRun,'quarantined'),{min:0}) ?? 0;
    const warnings=finiteNumber(safeRead(integrityLastRun,'warnings'),{min:0}) ?? 0;
    if (quarantined>0) {
      pushRecommendation(
        `Защита целостности скрыла ${quarantined} подозрительных матч(а/ей) из последней выборки. Проверьте список кодов проблем ниже.`,
      );
    }
    if (warnings>0 && quarantined===0) {
      pushRecommendation('В последней выборке есть предупреждения целостности данных; приложение оставило матчи доступными, но пометило их для контроля.');
    }

    const historyLosses=telemetryValue('analysisHistoryWriteLosses');
    const historyPending=telemetryValue('analysisHistoryRetryPending');
    if (historyLosses>=3) {
      pushRecommendation(
        `История AI-анализов потеряла ${historyLosses} записей после повторной попытки в текущем экземпляре Worker. Проверьте Supabase analysis_history и события ANALYSIS_HISTORY_WRITE_LOST.`,
      );
    } else if (historyPending>0) {
      pushRecommendation('Есть фоновые повторные попытки сохранения истории AI-анализов; проверьте их завершение в ops_events.');
    }
    if (!recommendations.length) {
      recommendations.push('Критичных действий сейчас не требуется.');
    }

    return {
      available:true,
      version:safeText(appVersion,120),
      generatedAt:safeGeneratedAt(),
      overall,
      provider,
      providerObservability,
      supabase,
      runtime,
      observability:{
        persistent:safeRead(ops,'persistent')===true,
        migrationReady:safeRead(ops,'migrationReady')===true,
        retentionDays:normalizeRetentionDays(safeRead(cfg,'opsRetentionDays')),
        recentEvents:Array.isArray(safeRead(ops,'items'))
          ? safeRead(ops,'items').slice(0,12)
          : [],
      },
      telegramWebhook,
      integrity,
      recommendations,
    };
  }

  return Object.freeze({
    readRecentOpsEvents,
    collectDiagnostics,
  });
}
