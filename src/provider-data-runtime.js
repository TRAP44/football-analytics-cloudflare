// Provider data/reliability orchestration extracted from worker.js.
// Provider transport, cache and policy capabilities are injected by the composition root.
export function createProviderDataRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Provider data runtime dependencies are required.');
  }
  const {
    apiFootball,
    featureCacheAgeSeconds,
    getCache,
    getCacheEntry,
    isFinishedStatus,
    isFootballRateLimitError,
    isLiveStatus,
    memory,
    providerFeatureCounter,
    providerFeaturePolicy,
    redactOpsString,
    setCache,
  } = deps;

  function providerFailureState(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (isFootballRateLimitError(error)) return 'rate_limited';
    if (code === 'UPSTREAM_TIMEOUT') return 'timeout';
    if (code === 'FOOTBALL_CONFIG') return 'configuration';
    if (/free plans? do not have access|plan|subscription|not have access|access denied|forbidden/i.test(message)) return 'plan_limited';
    if (code === 'FOOTBALL_NETWORK') return 'network_error';
    if (code.startsWith('FOOTBALL_')) return 'provider_error';
    return 'error';
  }
  
  function providerDataState(data, options = {}) {
    const rows = Array.isArray(data) ? data : data == null ? [] : [data];
    const attempted = options.attempted !== false;
    const reason = String(options.reason || '');
    const error = options.error || null;
    const state = !attempted
      ? 'skipped'
      : error
        ? providerFailureState(error)
        : rows.length
          ? 'available'
          : 'empty_response';
    return {
      state,
      available: state === 'available',
      observed: state === 'available' || state === 'empty_response',
      usable: rows.length > 0,
      degraded: ['rate_limited','timeout','configuration','plan_limited','network_error','provider_error','error'].includes(state),
      reason: reason || (error ? String(error?.code || state) : state === 'empty_response' ? 'empty_response' : ''),
      retryAfter: Number(error?.retryAfter || 0) || null,
      count: rows.length,
    };
  }
  
  function providerDataReliabilitySummary(featureMeta = {}, context = {}) {
    const entries = Object.entries(featureMeta || {}).map(([feature, meta]) => ({
      feature,
      state: String(meta?.state || 'unknown'),
      available: Boolean(meta?.available),
      observed: Boolean(meta?.observed),
      degraded: Boolean(meta?.degraded),
      reason: String(meta?.reason || ''),
      count: Number(meta?.count || 0),
      semanticState: String(meta?.semanticState || ''),
      confirmed: Boolean(meta?.confirmed),
      partial: Boolean(meta?.partial),
      freshnessState: String(meta?.freshnessState || ''),
      provenanceState: String(meta?.provenanceState || ''),
      confidenceBearing: meta?.confidenceBearing === undefined ? Boolean(meta?.available) : Boolean(meta.confidenceBearing),
      stale: Boolean(meta?.stale),
      ageSeconds: Number.isFinite(Number(meta?.ageSeconds)) ? Number(meta.ageSeconds) : null,
      freshnessLimitSeconds: Number.isFinite(Number(meta?.freshnessLimitSeconds)) ? Number(meta.freshnessLimitSeconds) : null,
    }));
    const hardFailures = entries.filter(x => x.degraded);
    const missing = entries.filter(x => !x.confidenceBearing);
    const byFeature = Object.fromEntries(entries.map(x => [x.feature, x]));
    let trustCap = 100;
    const probabilitySources = ['odds','predictions'].map(key => byFeature[key]).filter(Boolean);
    if (probabilitySources.length === 2 && probabilitySources.every(x => !x.confidenceBearing)) trustCap = 60;
    else if (probabilitySources.some(x => !x.confidenceBearing)) trustCap = Math.min(trustCap, 80);
    const minutesToKickoff = Number.isFinite(Number(context.minutesToKickoff)) ? Number(context.minutesToKickoff) : null;
    if (minutesToKickoff !== null && minutesToKickoff <= 90 && !byFeature.lineups?.confidenceBearing) {
      trustCap = Math.min(trustCap, byFeature.lineups?.partial ? 75 : 80);
    }
    if (byFeature.injuries?.degraded || (byFeature.injuries?.observed && !byFeature.injuries?.confidenceBearing)) {
      trustCap = Math.min(trustCap, 90);
    }
    if (String(context.mode || '') === 'live') {
      const liveCore = ['events','statistics'].map(key => byFeature[key]).filter(Boolean);
      if (liveCore.some(x => x.observed && !x.confidenceBearing)) trustCap = Math.min(trustCap, 70);
    }
  
    const warnings = [];
    const featureLabels = {
      events:'События матча', statistics:'Статистика матча', players:'Статистика игроков',
      lineups:'Стартовые составы', injuries:'Потери состава', liveOdds:'Live-коэффициенты',
      odds:'Линия 1X2', predictions:'Процентный прогноз', h2h:'Очные встречи', match:'Статус матча',
    };
    for (const entry of entries) {
      const label = featureLabels[entry.feature] || entry.feature;
      if (entry.observed && entry.stale) warnings.push(`${label}: данные устарели и исключены из доверенных сигналов.`);
      else if (entry.observed && entry.provenanceState === 'unknown') warnings.push(`${label}: источник не подтверждён, поэтому блок исключён из доверенных сигналов.`);
      else if (entry.observed && entry.freshnessState === 'unknown' && !entry.confidenceBearing) warnings.push(`${label}: свежесть не подтверждена, поэтому блок исключён из доверенных сигналов.`);
    }
    if (byFeature.injuries && !byFeature.injuries.confidenceBearing) {
      warnings.push(byFeature.injuries.state === 'empty_response'
        ? 'Источник не вернул записей о травмах; это не подтверждает отсутствие потерь состава.'
        : 'Данные о травмах сейчас не подтверждены источником и не трактуются как «потерь нет».');
    }
    if (byFeature.lineups?.partial) {
      warnings.push('Источник вернул неполный стартовый XI: он не считается подтверждённым модельным сигналом и не повышает полноту данных.');
    } else if (byFeature.lineups && !byFeature.lineups.confidenceBearing && minutesToKickoff !== null && minutesToKickoff <= 120) {
      warnings.push('Стартовые составы не подтверждены свежим атрибутированным источником; они исключены из модельного сигнала.');
    }
    if (byFeature.odds && !byFeature.odds.confidenceBearing) warnings.push('Линия 1X2 не подтверждена свежим источником; рыночный сигнал исключён из расчёта.');
    if (byFeature.predictions && !byFeature.predictions.confidenceBearing) warnings.push('Процентный прогноз API-Football недоступен или не прошёл проверку свежести; этот сигнал исключён из расчёта.');
  
    return {
      state: hardFailures.length ? 'degraded' : missing.length ? 'partial' : 'healthy',
      trustCap,
      checked: entries.length,
      available: entries.filter(x => x.confidenceBearing).length,
      empty: entries.filter(x => x.state === 'empty_response').length,
      skipped: entries.filter(x => x.state === 'skipped').length,
      degraded: hardFailures.length,
      features: byFeature,
      warnings: [...new Set(warnings)].slice(0, 8),
      note: hardFailures.length
        ? 'Часть данных источника недоступна, устарела или не имеет подтверждённого provenance. Неизвестность не преобразуется в нулевые значения; неподтверждённые блоки не используются как доверенные сигналы.'
        : missing.length
          ? 'Часть дополнительных данных пока не опубликована или сознательно пропущена; AI использует только подтверждённые свежие сигналы.'
          : 'Все запрошенные блоки данных получены из свежих атрибутированных источников.',
    };
  }
  
  function providerDataReliabilitySelfTest() {
    const empty = providerDataState([], { attempted: true });
    const skipped = providerDataState([], { attempted: false, reason: 'quota_reserve' });
    const limited = providerDataState([], { attempted: true, error: Object.assign(new Error('Free plans do not have access to this endpoint'), { code: 'FOOTBALL_RESPONSE' }) });
    const summary = providerDataReliabilitySummary({
      injuries: empty,
      lineups: skipped,
      odds: limited,
      predictions: limited,
    }, { minutesToKickoff: 45 });
    return {
      pass: empty.state === 'empty_response'
        && skipped.state === 'skipped'
        && limited.state === 'plan_limited'
        && summary.state === 'degraded'
        && summary.trustCap === 60
        && summary.warnings.some(x => x.includes('не подтверждает отсутствие потерь')),
      empty: empty.state,
      skipped: skipped.state,
      limited: limited.state,
      trustCap: summary.trustCap,
    };
  }
  
  async function analysisProviderFetch({ feature, path, params, fixtureId = 0, cfg, allowed = true, skipReason = '' }) {
    const ttlSeconds=({
      injuries:1800,
      predictions:1800,
      odds:600,
      h2h:21600,
      lineups:300,
    })[feature] || 600;
    const sharedFeature=['injuries','lineups'].includes(feature);
    const cacheKey=Number(fixtureId)>0
      ? (sharedFeature
        ? `provider-feature:${feature}:${Number(fixtureId)}:v4.9`
        : `analysis-provider:${feature}:${Number(fixtureId)}:v1`)
      : '';
  
    const fresh=cacheKey ? await getCacheEntry(cacheKey,cfg,false).catch(()=>null) : null;
    if (fresh?.payload) {
      const data=fresh.payload.data ?? [];
      return {
        data,
        meta:{
          feature,
          provider:fresh.payload.provider || 'api-football',
          source:'cache',
          fetchedAt:fresh.payload.fetchedAt || null,
          ageSeconds:featureCacheAgeSeconds(fresh.payload),
          expiresAt:fresh.expiresAt || null,
          ...providerDataState(data,{attempted:true}),
        },
      };
    }
  
    const stale=cacheKey ? await getCacheEntry(cacheKey,cfg,true).catch(()=>null) : null;
    if (!allowed) {
      if (stale?.payload) {
        const data=stale.payload.data ?? [];
        return {
          data,
          meta:{
            feature,
            provider:stale.payload.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.payload.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale.payload),
            expiresAt:stale.expiresAt || null,
            ...providerDataState(data,{attempted:true,reason:skipReason || 'policy'}),
            state:'stale',
            reason:skipReason || 'policy',
          },
        };
      }
      const meta = providerDataState([], { attempted: false, reason: skipReason || 'policy' });
      return { data: [], meta: { feature, provider: 'api-football', source: 'skipped', fetchedAt: null, ...meta } };
    }
  
    try {
      const data = await apiFootball(path, params, cfg);
      const wrapped={data,provider:'api-football',fetchedAt:new Date().toISOString()};
      if (cacheKey) await setCache(cacheKey,Number(fixtureId || 0),wrapped,cfg,ttlSeconds/60).catch(()=>null);
      const meta = providerDataState(data, { attempted: true });
      return { data: Array.isArray(data) ? data : [], meta: { feature, provider: 'api-football', source: 'network', fetchedAt: wrapped.fetchedAt, ...meta } };
    } catch (error) {
      if (stale?.payload) {
        const data=stale.payload.data ?? [];
        return {
          data,
          meta:{
            feature,
            provider:stale.payload.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.payload.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale.payload),
            expiresAt:stale.expiresAt || null,
            ...providerDataState(data,{attempted:true,error}),
            state:'stale',
            reason:String(error?.code || 'api_error'),
          },
        };
      }
      const meta = providerDataState([], { attempted: true, error });
      return { data: [], meta: { feature, provider: 'api-football', source: 'error', fetchedAt: null, ...meta } };
    }
  }
  
  async function providerFeatureFetch({ feature, path, params, fixtureId, cfg, context = {} }) {
    const policy = providerFeaturePolicy(feature, context);
    const cacheKey = `provider-feature:${feature}:${Number(fixtureId || 0)}:v4.9`;
    const freshEntry = await getCacheEntry(cacheKey, cfg, false).catch(() => null);
    if (freshEntry?.payload) {
      providerFeatureCounter(feature, 'cache');
      return {
        data: freshEntry.payload.data ?? [],
        meta: {
          feature,
          provider: freshEntry.payload.provider || 'api-football',
          source: 'cache',
          fetchedAt: freshEntry.payload.fetchedAt || null,
          ageSeconds: featureCacheAgeSeconds(freshEntry.payload),
          expiresAt: freshEntry.expiresAt || null,
          policy,
          ...providerDataState(freshEntry.payload.data ?? [], { attempted: true }),
        },
      };
    }
  
    const staleEntry = await getCacheEntry(cacheKey, cfg, true).catch(() => null);
  
    if (!policy.allowed) {
      providerFeatureCounter(feature, 'skipped');
      if (staleEntry?.payload) {
        providerFeatureCounter(feature, 'stale');
        return {
          data: staleEntry.payload.data ?? [],
          meta: {
            feature,
            provider: staleEntry.payload.provider || 'api-football',
            source: 'stale',
            fetchedAt: staleEntry.payload.fetchedAt || null,
            ageSeconds: featureCacheAgeSeconds(staleEntry.payload),
            expiresAt: staleEntry.expiresAt || null,
            policy,
            ...providerDataState(staleEntry.payload.data ?? [], { attempted: true, reason: policy.reason }),
            state: 'stale',
            reason: policy.reason,
          },
        };
      }
      return {
        data: [],
        meta: {
          feature,
          source: 'skipped',
          fetchedAt: null,
          ageSeconds: null,
          expiresAt: null,
          policy,
          ...providerDataState([], { attempted: false, reason: policy.reason }),
          reason: policy.reason,
        },
      };
    }
  
    try {
      const data = await apiFootball(path, params, cfg);
      const wrapped = { data, provider: 'api-football', fetchedAt: new Date().toISOString() };
      await setCache(cacheKey, fixtureId, wrapped, cfg, policy.ttlSeconds / 60).catch(() => null);
      providerFeatureCounter(feature, 'api');
      return {
        data,
        meta: {
          feature,
          provider: 'api-football',
          source: 'network',
          fetchedAt: wrapped.fetchedAt,
          ageSeconds: 0,
          expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(),
          policy,
          ...providerDataState(data, { attempted: true }),
        },
      };
    } catch (error) {
      if (staleEntry?.payload) {
        providerFeatureCounter(feature, 'stale');
        return {
          data: staleEntry.payload.data ?? [],
          meta: {
            feature,
            provider: staleEntry.payload.provider || 'api-football',
            source: 'stale',
            fetchedAt: staleEntry.payload.fetchedAt || null,
            ageSeconds: featureCacheAgeSeconds(staleEntry.payload),
            expiresAt: staleEntry.expiresAt || null,
            policy,
            ...providerDataState(staleEntry.payload.data ?? [], { attempted: true, error }),
            state: 'stale',
            reason: String(error?.code || 'api_error'),
          },
        };
      }
      providerFeatureCounter(feature, 'skipped');
      return {
        data: [],
        meta: {
          feature,
          provider: 'api-football',
          source: 'error',
          fetchedAt: null,
          ageSeconds: null,
          expiresAt: null,
          policy,
          ...providerDataState([], { attempted: true, error }),
          reason: String(error?.code || 'api_error'),
        },
      };
    }
  }
  
  
  function providerValidationStep(key, label, state, note, meta = {}) {
    return { key, label, state, note, meta };
  }
  
  function providerValidationStatus(steps = []) {
    const blocking = steps.filter(x => x.state === 'fail');
    const holds = steps.filter(x => x.state === 'hold');
    const warnings = steps.filter(x => x.state === 'warn');
    if (blocking.length) return { code: 'NEEDS_ATTENTION', label: 'Нужна проверка', ready: false };
    if (holds.length) return { code: 'HOLD', label: 'Ожидает расширенный тариф', ready: false };
    if (warnings.length) return { code: 'READY_WITH_LIMITATIONS', label: 'Готово с ограничениями', ready: true };
    return { code: 'READY', label: 'Готово к расширенному режиму', ready: true };
  }
  
  function providerFeatureSourcesSummary(dataFreshness = {}) {
    const summary = { api: 0, cache: 0, embedded: 0, stale: 0, skipped: 0, error: 0, other: 0 };
    for (const meta of Object.values(dataFreshness || {})) {
      const source = String(meta?.source || 'other');
      if (source in summary) summary[source] += 1;
      else summary.other += 1;
    }
    return summary;
  }
  
  async function responseJsonSafe(response) {
    try { return await response.json(); } catch { return null; }
  }
  
  async function loadLastProviderE2E(cfg) {
    if (memory.providerE2E?.last) return memory.providerE2E.last;
    const cached = await getCache('provider-e2e:last:v5.0', cfg).catch(() => null);
    if (cached) memory.providerE2E.last = cached;
    return cached || null;
  }
  
  async function saveProviderE2E(result, fixtureId, cfg) {
    memory.providerE2E.last = result;
    await setCache('provider-e2e:last:v5.0', Number(fixtureId || 0), result, cfg, 1440).catch(() => null);
  }
  
  
  function providerEndpointLabel(key) {
    return ({
      fixture: 'Fixture bundle',
      events: 'Events',
      statistics: 'Match statistics',
      lineups: 'Lineups',
      players: 'Player statistics',
      injuries: 'Injuries',
      predictions: 'Predictions',
      odds: 'Pre-match odds',
      liveOdds: 'Live odds',
    })[key] || key;
  }
  
  function providerAuditEndpointPlan(fixture) {
    const status = String(fixture?.fixture?.status?.short || '').toUpperCase();
    const live = isLiveStatus(status);
    const finished = isFinishedStatus(status);
    const kickoffMs = Date.parse(fixture?.fixture?.date || '');
    const minsToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
    const lineupsExpected = live || finished || (minsToKickoff !== null && minsToKickoff <= 120);
    return [
      { key: 'events', path: '/fixtures/events', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
      { key: 'statistics', path: '/fixtures/statistics', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
      { key: 'lineups', path: '/fixtures/lineups', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: lineupsExpected, expectedData: lineupsExpected },
      { key: 'players', path: '/fixtures/players', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
      { key: 'injuries', path: '/injuries', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !finished, expectedData: false },
      { key: 'predictions', path: '/predictions', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !finished, expectedData: !finished },
      { key: 'odds', path: '/odds', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !live && !finished, expectedData: false },
      { key: 'liveOdds', path: '/odds/live', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live, expectedData: false },
    ];
  }
  
  async function providerAuditCall(item, cfg) {
    if (!item.applicable) {
      return {
        key: item.key,
        label: providerEndpointLabel(item.key),
        state: 'not_applicable',
        results: null,
        latencyMs: null,
        note: 'Не применяется к текущему статусу матча.',
      };
    }
    const startedAt = Date.now();
    try {
      const data = await apiFootball(item.path, item.params, cfg);
      const results = Array.isArray(data) ? data.length : (data ? 1 : 0);
      const state = results > 0 ? 'available' : 'empty';
      return {
        key: item.key,
        label: providerEndpointLabel(item.key),
        state,
        results,
        latencyMs: Date.now() - startedAt,
        note: results > 0
          ? 'Данные возвращены.'
          : item.expectedData
            ? 'Метод API ответил без данных. Для этого матча покрытие может быть неполным.'
            : 'Пустой ответ допустим для этого метода API и конкретного матча.',
      };
    } catch (error) {
      return {
        key: item.key,
        label: providerEndpointLabel(item.key),
        state: 'error',
        results: null,
        latencyMs: Date.now() - startedAt,
        code: String(error?.code || 'ERROR'),
        note: redactOpsString(error?.message || 'Ошибка метода API.', 160),
      };
    }
  }
  
  function providerAuditScore(endpoints) {
    const relevant = (endpoints || []).filter(x => x.state !== 'not_applicable');
    if (!relevant.length) return 0;
    const points = relevant.reduce((sum, x) => {
      if (x.state === 'available') return sum + 1;
      if (x.state === 'empty') return sum + 0.6;
      return sum;
    }, 0);
    return Math.round(points / relevant.length * 100);
  }
  
  
  

  return {
    providerFailureState,
    providerDataState,
    providerDataReliabilitySummary,
    providerDataReliabilitySelfTest,
    analysisProviderFetch,
    providerFeatureFetch,
    providerValidationStep,
    providerValidationStatus,
    providerFeatureSourcesSummary,
    responseJsonSafe,
    loadLastProviderE2E,
    saveProviderE2E,
    providerEndpointLabel,
    providerAuditEndpointPlan,
    providerAuditCall,
    providerAuditScore,
  };
}
