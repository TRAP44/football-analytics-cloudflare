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

  const PROVIDER_FEATURE_CACHE_VERSION = 'v5.0';
  const ANALYSIS_PROVIDER_CACHE_VERSION = 'v2';

  function positiveSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function rowsOrEmpty(value) {
    return Array.isArray(value) ? value : [];
  }

  function boundedRetryAfter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? Math.min(86400, Math.max(1, Math.ceil(number)))
      : null;
  }

  function boundedTtlSeconds(value, fallback = 600) {
    const number = Number(value);
    const safeFallback = Number.isFinite(Number(fallback))
      ? Math.min(86400, Math.max(15, Math.ceil(Number(fallback))))
      : 600;
    return Number.isFinite(number) && number > 0
      ? Math.min(86400, Math.max(15, Math.ceil(number)))
      : safeFallback;
  }

  function normalizedFeatureName(value) {
    const feature = String(value || '').trim();
    return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(feature) ? feature : '';
  }

  function providerCacheEnvelope(payload, fixtureId, feature) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (positiveSafeInteger(payload.fixtureId) !== fixtureId) return null;
    if (String(payload.feature || '') !== feature) return null;
    if (!Array.isArray(payload.data)) return null;
    return payload;
  }

  function providerCacheKey(feature, fixtureId, shared = true) {
    return shared
      ? `provider-feature:${feature}:${fixtureId}:${PROVIDER_FEATURE_CACHE_VERSION}`
      : `analysis-provider:${feature}:${fixtureId}:${ANALYSIS_PROVIDER_CACHE_VERSION}`;
  }

  function providerFailureState(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const status = Number(error?.status);
    if (isFootballRateLimitError(error)) return 'rate_limited';
    if (code === 'UPSTREAM_TIMEOUT') return 'timeout';
    if (code === 'FOOTBALL_CONFIG' || (code === 'FOOTBALL_HTTP' && status === 401)) return 'configuration';
    if (
      (code === 'FOOTBALL_HTTP' && status === 403) ||
      /free plans? do not have access|\bplan\b|subscription|not have access|access denied|forbidden/i.test(message)
    ) return 'plan_limited';
    if (code === 'FOOTBALL_NETWORK') return 'network_error';
    if (code === 'FOOTBALL_INVALID_RESPONSE') return 'invalid_response';
    if (code.startsWith('FOOTBALL_')) return 'provider_error';
    return 'error';
  }
  
  function providerDataState(data, options = {}) {
    const arrayResponse = Array.isArray(data);
    const malformedResponse = data !== null && data !== undefined && !arrayResponse;
    const rows = rowsOrEmpty(data);
    const attempted = options.attempted !== false;
    const reason = String(options.reason || '');
    const error = options.error || null;
    const state = !attempted
      ? 'skipped'
      : error
        ? providerFailureState(error)
        : malformedResponse
          ? 'invalid_response'
          : rows.length
            ? 'available'
            : 'empty_response';
    return {
      state,
      available: state === 'available',
      observed: state === 'available' || state === 'empty_response',
      usable: state === 'available',
      degraded: ['rate_limited','timeout','configuration','plan_limited','network_error','invalid_response','provider_error','error'].includes(state),
      reason: reason || (
        error
          ? String(error?.code || state)
          : malformedResponse
            ? 'invalid_data_shape'
            : state === 'empty_response'
              ? 'empty_response'
              : ''
      ),
      retryAfter: boundedRetryAfter(error?.retryAfter),
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
    const safeFeature = normalizedFeatureName(feature);
    const safeFixtureId = positiveSafeInteger(fixtureId);
    if (!safeFeature || safeFixtureId === null) {
      return {
        data: [],
        meta: {
          feature: safeFeature || String(feature || '').slice(0, 40),
          provider: 'api-football',
          source: 'skipped',
          fetchedAt: null,
          ...providerDataState([], {
            attempted: false,
            reason: safeFixtureId === null ? 'invalid_fixture' : 'invalid_feature',
          }),
        },
      };
    }

    const ttlSeconds = boundedTtlSeconds(({
      injuries:1800,
      predictions:1800,
      odds:600,
      h2h:21600,
      lineups:300,
    })[safeFeature], 600);
    const sharedFeature = ['injuries','lineups'].includes(safeFeature);
    const cacheKey = providerCacheKey(safeFeature, safeFixtureId, sharedFeature);

    const freshEntry = await getCacheEntry(cacheKey,cfg,false).catch(()=>null);
    const fresh = providerCacheEnvelope(freshEntry?.payload, safeFixtureId, safeFeature);
    if (fresh) {
      const data = rowsOrEmpty(fresh.data);
      return {
        data,
        meta:{
          feature:safeFeature,
          provider:fresh.provider || 'api-football',
          source:'cache',
          fetchedAt:fresh.fetchedAt || null,
          ageSeconds:featureCacheAgeSeconds(fresh),
          expiresAt:freshEntry.expiresAt || null,
          ...providerDataState(data,{attempted:true}),
        },
      };
    }

    const staleEntry = await getCacheEntry(cacheKey,cfg,true).catch(()=>null);
    const stale = providerCacheEnvelope(staleEntry?.payload, safeFixtureId, safeFeature);
    if (!allowed) {
      if (stale) {
        const data = rowsOrEmpty(stale.data);
        return {
          data,
          meta:{
            feature:safeFeature,
            provider:stale.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale),
            expiresAt:staleEntry.expiresAt || null,
            ...providerDataState(data,{attempted:true,reason:skipReason || 'policy'}),
            state:'stale',
            available:false,
            usable:false,
            degraded:true,
            reason:skipReason || 'policy',
          },
        };
      }
      const meta = providerDataState([], { attempted: false, reason: skipReason || 'policy' });
      return { data: [], meta: { feature:safeFeature, provider:'api-football', source:'skipped', fetchedAt:null, ...meta } };
    }

    try {
      const rawData = await apiFootball(path, params, cfg);
      const data = rowsOrEmpty(rawData);
      const shape = providerDataState(rawData, { attempted:true });
      if (shape.state === 'invalid_response') {
        return {
          data:[],
          meta:{
            feature:safeFeature,
            provider:'api-football',
            source:'error',
            fetchedAt:new Date().toISOString(),
            ...shape,
          },
        };
      }
      const wrapped={
        fixtureId:safeFixtureId,
        feature:safeFeature,
        data,
        provider:'api-football',
        fetchedAt:new Date().toISOString(),
      };
      await setCache(cacheKey,safeFixtureId,wrapped,cfg,ttlSeconds/60).catch(()=>null);
      return {
        data,
        meta:{
          feature:safeFeature,
          provider:'api-football',
          source:'network',
          fetchedAt:wrapped.fetchedAt,
          ageSeconds:0,
          ...shape,
        },
      };
    } catch (error) {
      if (stale) {
        const data = rowsOrEmpty(stale.data);
        return {
          data,
          meta:{
            feature:safeFeature,
            provider:stale.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale),
            expiresAt:staleEntry.expiresAt || null,
            ...providerDataState(data,{attempted:true,error}),
            state:'stale',
            available:false,
            usable:false,
            degraded:true,
            reason:String(error?.code || 'api_error'),
          },
        };
      }
      const meta = providerDataState([], { attempted:true, error });
      return { data:[], meta:{ feature:safeFeature, provider:'api-football', source:'error', fetchedAt:null, ...meta } };
    }
  }

  async function providerFeatureFetch({ feature, path, params, fixtureId, cfg, context = {} }) {
    const safeFeature = normalizedFeatureName(feature);
    const safeFixtureId = positiveSafeInteger(fixtureId);
    if (!safeFeature || safeFixtureId === null) {
      if (safeFeature) providerFeatureCounter(safeFeature, 'skipped');
      return {
        data:[],
        meta:{
          feature:safeFeature || String(feature || '').slice(0,40),
          provider:'api-football',
          source:'skipped',
          fetchedAt:null,
          ageSeconds:null,
          expiresAt:null,
          ...providerDataState([], {
            attempted:false,
            reason:safeFixtureId === null ? 'invalid_fixture' : 'invalid_feature',
          }),
        },
      };
    }

    const rawPolicy = providerFeaturePolicy(safeFeature, context) || {};
    const policy = {
      ...rawPolicy,
      feature:safeFeature,
      allowed:rawPolicy.allowed !== false,
      reason:String(rawPolicy.reason || ''),
      ttlSeconds:boundedTtlSeconds(rawPolicy.ttlSeconds, 600),
    };
    const cacheKey = providerCacheKey(safeFeature, safeFixtureId, true);

    const freshEntry = await getCacheEntry(cacheKey, cfg, false).catch(() => null);
    const fresh = providerCacheEnvelope(freshEntry?.payload, safeFixtureId, safeFeature);
    if (fresh) {
      providerFeatureCounter(safeFeature, 'cache');
      const data = rowsOrEmpty(fresh.data);
      return {
        data,
        meta: {
          feature:safeFeature,
          provider:fresh.provider || 'api-football',
          source:'cache',
          fetchedAt:fresh.fetchedAt || null,
          ageSeconds:featureCacheAgeSeconds(fresh),
          expiresAt:freshEntry.expiresAt || null,
          policy,
          ...providerDataState(data, { attempted:true }),
        },
      };
    }

    const staleEntry = await getCacheEntry(cacheKey, cfg, true).catch(() => null);
    const stale = providerCacheEnvelope(staleEntry?.payload, safeFixtureId, safeFeature);

    if (!policy.allowed) {
      providerFeatureCounter(safeFeature, 'skipped');
      if (stale) {
        providerFeatureCounter(safeFeature, 'stale');
        const data = rowsOrEmpty(stale.data);
        return {
          data,
          meta: {
            feature:safeFeature,
            provider:stale.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale),
            expiresAt:staleEntry.expiresAt || null,
            policy,
            ...providerDataState(data, { attempted:true, reason:policy.reason }),
            state:'stale',
            available:false,
            usable:false,
            degraded:true,
            reason:policy.reason || 'policy',
          },
        };
      }
      return {
        data:[],
        meta:{
          feature:safeFeature,
          provider:'api-football',
          source:'skipped',
          fetchedAt:null,
          ageSeconds:null,
          expiresAt:null,
          policy,
          ...providerDataState([], { attempted:false, reason:policy.reason || 'policy' }),
        },
      };
    }

    try {
      const rawData = await apiFootball(path, params, cfg);
      const data = rowsOrEmpty(rawData);
      const shape = providerDataState(rawData, { attempted:true });
      if (shape.state === 'invalid_response') {
        providerFeatureCounter(safeFeature, 'skipped');
        return {
          data:[],
          meta:{
            feature:safeFeature,
            provider:'api-football',
            source:'error',
            fetchedAt:new Date().toISOString(),
            ageSeconds:0,
            expiresAt:null,
            policy,
            ...shape,
          },
        };
      }
      const wrapped={
        fixtureId:safeFixtureId,
        feature:safeFeature,
        data,
        provider:'api-football',
        fetchedAt:new Date().toISOString(),
      };
      await setCache(cacheKey,safeFixtureId,wrapped,cfg,policy.ttlSeconds/60).catch(() => null);
      providerFeatureCounter(safeFeature, 'api');
      return {
        data,
        meta:{
          feature:safeFeature,
          provider:'api-football',
          source:'network',
          fetchedAt:wrapped.fetchedAt,
          ageSeconds:0,
          expiresAt:new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(),
          policy,
          ...shape,
        },
      };
    } catch (error) {
      if (stale) {
        providerFeatureCounter(safeFeature, 'stale');
        const data = rowsOrEmpty(stale.data);
        return {
          data,
          meta:{
            feature:safeFeature,
            provider:stale.provider || 'api-football',
            source:'stale',
            fetchedAt:stale.fetchedAt || null,
            ageSeconds:featureCacheAgeSeconds(stale),
            expiresAt:staleEntry.expiresAt || null,
            policy,
            ...providerDataState(data, { attempted:true, error }),
            state:'stale',
            available:false,
            usable:false,
            degraded:true,
            reason:String(error?.code || 'api_error'),
          },
        };
      }
      providerFeatureCounter(safeFeature, 'skipped');
      return {
        data:[],
        meta:{
          feature:safeFeature,
          provider:'api-football',
          source:'error',
          fetchedAt:null,
          ageSeconds:null,
          expiresAt:null,
          policy,
          ...providerDataState([], { attempted:true, error }),
        },
      };
    }
  }
  
  
  function providerValidationStep(key, label, state, note, meta = {}) {
    return { key, label, state, note, meta };
  }
  
  function providerValidationStatus(steps = []) {
    const rows = Array.isArray(steps) ? steps : [];
    const allowedStates = new Set(['pass','warn','hold','fail']);
    const malformed = rows.length === 0 || rows.some(step => !allowedStates.has(String(step?.state || '')));
    const blocking = rows.filter(x => x?.state === 'fail');
    const holds = rows.filter(x => x?.state === 'hold');
    const warnings = rows.filter(x => x?.state === 'warn');
    if (malformed || blocking.length) return { code:'NEEDS_ATTENTION', label:'Нужна проверка', ready:false };
    if (holds.length) return { code:'HOLD', label:'Ожидает расширенный тариф', ready:false };
    if (warnings.length) return { code:'READY_WITH_LIMITATIONS', label:'Готово с ограничениями', ready:true };
    return { code:'READY', label:'Готово к расширенному режиму', ready:true };
  }
  
  function providerFeatureSourcesSummary(dataFreshness = {}) {
    const summary = { api:0, cache:0, embedded:0, stale:0, skipped:0, error:0, other:0 };
    const values = dataFreshness && typeof dataFreshness === 'object' && !Array.isArray(dataFreshness)
      ? Object.values(dataFreshness)
      : [];
    for (const meta of values) {
      const source = String(meta?.source || 'other').trim().toLowerCase();
      const bucket = source === 'network' || source === 'api' ? 'api'
        : source === 'stale-cache' || source === 'stale' ? 'stale'
          : source in summary ? source : 'other';
      summary[bucket] += 1;
    }
    return summary;
  }
  
  async function responseJsonSafe(response) {
    try { return await response.json(); } catch { return null; }
  }
  
  async function loadLastProviderE2E(cfg) {
    if (memory.providerE2E?.last && typeof memory.providerE2E.last === 'object' && !Array.isArray(memory.providerE2E.last)) {
      return memory.providerE2E.last;
    }
    const cached = await getCache('provider-e2e:last:v5.0', cfg).catch(() => null);
    const valid = cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : null;
    memory.providerE2E ||= { last:null };
    if (valid) memory.providerE2E.last = valid;
    return valid;
  }
  
  async function saveProviderE2E(result, fixtureId, cfg) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const safeFixtureId = positiveSafeInteger(fixtureId);
    memory.providerE2E ||= { last:null };
    memory.providerE2E.last = result;
    await setCache('provider-e2e:last:v5.0', safeFixtureId, result, cfg, 1440).catch(() => null);
    return true;
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
    const fixtureId = positiveSafeInteger(fixture?.fixture?.id);
    const validFixture = fixtureId !== null;
    const status = String(fixture?.fixture?.status?.short || '').toUpperCase();
    const live = validFixture && isLiveStatus(status);
    const finished = validFixture && isFinishedStatus(status);
    const kickoffMs = Date.parse(fixture?.fixture?.date || '');
    const minsToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
    const lineupsExpected = validFixture && (live || finished || (minsToKickoff !== null && minsToKickoff <= 120));
    const params = { fixture: fixtureId };
    return [
      { key:'events', path:'/fixtures/events', params, applicable:validFixture && (live || finished), expectedData:live || finished },
      { key:'statistics', path:'/fixtures/statistics', params, applicable:validFixture && (live || finished), expectedData:live || finished },
      { key:'lineups', path:'/fixtures/lineups', params, applicable:lineupsExpected, expectedData:lineupsExpected },
      { key:'players', path:'/fixtures/players', params, applicable:validFixture && (live || finished), expectedData:live || finished },
      { key:'injuries', path:'/injuries', params, applicable:validFixture && !finished, expectedData:false },
      { key:'predictions', path:'/predictions', params, applicable:validFixture && !finished, expectedData:validFixture && !finished },
      { key:'odds', path:'/odds', params, applicable:validFixture && !live && !finished, expectedData:false },
      { key:'liveOdds', path:'/odds/live', params, applicable:validFixture && live, expectedData:false },
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
        expectedData:Boolean(item.expectedData),
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
        state:'error',
        results:null,
        expectedData:Boolean(item.expectedData),
        latencyMs:Date.now() - startedAt,
        code: String(error?.code || 'ERROR'),
        note: redactOpsString(error?.message || 'Ошибка метода API.', 160),
      };
    }
  }
  
  function providerAuditScore(endpoints) {
    const relevant = (Array.isArray(endpoints) ? endpoints : []).filter(x => x?.state !== 'not_applicable');
    if (!relevant.length) return 0;
    const points = relevant.reduce((sum, x) => {
      if (x?.state === 'available') return sum + 1;
      if (x?.state === 'empty') return sum + (x?.expectedData ? 0.35 : 0.7);
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
