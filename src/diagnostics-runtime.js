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
  if (!memory || typeof memory!=='object') throw new TypeError('memory is required');
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
  })) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  async function readRecentOpsEvents(cfg, limit = 10) {
    const fallback = () => ({
      persistent:false,
      migrationReady:false,
      items:Array.isArray(memory.opsEvents) ? memory.opsEvents.slice(0,limit) : [],
    });
    if (!hasSupabase(cfg)) return fallback();
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('order','created_at.desc');
      url.searchParams.set('limit',String(Math.max(1,Math.min(20,limit))));
      const response=await fetchWithTimeout(
        url,
        {headers:supaHeaders(cfg)},
        7000,
        'Supabase ops',
      );
      if (!response.ok) return fallback();
      const items=await response.json().catch(()=>[]);
      return {
        persistent:true,
        migrationReady:true,
        items:Array.isArray(items) ? items : [],
      };
    } catch {
      return fallback();
    }
  }

  async function collectDiagnostics(cfg) {
    const [supabase,ops,integrity,telegramWebhook,providerObservability]=await Promise.all([
      probeSupabaseConfirmed(cfg),
      readRecentOpsEvents(cfg,12),
      readIntegrityDiagnostics(cfg,12),
      readTelegramDedupeHealth(cfg,60),
      providerSloReport(cfg,24),
    ]);
    const provider=providerSnapshot();
    let overall;
    if (supabase.configured && !supabase.ok) overall={state:'critical',label:'Нужна проверка Supabase'};
    else if (supabase.recovered) overall={state:'warning',label:'Supabase ответил после подтверждающего probe'};
    else if (provider.health==='critical') overall={state:'critical',label:'API-Football временно ограничен'};
    else if (providerObservability?.overall?.state==='incident') overall={state:'warning',label:'Provider SLO нарушен'};
    else if (!ops.migrationReady && hasSupabase(cfg)) overall={state:'warning',label:'Проверьте актуальную схему Supabase'};
    else if (!integrity.migrationReady && hasSupabase(cfg)) overall={state:'warning',label:'Проверьте актуальную схему Supabase'};
    else if (!telegramWebhook.available && hasSupabase(cfg)) overall={state:'warning',label:'Нужна миграция наблюдаемости Telegram webhook'};
    else if (telegramWebhook.state==='incident') overall={state:'warning',label:'Persistent Telegram dedupe требует проверки'};
    else if (integrity.lastRun?.health==='critical') overall={state:'warning',label:'Есть проблемы качества футбольных данных'};
    else if (Number(memory.telemetry?.analysisHistoryWriteLosses || 0)>=3) overall={state:'warning',label:'Есть потери истории AI-анализов'};
    else if (
      telegramWebhook.state==='watch'
      || provider.health==='warning'
      || providerObservability?.overall?.state==='watch'
      || integrity.lastRun?.health==='warning'
      || Number(memory.telemetry?.routeErrors || 0)>0
      || Number(memory.telemetry?.cacheWriteErrors || 0)>0
    ) overall={state:'warning',label:'Есть предупреждения'};
    else if (provider.health==='waiting') overall={state:'waiting',label:'Ожидаем первый запрос к источнику данных'};
    else overall={state:'ok',label:'Системы работают штатно'};

    const recommendations=[];
    if (supabase.ok && !ops.migrationReady && hasSupabase(cfg)) {
      recommendations.push(`Схема постоянного журнала событий недоступна. ${supabaseSchemaGuidance}`);
    }
    if (!integrity.migrationReady && hasSupabase(cfg)) {
      recommendations.push(`Схема постоянного журнала целостности недоступна. ${supabaseSchemaGuidance}`);
    }
    if (!telegramWebhook.available && hasSupabase(cfg)) {
      recommendations.push('Примените supabase_migration_v6_17.sql: она добавляет read-only health RPC для persistent Telegram dedupe.');
    }
    if (Number(telegramWebhook.staleProcessing || 0)>0 || Number(telegramWebhook.failedCurrent || 0)>0) {
      recommendations.push(`Проверьте Telegram webhook claims: stale=${Number(telegramWebhook.staleProcessing || 0)}, failed=${Number(telegramWebhook.failedCurrent || 0)}.`);
    }
    if (provider.cooldownActive) {
      recommendations.push(`API-Football находится на паузе ещё примерно ${footballCooldownRemaining()} сек.; приложение должно использовать последние сохранённые данные.`);
    }
    if (providerObservability?.overall?.state==='incident') {
      recommendations.push('Provider SLO за 24 часа нарушен: проверьте success rate, timeout/rate-limit долю и задержку по источникам.');
    } else if (providerObservability?.overall?.state==='watch') {
      recommendations.push('Provider SLO за 24 часа вышел из целевого диапазона; наблюдайте provider/operation breakdown перед расширением нагрузки.');
    }
    for (const step of providerObservability?.incident?.activeIncident?.runbook || []) {
      if (recommendations.length>=8) break;
      recommendations.push(String(step));
    }
    if (supabase.configured && !supabase.ok) {
      recommendations.push('Проверьте адрес Supabase, сервисный ключ и доступность интерфейса базы данных.');
    }
    if (supabase.recovered) {
      recommendations.push(`Первый Supabase probe не прошёл (${supabase.initialStatus || 'unknown'}), подтверждающий запрос успешно восстановился. Наблюдайте частоту transient recoveries.`);
    }
    if (Number(provider.dailyUsedPct)>=90) {
      recommendations.push('Дневная квота API-Football использована более чем на 90%; до сброса лимита работаем в экономном режиме.');
    }
    if (Number(integrity.lastRun?.quarantined || 0)>0) {
      recommendations.push(`Защита целостности скрыла ${Number(integrity.lastRun.quarantined)} подозрительных матч(а/ей) из последней выборки. Проверьте список кодов проблем ниже.`);
    }
    if (Number(integrity.lastRun?.warnings || 0)>0 && !Number(integrity.lastRun?.quarantined || 0)) {
      recommendations.push('В последней выборке есть предупреждения целостности данных; приложение оставило матчи доступными, но пометило их для контроля.');
    }
    if (Number(memory.telemetry?.analysisHistoryWriteLosses || 0)>=3) {
      recommendations.push(`История AI-анализов потеряла ${Number(memory.telemetry.analysisHistoryWriteLosses)} записей после повторной попытки в текущем экземпляре Worker. Проверьте Supabase analysis_history и события ANALYSIS_HISTORY_WRITE_LOST.`);
    } else if (Number(memory.telemetry?.analysisHistoryRetryPending || 0)>0) {
      recommendations.push('Есть фоновые повторные попытки сохранения истории AI-анализов; проверьте их завершение в ops_events.');
    }
    if (!recommendations.length) recommendations.push('Критичных действий сейчас не требуется.');

    return {
      available:true,
      version:String(appVersion || ''),
      generatedAt:now().toISOString(),
      overall,
      provider,
      providerObservability,
      supabase,
      runtime:telemetrySnapshot(),
      observability:{
        persistent:ops.persistent,
        migrationReady:ops.migrationReady,
        retentionDays:cfg.opsRetentionDays,
        recentEvents:ops.items,
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
