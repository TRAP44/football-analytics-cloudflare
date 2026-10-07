export function createNewsImpactRecoveryRuntime(deps = {}) {
  const {
    NEWS_IMPACT_ACTION_CODES,
    NEWS_IMPACT_ACTION_LABELS,
    NEWS_IMPACT_ACTION_WINDOW_MINUTES,
    NEWS_IMPACT_DECISION_CODES,
    NEWS_IMPACT_FAILURE_CODES,
    NEWS_IMPACT_FAILURE_LABELS,
    NEWS_IMPACT_FUNNEL_DECISIONS,
    NEWS_IMPACT_FUNNEL_MIN_USERS,
    NEWS_IMPACT_FUNNEL_STABLE_USERS,
    NEWS_IMPACT_OUTCOME_CODES,
    NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,
    NEWS_IMPACT_RECOVERY_CODES,
    NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_LABELS,
    NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
    NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
    NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS,
    NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,
    NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,
    favoriteMatchTeamRow,
    footballBotKeyboard,
    hasSupabase,
    isFootballRateLimitError,
    memory,
    recordGrowthEvent,
    supaSelectPaged,
    telegramAnalysisHandoffParams,
    telegramApi,
    telegramWebAppUrl
  } = deps;

  function newsImpactDecisionCard(newsImpact = {}) {
    if (!newsImpact || typeof newsImpact!=='object' || Array.isArray(newsImpact) || newsImpact.requested!==true) return null;
    const compared=newsImpact.compared===true;
    const material=newsImpact.material===true;
    const stable=newsImpact.stable===true;
    const reason=typeof newsImpact.reasonCode==='string' ? newsImpact.reasonCode.trim() : '';
    if (compared && material) return {
      code:'material',icon:'🔴',label:'Существенное изменение',
      headline:'После новости свежая проверка обнаружила заметный сдвиг во входных данных AI.',
      action:'Открыть полный разбор и проверить обновлённый сценарий матча.',priority:4,
    };
    if (compared && stable) return {
      code:'stable',icon:'🟢',label:'Сценарий стабилен',
      headline:'После новости значимых изменений в AI-входах не найдено.',
      action:'Срочного действия нет; продолжайте следить за составами и рынком.',priority:1,
    };
    if (compared) return {
      code:'detail',icon:'🟡',label:'Изменились детали',
      headline:'Изменились отдельные данные, но основной AI-сценарий не сдвинулся существенно.',
      action:'Проверить изменившиеся блоки перед стартом матча.',priority:2,
    };
    if (reason==='snapshot_not_before_news') return {
      code:'guarded',icon:'🟦',label:'Причинность не подтверждается',
      headline:'Сохранённый AI-снимок не был сделан до новости, поэтому сравнение «до/после» нельзя трактовать как влияние новости.',
      action:'Текущий анализ станет новой базовой точкой.',priority:0,
    };
    if (reason==='baseline_missing') return {
      code:'baseline_missing',icon:'⚪',label:'Нет базового снимка',
      headline:'До новости не было сохранённого анализа для честного сравнения.',
      action:'Текущий анализ станет базой для следующей News Impact проверки.',priority:0,
    };
    return {
      code:'unavailable',icon:'🟠',label:'Перепроверка недоступна',
      headline:'Новость связана с матчем, но сравнительный расчёт сейчас не завершён.',
      action:'Повторить обновление AI позже.',priority:0,
    };
  }

  function cleanNewsImpactDecisionCode(value = '') {
    if (typeof value !== 'string') return '';
    const code=value.toLowerCase().trim();
    return NEWS_IMPACT_DECISION_CODES?.has?.(code) ? code : '';
  }
  
  function cleanNewsImpactActionCode(value = '') {
    if (typeof value !== 'string') return '';
    const code=value.toLowerCase().trim();
    return NEWS_IMPACT_ACTION_CODES?.has?.(code) ? code : '';
  }
  
  function newsImpactActionCallback(decision, action, fixtureId) {
    const d=cleanNewsImpactDecisionCode(decision);
    const a=cleanNewsImpactActionCode(action);
    const id=newsImpactPositiveId(fixtureId);
    return d && a && id ? `news:impact:${d}:${a}:${id}` : '';
  }
  
  function newsImpactTrackedAnalysisUrl(request, fixtureId, decision) {
    const d=cleanNewsImpactDecisionCode(decision);
    const id=newsImpactPositiveId(fixtureId);
    if (!d || !id) return '';
    try {
      const params=telegramAnalysisHandoffParams(id,'brief');
      if (!params || typeof params!=='object' || Array.isArray(params)) return '';
      return typeof telegramWebAppUrl==='function'
        ? telegramWebAppUrl(request,{
            ...params,
            newsImpactDecision:d,
            newsImpactAction:'full_ai',
          })
        : '';
    } catch {
      return '';
    }
  }
  
  function cleanNewsImpactRecoveryCode(value = '') {
    if (typeof value !== 'string') return '';
    const code=value.toLowerCase().trim();
    return NEWS_IMPACT_RECOVERY_CODES?.has?.(code) ? code : '';
  }
  
  function newsImpactRecoveryCallback(decision, action, recovery, fixtureId) {
    const d=cleanNewsImpactDecisionCode(decision);
    const a=cleanNewsImpactActionCode(action);
    const r=cleanNewsImpactRecoveryCode(recovery);
    const id=newsImpactPositiveId(fixtureId);
    return d && a && r && id ? `ni:r:${d}:${a}:${r}:${id}` : '';
  }
  
  function newsImpactRecoveryAnalysisUrl(request, fixtureId, decision, sourceAction = '', recovery = 'open_full_ai') {
    const d=cleanNewsImpactDecisionCode(decision);
    const source=cleanNewsImpactActionCode(sourceAction);
    const r=cleanNewsImpactRecoveryCode(recovery) || 'open_full_ai';
    const id=newsImpactPositiveId(fixtureId);
    if (!d || !id) return '';
    try {
      const params=telegramAnalysisHandoffParams(id,'brief');
      if (!params || typeof params!=='object' || Array.isArray(params)) return '';
      return typeof telegramWebAppUrl==='function'
        ? telegramWebAppUrl(request,{
            ...params,
            newsImpactDecision:d,
            newsImpactAction:'full_ai',
            newsImpactRecoveryCode:r,
            ...(source ? {newsImpactRecoveryFrom:source} : {}),
          })
        : '';
    } catch {
      return '';
    }
  }
  
  function newsImpactActionDrill() {
    const callback=newsImpactActionCallback('material','market',12345);
    return {
      pass:callback==='news:impact:material:market:12345'
        && newsImpactActionCallback('material','market',true)===''
        && newsImpactActionCallback('material','market','12345')==='news:impact:material:market:12345'
        && cleanNewsImpactDecisionCode('stable')==='stable'
        && cleanNewsImpactDecisionCode('other')===''
        && cleanNewsImpactActionCode('full_ai')==='full_ai'
        && cleanNewsImpactActionCode('raw_text')==='',
      cases:7,
    };
  }
  
  function newsImpactRowDecision(row = {}) {
    const metadata=row?.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata)
      ? row.metadata
      : null;
    return cleanNewsImpactDecisionCode(metadata?.decision);
  }
  
  function newsImpactRowAction(row = {}) {
    const metadata=row?.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata)
      ? row.metadata
      : null;
    return cleanNewsImpactActionCode(metadata?.action);
  }

  function newsImpactPositiveId(value) {
    if (typeof value==='number') return Number.isSafeInteger(value) && value>0 ? value : 0;
    if (typeof value!=='string') return 0;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return 0;
    const parsed=Number(raw);
    return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
  }

  function newsImpactFiniteNumber(value) {
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!raw) return null;
    const parsed=Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  
  function newsImpactCount(value) {
    const parsed=newsImpactFiniteNumber(value);
    return parsed!==null && Number.isSafeInteger(parsed) && parsed>=0 ? parsed : 0;
  }

  function newsImpactSampleThreshold(value, fallback) {
    const parsed=newsImpactFiniteNumber(value);
    return parsed!==null && Number.isSafeInteger(parsed) && parsed>0 ? parsed : fallback;
  }

  function newsImpactNonNegativeNumber(value, fallback = 0) {
    const parsed=newsImpactFiniteNumber(value);
    return parsed!==null && parsed>=0 ? parsed : fallback;
  }

  function newsImpactSignedNumber(value, fallback = 0) {
    const parsed=newsImpactFiniteNumber(value);
    return parsed!==null ? parsed : fallback;
  }

  function newsImpactPercentage(value, fallback = 0) {
    const parsed=newsImpactFiniteNumber(value);
    return parsed!==null && parsed>=0 && parsed<=100 ? parsed : fallback;
  }

  function newsImpactText(value, fallback = '') {
    return typeof value==='string' ? value : fallback;
  }

  function newsImpactDirection(value) {
    return ['increased','decreased','unchanged'].includes(value) ? value : 'unchanged';
  }

  function newsImpactConversionConfidence(actedUsers = 0, users = 0) {
    const n=newsImpactCount(users);
    const k=Math.min(n,newsImpactCount(actedUsers));
    const minUsers=newsImpactSampleThreshold(NEWS_IMPACT_FUNNEL_MIN_USERS,10);
    const stableUsers=Math.max(minUsers,newsImpactSampleThreshold(NEWS_IMPACT_FUNNEL_STABLE_USERS,30));
    if (!n) return {
      status:'empty',label:'нет данных',users:0,actedUsers:0,
      lowerPct:0,upperPct:0,eligibleForBottleneck:false,stable:false,
    };
    const z=1.96;
    const p=k/n;
    const denominator=1+(z*z/n);
    const center=(p+(z*z/(2*n)))/denominator;
    const margin=(z*Math.sqrt((p*(1-p)+(z*z/(4*n)))/n))/denominator;
    const lowerPct=Math.round(Math.max(0,center-margin)*1000)/10;
    const upperPct=Math.round(Math.min(1,center+margin)*1000)/10;
    const status=n>=stableUsers ? 'stable'
      : n>=minUsers ? 'early'
        : 'insufficient';
    const label=status==='stable' ? 'устойчивая выборка'
      : status==='early' ? 'ранний сигнал'
        : 'мало данных';
    return {
      status,label,users:n,actedUsers:k,lowerPct,upperPct,
      eligibleForBottleneck:n>=minUsers,
      stable:n>=stableUsers,
    };
  }
  
  function newsImpactEventTime(row = {}) {
    const createdAt=typeof row?.created_at==='string' ? row.created_at.trim() : '';
    if (!createdAt) return NaN;
    const at=Date.parse(createdAt);
    return Number.isFinite(at) ? at : NaN;
  }
  
  function buildNewsImpactActionFunnel(decisionRows = [], actionRows = [], options = {}) {
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const optionAsOf=newsImpactFiniteNumber(safeOptions.asOfMs);
    const asOfMs=optionAsOf ?? Date.now();
    const configuredWindow=newsImpactFiniteNumber(safeOptions.actionWindowMinutes);
    const defaultWindow=newsImpactFiniteNumber(NEWS_IMPACT_ACTION_WINDOW_MINUTES) ?? 30;
    const actionWindowMinutes=Math.max(1,Math.min(180,configuredWindow ?? defaultWindow));
    const actionWindowMs=actionWindowMinutes*60_000;
    const maturityCutoff=asOfMs-actionWindowMs;
    const safeDecisionRows=Array.isArray(decisionRows) ? decisionRows : [];
    const safeActionRows=Array.isArray(actionRows) ? actionRows : [];
    const funnelDecisions=Array.isArray(NEWS_IMPACT_FUNNEL_DECISIONS) ? NEWS_IMPACT_FUNNEL_DECISIONS : [];
    return funnelDecisions
      .filter(row=>Array.isArray(row) && typeof row[0]==='string' && typeof row[1]==='string')
      .map(([code,label])=>{
      const observedDecisionUsers=new Set();
      const decisionTimesByUser=new Map();
      for (const row of safeDecisionRows) {
        if (newsImpactRowDecision(row)!==code) continue;
        const uid=newsImpactPositiveId(row?.telegram_id);
        const decisionAt=newsImpactEventTime(row);
        if (!uid) continue;
        observedDecisionUsers.add(uid);
        if (!Number.isFinite(decisionAt) || decisionAt>maturityCutoff) continue;
        const times=decisionTimesByUser.get(uid) || [];
        times.push(decisionAt);
        decisionTimesByUser.set(uid,times);
      }
      const decisionUsers=new Set(decisionTimesByUser.keys());
      const immatureUsers=[...observedDecisionUsers].filter(uid=>!decisionUsers.has(uid)).length;
      const actionUsersByCode={};
      for (const action of NEWS_IMPACT_ACTION_CODES) actionUsersByCode[action]=new Set();
      for (const row of safeActionRows) {
        if (newsImpactRowDecision(row)!==code) continue;
        const uid=newsImpactPositiveId(row?.telegram_id);
        const action=newsImpactRowAction(row);
        const actionAt=newsImpactEventTime(row);
        if (!uid || !action || !decisionUsers.has(uid) || !Number.isFinite(actionAt)) continue;
        const decisionTimes=decisionTimesByUser.get(uid) || [];
        const attributed=decisionTimes.some(decisionAt=>actionAt>=decisionAt && actionAt<=decisionAt+actionWindowMs);
        if (!attributed) continue;
        actionUsersByCode[action].add(uid);
      }
      const actedUsers=new Set();
      for (const set of Object.values(actionUsersByCode)) for (const uid of set) actedUsers.add(uid);
      const actionBreakdown=Object.entries(actionUsersByCode)
        .map(([action,set])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,users:set.size}))
        .filter(x=>x.users>0)
        .sort((a,b)=>b.users-a.users || a.action.localeCompare(b.action));
      const users=decisionUsers.size;
      const conversionPct=users ? Math.round((actedUsers.size/users)*1000)/10 : 0;
      const confidence=newsImpactConversionConfidence(actedUsers.size,users);
      return {
        code,label,
        observedUsers:observedDecisionUsers.size,
        users,
        immatureUsers,
        actedUsers:actedUsers.size,
        conversionPct,
        dropPct:users ? Math.max(0,Math.round((100-conversionPct)*10)/10) : 0,
        actionWindowMinutes,
        topAction:actionBreakdown[0] || null,
        actions:actionBreakdown,
        confidence,
      };
    });
  }
  
  function newsImpactActionFunnelBottleneck(rows = []) {
    const minUsers=newsImpactSampleThreshold(NEWS_IMPACT_FUNNEL_MIN_USERS,10);
    const eligible=(Array.isArray(rows) ? rows : []).filter(x=>{
      if (!x || typeof x!=='object' || Array.isArray(x) || x?.confidence?.eligibleForBottleneck!==true) return false;
      const users=newsImpactCount(x.users);
      const conversionPct=newsImpactFiniteNumber(x.conversionPct);
      return users>=minUsers
        && conversionPct!==null
        && conversionPct>=0
        && conversionPct<=100;
    });
    if (!eligible.length) return null;
    return [...eligible].sort((a,b)=>{
      const aPct=newsImpactFiniteNumber(a.conversionPct) ?? 100;
      const bPct=newsImpactFiniteNumber(b.conversionPct) ?? 100;
      return aPct-bPct || newsImpactCount(b.users)-newsImpactCount(a.users);
    })[0] || null;
  }
  
  function newsImpactActionFunnelDrill() {
    const asOfMs=Date.parse('2026-09-23T12:00:00Z');
    const matureAt='2026-09-23T10:00:00Z';
    const actionsAt='2026-09-23T10:10:00Z';
    const decisions=[
      ...Array.from({length:10},(_,i)=>({telegram_id:i+1,created_at:matureAt,metadata:{decision:'material'}})),
      ...Array.from({length:30},(_,i)=>({telegram_id:i+11,created_at:matureAt,metadata:{decision:'stable'}})),
    ];
    const actions=[
      ...Array.from({length:5},(_,i)=>({telegram_id:i+1,created_at:actionsAt,metadata:{decision:'material',action:'market'}})),
      ...Array.from({length:30},(_,i)=>({telegram_id:i+11,created_at:actionsAt,metadata:{decision:'stable',action:'full_ai'}})),
      {telegram_id:999,created_at:actionsAt,metadata:{decision:'material',action:'share'}},
    ];
    const rows=buildNewsImpactActionFunnel(decisions,actions,{asOfMs});
    const material=rows.find(x=>x.code==='material');
    const stable=rows.find(x=>x.code==='stable');
    const bottleneck=newsImpactActionFunnelBottleneck(rows);
    return {
      pass:material?.users===10
        && material?.actedUsers===5
        && material?.conversionPct===50
        && material?.topAction?.action==='market'
        && material?.confidence?.status==='early'
        && stable?.conversionPct===100
        && stable?.confidence?.status==='stable'
        && bottleneck?.code==='material',
      cases:8,
    };
  }
  
  function newsImpactTemporalAttributionDrill() {
    const asOfMs=Date.parse('2026-09-23T12:00:00Z');
    const decisions=[
      {telegram_id:1,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
      {telegram_id:2,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
      {telegram_id:3,created_at:'2026-09-23T11:50:00Z',metadata:{decision:'material'}},
    ];
    const actions=[
      {telegram_id:1,created_at:'2026-09-23T09:59:00Z',metadata:{decision:'material',action:'market'}},
      {telegram_id:1,created_at:'2026-09-23T10:10:00Z',metadata:{decision:'material',action:'market'}},
      {telegram_id:2,created_at:'2026-09-23T10:45:00Z',metadata:{decision:'material',action:'full_ai'}},
      {telegram_id:3,created_at:'2026-09-23T11:55:00Z',metadata:{decision:'material',action:'share'}},
    ];
    const row=buildNewsImpactActionFunnel(decisions,actions,{asOfMs}).find(x=>x.code==='material');
    return {
      pass:row?.observedUsers===3
        && row?.users===2
        && row?.immatureUsers===1
        && row?.actedUsers===1
        && row?.market===undefined
        && row?.topAction?.action==='market'
        && row?.actionWindowMinutes===30,
      cases:7,
    };
  }
  
  function newsImpactOutcomeCode(action = '') {
    return NEWS_IMPACT_OUTCOME_CODES[cleanNewsImpactActionCode(action)] || '';
  }
  
  async function recordNewsImpactOutcome(cfg,{
    userId,
    fixtureId,
    decision,
    action,
    channel='telegram',
    delivery='',
  }={}) {
    const safeUserId=newsImpactPositiveId(userId);
    const safeFixtureId=newsImpactPositiveId(fixtureId);
    const safeDecision=cleanNewsImpactDecisionCode(decision);
    const safeAction=cleanNewsImpactActionCode(action);
    const outcome=newsImpactOutcomeCode(safeAction);
    const safeChannel=typeof channel==='string' ? channel.trim().slice(0,24) : '';
    const safeDelivery=typeof delivery==='string' ? delivery.trim().slice(0,24) : '';
    if (!safeUserId || !safeFixtureId || !safeDecision || !safeAction || !outcome) return false;
    return await recordGrowthEvent(cfg,{
      userId:safeUserId,
      eventName:'news_impact_outcome',
      channel:safeChannel || 'telegram',
      fixtureId:safeFixtureId,
      metadata:{
        decision:safeDecision,
        action:safeAction,
        outcome,
        ...(safeDelivery ? {delivery:safeDelivery} : {}),
      },
    });
  }
  
  function newsImpactJourneyKey(row = {}) {
    const uid=newsImpactPositiveId(row?.telegram_id);
    const fixtureId=newsImpactPositiveId(row?.fixture_id);
    const decision=newsImpactRowDecision(row);
    const action=newsImpactRowAction(row);
    return uid && fixtureId && decision && action ? `${uid}|${fixtureId}|${decision}|${action}` : '';
  }
  
  function buildNewsImpactActionOutcomeQuality(actionRows = [], outcomeRows = [], options = {}) {
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const optionAsOf=newsImpactFiniteNumber(safeOptions.asOfMs);
    const asOfMs=optionAsOf ?? Date.now();
    const configuredWindow=newsImpactFiniteNumber(safeOptions.outcomeWindowMinutes);
    const defaultWindow=newsImpactFiniteNumber(NEWS_IMPACT_OUTCOME_WINDOW_MINUTES) ?? 5;
    const outcomeWindowMinutes=Math.max(1,Math.min(30,configuredWindow ?? defaultWindow));
    const outcomeWindowMs=outcomeWindowMinutes*60_000;
    const safeActionRows=Array.isArray(actionRows) ? actionRows : [];
    const safeOutcomeRows=Array.isArray(outcomeRows) ? outcomeRows : [];
    const actionCodes=NEWS_IMPACT_ACTION_CODES instanceof Set
      ? [...NEWS_IMPACT_ACTION_CODES]
      : Array.isArray(NEWS_IMPACT_ACTION_CODES)
        ? NEWS_IMPACT_ACTION_CODES.filter(code=>typeof code==='string')
        : [];
    const actionByKey=new Map();
    for (const row of safeActionRows) {
      const key=newsImpactJourneyKey(row);
      const actionAt=newsImpactEventTime(row);
      if (!key || !Number.isFinite(actionAt)) continue;
      const existing=actionByKey.get(key);
      if (!existing || actionAt<existing.actionAt) actionByKey.set(key,{row,actionAt});
    }
    const confirmed=new Set();
    const outcomeCodesByKey=new Map();
    for (const row of safeOutcomeRows) {
      const key=newsImpactJourneyKey(row);
      const outcomeAt=newsImpactEventTime(row);
      const action=actionByKey.get(key);
      if (!key || !action || !Number.isFinite(outcomeAt)) continue;
      if (outcomeAt<action.actionAt || outcomeAt>action.actionAt+outcomeWindowMs) continue;
      const metadata=row?.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata)
        ? row.metadata
        : null;
      const code=typeof metadata?.outcome==='string' ? metadata.outcome.slice(0,32) : '';
      const expected=newsImpactOutcomeCode(newsImpactRowAction(action.row));
      if (!code || !expected || code!==expected) continue;
      confirmed.add(key);
      outcomeCodesByKey.set(key,code);
    }
    return actionCodes.map(actionCode=>{
      const observed=[...actionByKey.entries()].filter(([,value])=>newsImpactRowAction(value.row)===actionCode);
      const eligible=observed.filter(([key,value])=>confirmed.has(key) || value.actionAt<=asOfMs-outcomeWindowMs);
      const confirmedKeys=eligible.filter(([key])=>confirmed.has(key)).map(([key])=>key);
      const attempts=eligible.length;
      const confirmedOutcomes=confirmedKeys.length;
      const pending=Math.max(0,observed.length-attempts);
      const completionPct=attempts ? Math.round((confirmedOutcomes/attempts)*1000)/10 : 0;
      const confidence=newsImpactConversionConfidence(confirmedOutcomes,attempts);
      const outcomes={};
      for (const key of confirmedKeys) {
        const code=outcomeCodesByKey.get(key) || newsImpactOutcomeCode(actionCode);
        outcomes[code]=(outcomes[code] || 0)+1;
      }
      return {
        action:actionCode,
        label:NEWS_IMPACT_ACTION_LABELS?.[actionCode] || actionCode,
        observed:observed.length,
        attempts,
        pending,
        confirmed:confirmedOutcomes,
        completionPct,
        confidence,
        outcomes,
      };
    });
  }
  
  function newsImpactOutcomeBottleneck(rows = []) {
    const eligible=(Array.isArray(rows) ? rows : []).filter(x=>
      x
      && typeof x==='object'
      && !Array.isArray(x)
      && x?.confidence?.eligibleForBottleneck===true
      && newsImpactFiniteNumber(x.completionPct)!==null
      && newsImpactFiniteNumber(x.attempts)!==null
    );
    if (!eligible.length) return null;
    return [...eligible].sort((a,b)=>Number(a.completionPct || 0)-Number(b.completionPct || 0) || Number(b.attempts || 0)-Number(a.attempts || 0))[0] || null;
  }
  
  function newsImpactOutcomeQualityDrill() {
    const asOfMs=Date.parse('2026-09-23T12:00:00Z');
    const actions=[
      ...Array.from({length:10},(_,i)=>({telegram_id:i+1,fixture_id:100+i,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai'}})),
      {telegram_id:50,fixture_id:500,created_at:'2026-09-23T11:58:00Z',metadata:{decision:'stable',action:'share'}},
    ];
    const outcomes=[
      ...Array.from({length:8},(_,i)=>({telegram_id:i+1,fixture_id:100+i,created_at:'2026-09-23T10:01:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}})),
      {telegram_id:9,fixture_id:108,created_at:'2026-09-23T09:59:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}},
      {telegram_id:10,fixture_id:109,created_at:'2026-09-23T10:08:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}},
      {telegram_id:50,fixture_id:500,created_at:'2026-09-23T11:59:00Z',metadata:{decision:'stable',action:'share',outcome:'share_card_delivered'}},
    ];
    const quality=buildNewsImpactActionOutcomeQuality(actions,outcomes,{asOfMs});
    const fullAi=quality.find(x=>x.action==='full_ai');
    const share=quality.find(x=>x.action==='share');
    return {
      pass:fullAi?.attempts===10
        && fullAi?.confirmed===8
        && fullAi?.completionPct===80
        && fullAi?.confidence?.status==='early'
        && share?.attempts===1
        && share?.confirmed===1
        && share?.pending===0
        && newsImpactOutcomeBottleneck(quality)?.action==='full_ai',
      cases:8,
    };
  }
  
  function newsImpactKnownCode(value, set, fallback = '') {
    if (typeof value!=='string') return fallback;
    const code=value.trim().toLowerCase();
    return set?.has?.(code) ? code : fallback;
  }

  function newsImpactHttpStatus(value) {
    const status=newsImpactFiniteNumber(value);
    return status!==null && Number.isSafeInteger(status) && status>=100 && status<=599 ? status : 0;
  }

  function newsImpactFailureCode(error = null, fallback = 'server_error') {
    const payload=error?.payload && typeof error.payload==='object' && !Array.isArray(error.payload)
      ? error.payload
      : null;
    const status=newsImpactHttpStatus(error?.status)
      || newsImpactHttpStatus(error?.statusCode)
      || newsImpactHttpStatus(payload?.status);
    const code=typeof error?.code==='string'
      ? error.code.toLowerCase()
      : typeof payload?.code==='string'
        ? payload.code.toLowerCase()
        : '';
    const message=typeof error?.message==='string'
      ? error.message.toLowerCase()
      : typeof payload?.error==='string'
        ? payload.error.toLowerCase()
        : '';
    const text=`${code} ${message}`;
    let providerRateLimited=false;
    try {
      providerRateLimited=typeof isFootballRateLimitError==='function' && isFootballRateLimitError(error)===true;
    } catch {}
    if (providerRateLimited || /football.*(?:rate|limit)|provider.*(?:rate|limit)/.test(text)) return 'provider_rate_limit';
    if (/provider|api-football|upstream/.test(text) && /unavailable|failed|error|503|502/.test(text)) return 'provider_unavailable';
    if (/analysis_warming|warming|already.*calculat|уже рассчитывается/.test(text)) return 'analysis_warming';
    if (status===408 || /timeout|timed out|тайм-аут/.test(text)) return 'timeout';
    if (/match_data_invalid|data_invalid|противоречив/.test(text) || status===409) return 'data_invalid';
    if (/invalid.*fixture|некорректн.*матч/.test(text)) return 'invalid_fixture';
    if (/match.*not.*found|матч не найден|fixture.*not.*found/.test(text) || status===404) return 'match_missing';
    const safeFallback=newsImpactKnownCode(fallback,NEWS_IMPACT_FAILURE_CODES,'server_error');
    if (status===429) return safeFallback==='telegram_delivery' ? 'telegram_delivery' : 'quota_exhausted';
    if (/telegram/.test(text) || ([400,403].includes(status) && safeFallback==='telegram_delivery')) return 'telegram_delivery';
    return safeFallback;
  }
  
  function newsImpactRecoveryForFailure(reason = 'server_error', action = '') {
    const code=newsImpactKnownCode(reason,NEWS_IMPACT_FAILURE_CODES,'server_error');
    const safeAction=cleanNewsImpactActionCode(action);
    if (code==='quota_exhausted') return {code:'wait_quota_reset',action:'wait',message:'Дневной лимит AI исчерпан. Повторите после обновления лимита.'};
    if (code==='provider_rate_limit') return {code:'retry_later',action:'retry',message:'Источник футбольных данных временно ограничил запросы. Повторите позже.'};
    if (code==='provider_unavailable') return {code:'retry_later',action:'retry',message:'Источник данных временно недоступен. Попробуйте позже.'};
    if (code==='analysis_warming') return {code:'retry_soon',action:'retry',message:'AI-разбор уже рассчитывается. Повторите через несколько секунд.'};
    if (code==='match_missing' || code==='invalid_fixture') return {code:'open_search',action:'search',message:'Этот матч сейчас недоступен. Вернитесь к поиску и выберите актуальный матч.'};
    if (code==='data_invalid') return {code:'retry_later',action:'retry',message:'Данные матча сейчас противоречивы. Анализ безопаснее повторить позже.'};
    if (code==='timeout') return {code:'retry_soon',action:'retry',message:'Ответ занял слишком много времени. Повторите запрос.'};
    if (code==='telegram_delivery') return {code:safeAction==='full_ai'?'open_full_ai':'retry',action:safeAction==='full_ai'?'open_full_ai':'retry',message:'Не удалось доставить результат в Telegram. Можно повторить действие или открыть полный AI.'};
    return {code:'retry',action:'retry',message:'Результат временно не доставлен. Повторите действие.'};
  }
  
  async function recordNewsImpactFailure(cfg,{
    userId,
    fixtureId,
    decision,
    action,
    channel='telegram',
    reason='server_error',
    recovery='',
    strategy='fixed',
    strategyReason='',
    status=0,
  }={}) {
    const safeUserId=newsImpactPositiveId(userId);
    const safeFixtureId=newsImpactPositiveId(fixtureId);
    const safeDecision=cleanNewsImpactDecisionCode(decision);
    const safeAction=cleanNewsImpactActionCode(action);
    const safeReason=newsImpactKnownCode(reason,NEWS_IMPACT_FAILURE_CODES,'server_error');
    const recommended=newsImpactRecoveryForFailure(safeReason,safeAction);
    const safeRecovery=newsImpactKnownCode(recovery,NEWS_IMPACT_RECOVERY_CODES,recommended.code);
    const safeStrategy=strategy==='adaptive' ? 'adaptive' : 'fixed';
    const safeStrategyReason=newsImpactKnownCode(strategyReason,NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,'');
    const safeChannel=typeof channel==='string' ? channel.trim().slice(0,24) : '';
    const safeStatus=newsImpactHttpStatus(status);
    if (!safeUserId || !safeFixtureId || !safeDecision || !safeAction) return false;
    return await recordGrowthEvent(cfg,{
      userId:safeUserId,
      eventName:'news_impact_outcome_failure',
      channel:safeChannel || 'telegram',
      fixtureId:safeFixtureId,
      metadata:{
        decision:safeDecision,
        action:safeAction,
        reason:safeReason,
        recovery:safeRecovery,
        strategy:safeStrategy,
        ...(safeStrategyReason ? {strategy_guard:safeStrategyReason} : {}),
        ...(safeStatus ? {status:safeStatus} : {}),
      },
    });
  }
  
  function buildNewsImpactFailureDiagnostics(rows = []) {
    const byReason=new Map();
    const safeRows=Array.isArray(rows) ? rows : [];
    for (const row of safeRows) {
      if (!row || typeof row!=='object' || Array.isArray(row)) continue;
      const meta=row.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const reason=newsImpactKnownCode(meta.reason,NEWS_IMPACT_FAILURE_CODES,'server_error');
      const action=cleanNewsImpactActionCode(meta.action);
      const recovery=newsImpactKnownCode(
        meta.recovery,
        NEWS_IMPACT_RECOVERY_CODES,
        newsImpactRecoveryForFailure(reason,action).code,
      );
      const bucket=byReason.get(reason) || {
        reason,label:NEWS_IMPACT_FAILURE_LABELS?.[reason] || reason,events:0,users:new Set(),actions:{},recoveries:{},
      };
      bucket.events+=1;
      const uid=newsImpactPositiveId(row.telegram_id);
      if (uid) bucket.users.add(uid);
      if (action) bucket.actions[action]=(bucket.actions[action] || 0)+1;
      if (recovery) bucket.recoveries[recovery]=(bucket.recoveries[recovery] || 0)+1;
      byReason.set(reason,bucket);
    }
    return [...byReason.values()].map(x=>({
      reason:x.reason,label:x.label,events:x.events,users:x.users.size,
      actions:Object.entries(x.actions).map(([action,count])=>({action,label:NEWS_IMPACT_ACTION_LABELS?.[action] || action,count})).sort((a,b)=>b.count-a.count || a.action.localeCompare(b.action)),
      recoveries:Object.entries(x.recoveries).map(([recovery,count])=>({recovery,label:NEWS_IMPACT_RECOVERY_LABELS?.[recovery] || recovery,count})).sort((a,b)=>b.count-a.count || a.recovery.localeCompare(b.recovery)),
    })).sort((a,b)=>b.events-a.events || a.reason.localeCompare(b.reason));
  }
  
  function newsImpactFailureDiagnosticsDrill() {
    const rows=[
      {telegram_id:1,metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
      {telegram_id:2,metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
      {telegram_id:1,metadata:{decision:'stable',action:'share',reason:'telegram_delivery',recovery:'retry'}},
      {telegram_id:true,metadata:{decision:'stable',action:'share',reason:'telegram_delivery',recovery:'retry'}},
    ];
    const diagnostics=buildNewsImpactFailureDiagnostics(rows);
    const provider=diagnostics.find(x=>x.reason==='provider_rate_limit');
    const telegram=diagnostics.find(x=>x.reason==='telegram_delivery');
    const recovery=newsImpactRecoveryForFailure('analysis_warming','full_ai');
    return {
      pass:provider?.events===2
        && provider?.users===2
        && provider?.actions?.[0]?.action==='full_ai'
        && telegram?.events===2
        && telegram?.users===1
        && recovery?.code==='retry_soon'
        && newsImpactFailureCode({status:429,code:'ANALYSIS_WARMING'},'server_error')==='analysis_warming'
        && newsImpactFailureCode({status:429},'telegram_delivery')==='telegram_delivery'
        && newsImpactFailureCode({status:true},'server_error')==='server_error'
        && buildNewsImpactFailureDiagnostics({broken:true}).length===0,
      cases:10,
    };
  }
  
  async function recordNewsImpactRecoveryAttempt(cfg,{
    userId,
    fixtureId,
    decision,
    action,
    recovery,
    sourceAction='',
    channel='telegram',
  }={}) {
    const safeDecision=cleanNewsImpactDecisionCode(decision);
    const safeAction=cleanNewsImpactActionCode(action);
    const safeRecovery=cleanNewsImpactRecoveryCode(recovery);
    const safeSource=cleanNewsImpactActionCode(sourceAction);
    if (!safeDecision || !safeAction || !safeRecovery) return false;
    return await recordGrowthEvent(cfg,{
      userId,
      eventName:'news_impact_recovery_attempt',
      channel,
      fixtureId,
      metadata:{
        decision:safeDecision,
        action:safeAction,
        recovery:safeRecovery,
        ...(safeSource ? {sourceAction:safeSource} : {}),
      },
    });
  }
  
  function newsImpactRecoveryJourneyKey(row = {}) {
    const base=newsImpactJourneyKey(row);
    const recovery=cleanNewsImpactRecoveryCode(row?.metadata && typeof row.metadata==='object' ? row.metadata.recovery : '');
    return base && recovery ? `${base}|${recovery}` : '';
  }
  
  function buildNewsImpactRecoveryEffectiveness(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
    const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
    const windowMinutes=Math.max(1,Math.min(30,Number(options?.windowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)));
    const windowMs=windowMinutes*60_000;
    const latestAttempts=new Map();
    for (const row of attemptRows || []) {
      const key=newsImpactRecoveryJourneyKey(row);
      const attemptAt=newsImpactEventTime(row);
      if (!key || !Number.isFinite(attemptAt)) continue;
      const previous=latestAttempts.get(key);
      if (!previous || attemptAt>previous.attemptAt) latestAttempts.set(key,{row,attemptAt});
    }
    const outcomesByJourney=new Map();
    for (const row of outcomeRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=outcomesByJourney.get(key) || [];
      list.push({row,at});
      outcomesByJourney.set(key,list);
    }
    const failuresByJourney=new Map();
    for (const row of failureRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=failuresByJourney.get(key) || [];
      list.push({row,at});
      failuresByJourney.set(key,list);
    }
    const states=[...latestAttempts.values()].map(item=>{
      const journey=newsImpactJourneyKey(item.row);
      const recovery=cleanNewsImpactRecoveryCode(item.row?.metadata?.recovery);
      const after=(list)=>[...(list || [])]
        .filter(event=>event.at>=item.attemptAt && event.at<=item.attemptAt+windowMs)
        .sort((a,b)=>a.at-b.at)[0] || null;
      const outcome=after(outcomesByJourney.get(journey));
      const failure=after(failuresByJourney.get(journey));
      let state='pending';
      let terminalAt=null;
      if (outcome && (!failure || outcome.at<=failure.at)) { state='recovered'; terminalAt=outcome.at; }
      else if (failure) { state='failed'; terminalAt=failure.at; }
      else if (item.attemptAt<=asOfMs-windowMs) state='failed';
      return {row:item.row,recovery,state,attemptAt:item.attemptAt,terminalAt};
    });
    return [...NEWS_IMPACT_RECOVERY_CODES].map(recovery=>{
      const observed=states.filter(x=>x.recovery===recovery);
      const matured=observed.filter(x=>x.state!=='pending');
      const recovered=matured.filter(x=>x.state==='recovered').length;
      const failed=matured.filter(x=>x.state==='failed').length;
      const attempts=matured.length;
      const pending=observed.length-attempts;
      const successPct=attempts ? Math.round((recovered/attempts)*1000)/10 : 0;
      const confidence=newsImpactConversionConfidence(recovered,attempts);
      const actionCounts={};
      for (const item of observed) {
        const action=newsImpactRowAction(item.row);
        if (action) actionCounts[action]=(actionCounts[action] || 0)+1;
      }
      return {
        recovery,
        label:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
        observed:observed.length,
        attempts,
        pending,
        recovered,
        failed,
        successPct,
        confidence,
        actions:Object.entries(actionCounts).map(([action,count])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,count})).sort((a,b)=>b.count-a.count || a.action.localeCompare(b.action)),
      };
    });
  }
  
  function newsImpactRecoveryBest(rows = []) {
    const eligible=(rows || []).filter(x=>Boolean(x?.confidence?.eligibleForBottleneck));
    if (!eligible.length) return null;
    return [...eligible].sort((a,b)=>Number(b.successPct || 0)-Number(a.successPct || 0) || Number(b.attempts || 0)-Number(a.attempts || 0))[0] || null;
  }
  
  function newsImpactRecoveryEffectivenessDrill() {
    const asOfMs=Date.parse('2026-09-23T12:00:00Z');
    const attempts=[
      ...Array.from({length:10},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai',recovery:'retry'}})),
      ...Array.from({length:5},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:58:00Z',metadata:{decision:'detail',action:'full_ai',recovery:'open_full_ai'}})),
    ];
    const outcomes=[
      ...Array.from({length:7},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:02:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}})),
      ...Array.from({length:2},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:59:00Z',metadata:{decision:'detail',action:'full_ai',outcome:'analysis_delivered'}})),
    ];
    const failures=[
      {telegram_id:8,fixture_id:207,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
      {telegram_id:9,fixture_id:208,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'server_error',recovery:'retry'}},
    ];
    const rows=buildNewsImpactRecoveryEffectiveness(attempts,outcomes,failures,{asOfMs});
    const retry=rows.find(x=>x.recovery==='retry');
    const fullAi=rows.find(x=>x.recovery==='open_full_ai');
    return {
      pass:retry?.attempts===10
        && retry?.recovered===7
        && retry?.failed===3
        && retry?.successPct===70
        && retry?.confidence?.status==='early'
        && fullAi?.recovered===2
        && fullAi?.pending===3
        && newsImpactRecoveryBest(rows)?.recovery==='retry',
      cases:8,
    };
  }
  
  function newsImpactRecoveryPresentation(reason = 'server_error', action = '', recovery = '') {
    const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
    const safeAction=cleanNewsImpactActionCode(action);
    const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
    const code=cleanNewsImpactRecoveryCode(recovery) || fixed.code;
    if (code===fixed.code) return {...fixed};
    if (code==='retry') return {code,action:'retry',message:'Повторите действие — по накопленной статистике это сейчас наиболее надёжный вариант.'};
    if (code==='retry_soon') return {code,action:'retry',message:'Повторите действие через несколько секунд.'};
    if (code==='retry_later') return {code,action:'retry',message:'Попробуйте это действие позже.'};
    if (code==='wait_quota_reset') return {code,action:'wait',message:'Дождитесь обновления лимита и повторите действие.'};
    if (code==='open_search') return {code,action:'search',message:'Вернитесь к поиску и выберите актуальный матч.'};
    if (code==='open_full_ai') return {code,action:'open_full_ai',message:'Откройте полный AI-разбор — по накопленной статистике этот fallback доставляет результат надёжнее.'};
    return {...fixed};
  }
  
  function buildNewsImpactRecoveryStrategyEvidence(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
    const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
    const recoveryWindowMs=Math.max(1,Math.min(30,Number(options?.recoveryWindowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)))*60_000;
    const sourceWindowMs=Math.max(5,Math.min(180,Number(options?.sourceWindowMinutes || NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES)))*60_000;
    const latestAttempts=new Map();
    for (const row of attemptRows || []) {
      const key=newsImpactRecoveryJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const previous=latestAttempts.get(key);
      if (!previous || at>previous.at) latestAttempts.set(key,{row,at});
    }
    const failuresByJourney=new Map();
    for (const row of failureRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=failuresByJourney.get(key) || [];
      list.push({row,at});
      failuresByJourney.set(key,list);
    }
    for (const list of failuresByJourney.values()) list.sort((a,b)=>a.at-b.at);
    const outcomesByJourney=new Map();
    for (const row of outcomeRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=outcomesByJourney.get(key) || [];
      list.push({row,at});
      outcomesByJourney.set(key,list);
    }
    for (const list of outcomesByJourney.values()) list.sort((a,b)=>a.at-b.at);
  
    const samples=[];
    for (const {row,at:attemptAt} of latestAttempts.values()) {
      const journey=newsImpactJourneyKey(row);
      const recovery=cleanNewsImpactRecoveryCode(row?.metadata?.recovery);
      const action=newsImpactRowAction(row);
      if (!journey || !recovery || !action) continue;
      const priorFailures=(failuresByJourney.get(journey) || []).filter(x=>x.at<=attemptAt && x.at>=attemptAt-sourceWindowMs);
      const sourceFailure=priorFailures[priorFailures.length-1] || null;
      const reason=String(sourceFailure?.row?.metadata?.reason || '');
      if (!NEWS_IMPACT_FAILURE_CODES.has(reason)) continue;
      const nextOutcome=(outcomesByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
      const nextFailure=(failuresByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
      let state='pending';
      if (nextOutcome && (!nextFailure || nextOutcome.at<=nextFailure.at)) state='recovered';
      else if (nextFailure) state='failed';
      else if (attemptAt<=asOfMs-recoveryWindowMs) state='failed';
      samples.push({reason,action,recovery,state});
    }
  
    const groups=new Map();
    for (const sample of samples) {
      const key=`${sample.reason}|${sample.action}|${sample.recovery}`;
      const bucket=groups.get(key) || {
        reason:sample.reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS[sample.reason] || sample.reason,
        action:sample.action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS[sample.action] || sample.action,
        recovery:sample.recovery,
        recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[sample.recovery] || sample.recovery,
        observed:0,attempts:0,pending:0,recovered:0,failed:0,
      };
      bucket.observed+=1;
      if (sample.state==='pending') bucket.pending+=1;
      else {
        bucket.attempts+=1;
        if (sample.state==='recovered') bucket.recovered+=1;
        else bucket.failed+=1;
      }
      groups.set(key,bucket);
    }
    return [...groups.values()].map(x=>{
      const successPct=x.attempts ? Math.round((x.recovered/x.attempts)*1000)/10 : 0;
      return {...x,successPct,confidence:newsImpactConversionConfidence(x.recovered,x.attempts)};
    }).sort((a,b)=>a.reason.localeCompare(b.reason) || a.action.localeCompare(b.action) || b.attempts-a.attempts || a.recovery.localeCompare(b.recovery));
  }
  
  function newsImpactRecoveryStrategyDecision(reason = 'server_error', action = '', evidenceRows = [], recentEvidenceRows = null) {
    const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
    const safeAction=cleanNewsImpactActionCode(action);
    const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
    const relevant=(evidenceRows || []).filter(x=>x.reason===safeReason && x.action===safeAction);
    const baseline=relevant.find(x=>x.recovery===fixed.code) || null;
    const stable=(row)=>Boolean(row)
      && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS
      && row?.confidence?.status==='stable';
    const baseResult={
      reason:safeReason,
      reasonLabel:NEWS_IMPACT_FAILURE_LABELS[safeReason] || safeReason,
      action:safeAction,
      actionLabel:NEWS_IMPACT_ACTION_LABELS[safeAction] || safeAction,
      fixedRecovery:fixed.code,
      fixedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
      selectedRecovery:fixed.code,
      selectedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
      proposedRecovery:'',
      proposedRecoveryLabel:'',
      strategy:'fixed',
      guardReason:'fixed_default',
      stability:'fixed',
      fixedAttempts:Number(baseline?.attempts || 0),
      fixedSuccessPct:Number(baseline?.successPct || 0),
      fixedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
      selectedAttempts:Number(baseline?.attempts || 0),
      selectedSuccessPct:Number(baseline?.successPct || 0),
      selectedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
      liftPctPoints:0,
      recentFixedAttempts:0,
      recentFixedSuccessPct:0,
      recentSelectedAttempts:0,
      recentSelectedSuccessPct:0,
      recentLiftPctPoints:0,
    };
    if (!stable(baseline)) return {...baseResult,guardReason:'baseline_sample'};
    const candidates=relevant
      .filter(x=>x.recovery!==fixed.code && stable(x))
      .map(x=>({...x,liftPctPoints:Math.round((Number(x.successPct || 0)-Number(baseline.successPct || 0))*10)/10}))
      .filter(x=>Number(x.liftPctPoints || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS)
      .filter(x=>Number(x?.confidence?.lowerPct || 0)>Number(baseline?.confidence?.upperPct || 100))
      .sort((a,b)=>Number(b?.confidence?.lowerPct || 0)-Number(a?.confidence?.lowerPct || 0)
        || Number(b.successPct || 0)-Number(a.successPct || 0)
        || Number(b.attempts || 0)-Number(a.attempts || 0));
    const candidate=candidates[0] || null;
    if (!candidate) return {...baseResult,guardReason:'no_significant_better'};
    const adaptiveResult={
      ...baseResult,
      selectedRecovery:candidate.recovery,
      selectedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      proposedRecovery:candidate.recovery,
      proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      strategy:'adaptive',
      guardReason:'significant_better',
      stability:'legacy_confirmed',
      selectedAttempts:Number(candidate.attempts || 0),
      selectedSuccessPct:Number(candidate.successPct || 0),
      selectedConfidence:candidate.confidence,
      liftPctPoints:Number(candidate.liftPctPoints || 0),
    };
    if (!Array.isArray(recentEvidenceRows)) return adaptiveResult;
  
    const recentRelevant=recentEvidenceRows.filter(x=>x.reason===safeReason && x.action===safeAction);
    const recentBaseline=recentRelevant.find(x=>x.recovery===fixed.code) || null;
    const recentCandidate=recentRelevant.find(x=>x.recovery===candidate.recovery) || null;
    const recentReady=(row)=>Boolean(row) && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS;
    const proposed={
      ...baseResult,
      proposedRecovery:candidate.recovery,
      proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      liftPctPoints:Number(candidate.liftPctPoints || 0),
      recentFixedAttempts:Number(recentBaseline?.attempts || 0),
      recentFixedSuccessPct:Number(recentBaseline?.successPct || 0),
      recentSelectedAttempts:Number(recentCandidate?.attempts || 0),
      recentSelectedSuccessPct:Number(recentCandidate?.successPct || 0),
    };
    if (!recentReady(recentBaseline) || !recentReady(recentCandidate)) {
      return {...proposed,guardReason:'stability_sample',stability:'insufficient'};
    }
    const recentLiftPctPoints=Math.round((Number(recentCandidate.successPct || 0)-Number(recentBaseline.successPct || 0))*10)/10;
    const recentConfidenceOk=Number(recentCandidate?.confidence?.lowerPct || 0)>=Number(recentBaseline?.confidence?.lowerPct || 0);
    if (recentLiftPctPoints<0 || !recentConfidenceOk) {
      return {...proposed,guardReason:'recent_regression',stability:'regressed',recentLiftPctPoints};
    }
    return {
      ...adaptiveResult,
      guardReason:'stable_significant_better',
      stability:'confirmed',
      recentFixedAttempts:Number(recentBaseline.attempts || 0),
      recentFixedSuccessPct:Number(recentBaseline.successPct || 0),
      recentSelectedAttempts:Number(recentCandidate.attempts || 0),
      recentSelectedSuccessPct:Number(recentCandidate.successPct || 0),
      recentLiftPctPoints,
    };
  }
  function buildNewsImpactRecoveryStrategyMatrix(evidenceRows = [], recentEvidenceRows = null) {
    const keys=new Set((evidenceRows || []).map(x=>`${x.reason}|${x.action}`));
    return [...keys].map(key=>{
      const [reason,action]=key.split('|');
      return newsImpactRecoveryStrategyDecision(reason,action,evidenceRows,recentEvidenceRows);
    }).sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
      || b.liftPctPoints-a.liftPctPoints
      || a.reason.localeCompare(b.reason)
      || a.action.localeCompare(b.action));
  }
  
  function newsImpactRecoveryDriftDecision(decision = null, priorEvidenceRows = [], recentEvidenceRows = []) {
    if (!decision || typeof decision!=='object') return decision;
    const base={
      ...decision,
      driftStatus:'not_applicable',
      driftDetected:false,
      driftDropPctPoints:0,
      priorSelectedAttempts:0,
      priorSelectedSuccessPct:0,
      recentDriftAttempts:0,
      recentDriftSuccessPct:0,
    };
    if (decision.strategy!=='adaptive' || !decision.selectedRecovery) return base;
    const prior=(priorEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
    const recent=(recentEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
    const priorAttempts=Number(prior?.attempts || 0);
    const recentAttempts=Number(recent?.attempts || 0);
    const snapshot={
      ...base,
      driftStatus:'insufficient',
      priorSelectedAttempts:priorAttempts,
      priorSelectedSuccessPct:Number(prior?.successPct || 0),
      recentDriftAttempts:recentAttempts,
      recentDriftSuccessPct:Number(recent?.successPct || 0),
    };
    if (priorAttempts<NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS || recentAttempts<NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS) {
      return snapshot;
    }
    const dropPctPoints=Math.round((Number(prior.successPct || 0)-Number(recent.successPct || 0))*10)/10;
    const confidenceSeparated=Number(recent?.confidence?.upperPct || 100)<Number(prior?.confidence?.lowerPct || 0);
    if (dropPctPoints>=NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS && confidenceSeparated) {
      return {
        ...snapshot,
        selectedRecovery:decision.fixedRecovery,
        selectedRecoveryLabel:decision.fixedRecoveryLabel,
        strategy:'fixed',
        guardReason:'performance_drift',
        stability:'drift_blocked',
        driftStatus:'blocked',
        driftDetected:true,
        driftDropPctPoints:dropPctPoints,
        selectedAttempts:Number(decision.fixedAttempts || 0),
        selectedSuccessPct:Number(decision.fixedSuccessPct || 0),
        selectedConfidence:decision.fixedConfidence,
      };
    }
    return {...snapshot,driftStatus:'stable',driftDropPctPoints:Math.max(0,dropPctPoints)};
  }
  
  function buildNewsImpactRecoveryDriftMatrix(strategyRows = [], priorEvidenceRows = [], recentEvidenceRows = []) {
    return (strategyRows || []).map(row=>newsImpactRecoveryDriftDecision(row,priorEvidenceRows,recentEvidenceRows))
      .sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
        || (a.driftDetected?0:1)-(b.driftDetected?0:1)
        || Number(b.liftPctPoints || 0)-Number(a.liftPctPoints || 0)
        || String(a.reason || '').localeCompare(String(b.reason || ''))
        || String(a.action || '').localeCompare(String(b.action || '')));
  }
  
  
  function buildNewsImpactRecoveryTransitionHistory(failureRows = [], {limit = 20} = {}) {
    const ordered=[...(failureRows || [])]
      .map(row=>({row,at:newsImpactEventTime(row)}))
      .filter(x=>Number.isFinite(x.at))
      .sort((a,b)=>a.at-b.at);
    const state=new Map();
    const transitions=[];
    for (const item of ordered) {
      const row=item.row;
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
      const action=cleanNewsImpactActionCode(meta.action);
      if (!action) continue;
      const fixed=newsImpactRecoveryForFailure(reason,action);
      const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || '')) ? String(meta.recovery) : fixed.code;
      const strategy=String(meta.strategy || '')==='adaptive' ? 'adaptive' : 'fixed';
      const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
        ? String(meta.strategy_guard)
        : '';
      const key=`${reason}|${action}`;
      const current={strategy,recovery,guardReason,at:item.at};
      const previous=state.get(key) || null;
      if (previous && (previous.strategy!==strategy || previous.recovery!==recovery)) {
        transitions.push({
          at:new Date(item.at).toISOString(),
          reason,
          reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
          action,
          actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
          fromStrategy:previous.strategy,
          fromRecovery:previous.recovery,
          fromRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[previous.recovery] || previous.recovery,
          toStrategy:strategy,
          toRecovery:recovery,
          toRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
          guardReason,
        });
      }
      state.set(key,current);
    }
    return transitions
      .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
      .slice(0,Math.max(1,Math.min(50,Number(limit || 20))));
  }
  
  function summarizeNewsImpactRecoveryTransitions(rows = []) {
    const list=Array.isArray(rows) ? rows : [];
    return {
      total:list.length,
      fixedToAdaptive:list.filter(x=>x.fromStrategy==='fixed' && x.toStrategy==='adaptive').length,
      adaptiveToFixed:list.filter(x=>x.fromStrategy==='adaptive' && x.toStrategy==='fixed').length,
      recoveryChanged:list.filter(x=>x.fromRecovery!==x.toRecovery).length,
      last:list[0] || null,
    };
  }
  
  function buildNewsImpactRecoveryAdminAlerts(strategyRows = [], evidenceReason = 'ok', incidentRows = []) {
    const alerts=[];
    const suppressed=new Set((incidentRows || [])
      .filter(x=>x.status==='active' && x.acknowledged && x.alertSuppressed)
      .map(x=>newsImpactRecoveryIncidentKey(x.reason,x.action,x.code)));
    if (String(evidenceReason || 'ok')!=='ok') {
      alerts.push({
        severity:'warning',
        code:'strategy_evidence_unavailable',
        reason:'',
        action:'',
        reasonLabel:'Recovery Strategy',
        actionLabel:'',
        message:'Историческое evidence временно недоступно; runtime использует fixed fallback.',
      });
      return alerts;
    }
    for (const row of strategyRows || []) {
      if (NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(row.guardReason || ''))
        && suppressed.has(newsImpactRecoveryIncidentKey(row.reason,row.action,row.guardReason))) continue;
      if (row.guardReason==='performance_drift') {
        alerts.push({
          severity:'warning',
          code:'performance_drift',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:`Adaptive recovery отключён после подтверждённого падения на ${Number(row.driftDropPctPoints || 0).toFixed(1)} п.п.; включён fixed fallback.`,
        });
      } else if (row.guardReason==='recent_regression') {
        alerts.push({
          severity:'warning',
          code:'recent_regression',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:'Свежая выборка не подтверждает adaptive recovery; используется fixed fallback.',
        });
      } else if (row.guardReason==='stability_sample' && row.proposedRecovery) {
        alerts.push({
          severity:'info',
          code:'stability_sample',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:'Есть adaptive-кандидат, но свежей выборки пока недостаточно для безопасного переключения.',
        });
      }
    }
    for (const incident of incidentRows || []) {
      if (incident.status!=='active' || !incident.escalated) continue;
      const recoveryBreach=incident?.slo?.recoveryStatus==='breached';
      const ackBreach=incident?.slo?.ackStatus==='breached' && !incident.acknowledged;
      if (!recoveryBreach && !ackBreach) continue;
      alerts.push({
        severity:incident.effectivePriority==='critical' ? 'critical' : 'warning',
        code:recoveryBreach ? 'incident_recovery_slo_breach' : 'incident_ack_slo_breach',
        reason:incident.reason,
        action:incident.action,
        reasonLabel:incident.reasonLabel || incident.reason,
        actionLabel:incident.actionLabel || incident.action,
        message:recoveryBreach
          ? `Recovery-инцидент не восстановлен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES} минут; приоритет повышен.`
          : `Recovery-инцидент не просмотрен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES} минут; приоритет повышен.`,
      });
    }
    return alerts.slice(0,12);
  }
  
  function summarizeNewsImpactRecoveryAlerts(rows = []) {
    const list=Array.isArray(rows) ? rows : [];
    return {
      total:list.length,
      warnings:list.filter(x=>x.severity==='warning').length,
      info:list.filter(x=>x.severity==='info').length,
      critical:list.filter(x=>x.severity==='critical').length,
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentEvents(failureRows = [], options = {}) {
    const safeRows=Array.isArray(failureRows) ? failureRows : [];
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const configuredLimit=newsImpactFiniteNumber(safeOptions.limit);
    const safeLimit=configuredLimit!==null && Number.isSafeInteger(configuredLimit)
      ? Math.max(1,Math.min(250,configuredLimit))
      : 100;
    const normalized=safeRows.map(row=>{
      if (!row || typeof row!=='object' || Array.isArray(row)) return null;
      const meta=row.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const guardReason=newsImpactKnownCode(meta.strategy_guard,NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,'');
      const at=newsImpactEventTime(row);
      const reason=newsImpactKnownCode(meta.reason,NEWS_IMPACT_FAILURE_CODES,'server_error');
      const action=cleanNewsImpactActionCode(meta.action);
      if (!Number.isFinite(at) || !action) return null;
      const recovery=newsImpactKnownCode(
        meta.recovery,
        NEWS_IMPACT_RECOVERY_CODES,
        newsImpactRecoveryForFailure(reason,action).code,
      );
      return {
        at,
        reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS?.[reason] || reason,
        action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS?.[action] || action,
        strategy:meta.strategy==='adaptive' ? 'adaptive' : 'fixed',
        recovery,
        recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS?.[recovery] || recovery,
        guardReason,
      };
    }).filter(Boolean).sort((a,b)=>a.at-b.at);

    const openByPair=new Map();
    const incidentEvents=[];
    for (const event of normalized) {
      const pairKey=event.reason+'|'+event.action;
      const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES?.has?.(event.guardReason)===true;
      let open=openByPair.get(pairKey) || null;
      if (!adverse) {
        if (open) {
          open.episode.recoveredAt=new Date(event.at).toISOString();
          openByPair.delete(pairKey);
        }
        continue;
      }
      if (!open || open.episode.guardReason!==event.guardReason) {
        if (open) open.episode.recoveredAt=new Date(event.at).toISOString();
        const episode={
          guardReason:event.guardReason,
          startedAt:new Date(event.at).toISOString(),
          lastSeenAt:new Date(event.at).toISOString(),
          recoveredAt:null,
          occurrences:0,
        };
        open={episode};
        openByPair.set(pairKey,open);
      }
      open.episode.lastSeenAt=new Date(event.at).toISOString();
      open.episode.occurrences+=1;
      incidentEvents.push({...event,episode:open.episode});
    }

    return incidentEvents.map(event=>({
      at:new Date(event.at).toISOString(),
      reason:event.reason,
      reasonLabel:event.reasonLabel,
      action:event.action,
      actionLabel:event.actionLabel,
      strategy:event.strategy,
      recovery:event.recovery,
      recoveryLabel:event.recoveryLabel,
      guardReason:event.guardReason,
      priority:event.guardReason==='performance_drift' ? 'high' : 'medium',
      episodeStartedAt:event.episode.startedAt,
      episodeLastSeenAt:event.episode.lastSeenAt,
      episodeRecoveredAt:event.episode.recoveredAt,
      episodeOccurrences:event.episode.occurrences,
    })).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
      .slice(0,safeLimit);
  }

  function newsImpactRecoveryIncidentKey(reason = '', action = '', code = '') {
    return newsImpactText(reason)+'|'+newsImpactText(action)+'|'+newsImpactText(code);
  }

  function newsImpactRecoveryIncidentRunbook(code = '') {
    if (code==='performance_drift') return {
      title:'Performance drift',
      steps:[
        'Проверить prior → recent success rate и достаточность выборки.',
        'Проверить API-Football, Supabase и runtime controls на совпадающую деградацию.',
        'Не форсировать adaptive: circuit breaker уже держит fixed fallback.',
        'Снять инцидент только после новой устойчивой выборки и нормализации guard.',
      ],
      automaticSafety:'fixed fallback уже включён автоматически',
    };
    if (code==='recent_regression') return {
      title:'Recent regression',
      steps:[
        'Проверить свежую 7-дневную выборку baseline и adaptive-кандидата.',
        'Сверить падение с provider/rate-limit и delivery-событиями.',
        'Оставить fixed fallback до восстановления подтверждённой статистики.',
      ],
      automaticSafety:'adaptive не включается, пока свежая выборка не восстановится',
    };
    return {
      title:'Strategy evidence unavailable',
      steps:[
        'Проверить доступность Supabase и shared recovery loader.',
        'Проверить, не усечена ли 30-дневная выборка.',
        'Не менять routing вручную до восстановления evidence.',
      ],
      automaticSafety:'runtime остаётся на fixed fallback',
    };
  }
  
  function buildNewsImpactRecoveryIncidentAcknowledgements(rows = []) {
    const latest=new Map();
    const safeRows=Array.isArray(rows) ? rows : [];
    for (const row of safeRows) {
      if (!row || typeof row!=='object' || Array.isArray(row)) continue;
      const meta=row.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const reason=newsImpactKnownCode(meta.reason,NEWS_IMPACT_FAILURE_CODES,'');
      const action=cleanNewsImpactActionCode(meta.action);
      const code=newsImpactKnownCode(meta.incident_guard,NEWS_IMPACT_RECOVERY_INCIDENT_CODES,'');
      const acknowledgedAt=newsImpactEventTime(row);
      const seenRaw=newsImpactText(meta.incident_seen_at);
      const seenAt=seenRaw ? Date.parse(seenRaw) : NaN;
      if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt) || acknowledgedAt<seenAt) continue;
      const key=newsImpactRecoveryIncidentKey(reason,action,code);
      const value={
        reason,
        action,
        code,
        acknowledgedAt:new Date(acknowledgedAt).toISOString(),
        incidentSeenAt:new Date(seenAt).toISOString(),
      };
      const previous=latest.get(key);
      if (!previous || Date.parse(value.acknowledgedAt)>Date.parse(previous.acknowledgedAt)) latest.set(key,value);
    }
    return [...latest.values()];
  }

  function buildNewsImpactRecoveryIncidentAcknowledgementHistory(rows = []) {
    const safeRows=Array.isArray(rows) ? rows : [];
    return safeRows.map(row=>{
      if (!row || typeof row!=='object' || Array.isArray(row)) return null;
      const meta=row.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const reason=newsImpactKnownCode(meta.reason,NEWS_IMPACT_FAILURE_CODES,'');
      const action=cleanNewsImpactActionCode(meta.action);
      const code=newsImpactKnownCode(meta.incident_guard,NEWS_IMPACT_RECOVERY_INCIDENT_CODES,'');
      const acknowledgedAt=newsImpactEventTime(row);
      const seenRaw=newsImpactText(meta.incident_seen_at);
      const seenAt=seenRaw ? Date.parse(seenRaw) : NaN;
      if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt) || acknowledgedAt<seenAt) return null;
      return {
        reason,
        action,
        code,
        acknowledgedAt:new Date(acknowledgedAt).toISOString(),
        incidentSeenAt:new Date(seenAt).toISOString(),
      };
    }).filter(Boolean).sort((a,b)=>Date.parse(a.acknowledgedAt)-Date.parse(b.acknowledgedAt));
  }

  function buildNewsImpactRecoveryIncidentEpisodeHistory(failureRows = [], acknowledgementRows = []) {
    const safeFailures=Array.isArray(failureRows) ? failureRows : [];
    const normalized=safeFailures.map(row=>{
      if (!row || typeof row!=='object' || Array.isArray(row)) return null;
      const meta=row.metadata && typeof row.metadata==='object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const at=newsImpactEventTime(row);
      const reason=newsImpactKnownCode(meta.reason,NEWS_IMPACT_FAILURE_CODES,'server_error');
      const action=cleanNewsImpactActionCode(meta.action);
      const guardReason=newsImpactKnownCode(meta.strategy_guard,NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,'');
      if (!Number.isFinite(at) || !action) return null;
      return {
        at,
        reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS?.[reason] || reason,
        action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS?.[action] || action,
        guardReason,
      };
    }).filter(Boolean).sort((a,b)=>a.at-b.at);

    const openByPair=new Map();
    const episodes=[];
    for (const event of normalized) {
      const key=event.reason+'|'+event.action;
      const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES?.has?.(event.guardReason)===true;
      let episode=openByPair.get(key) || null;
      if (!adverse) {
        if (episode) {
          episode.recoveredAt=new Date(event.at).toISOString();
          episode.closedByGuard=event.guardReason || 'safe';
          openByPair.delete(key);
        }
        continue;
      }
      if (!episode) {
        episode={
          reason:event.reason,
          reasonLabel:event.reasonLabel,
          action:event.action,
          actionLabel:event.actionLabel,
          startedAt:new Date(event.at).toISOString(),
          lastSeenAt:new Date(event.at).toISOString(),
          recoveredAt:null,
          closedByGuard:'',
          occurrences:0,
          guardCodes:[],
        };
        episodes.push(episode);
        openByPair.set(key,episode);
      }
      episode.lastSeenAt=new Date(event.at).toISOString();
      episode.occurrences+=1;
      if (!episode.guardCodes.includes(event.guardReason)) episode.guardCodes.push(event.guardReason);
    }

    const ackHistory=buildNewsImpactRecoveryIncidentAcknowledgementHistory(acknowledgementRows);
    return episodes.map(episode=>{
      const startMs=Date.parse(episode.startedAt);
      const lastSeenMs=Date.parse(episode.lastSeenAt);
      const recoveredMs=episode.recoveredAt ? Date.parse(episode.recoveredAt) : NaN;
      const ack=ackHistory.find(item=>{
        if (item.reason!==episode.reason || item.action!==episode.action) return false;
        if (!episode.guardCodes.includes(item.code)) return false;
        const seenMs=Date.parse(item.incidentSeenAt);
        const ackMs=Date.parse(item.acknowledgedAt);
        return Number.isFinite(seenMs)
          && Number.isFinite(ackMs)
          && seenMs>=startMs
          && seenMs<=lastSeenMs
          && ackMs>=startMs
          && (!Number.isFinite(recoveredMs) || ackMs<=recoveredMs);
      }) || null;
      return {
        ...episode,
        firstAcknowledgedAt:ack?.acknowledgedAt || null,
        firstAcknowledgedGuard:ack?.code || '',
        active:!episode.recoveredAt,
      };
    }).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
  }

  function newsImpactRecoveryEpisodeSloState(episode = null, asOfMs = Date.now()) {
    if (!episode || typeof episode!=='object' || Array.isArray(episode)) return null;
    const startRaw=newsImpactText(episode.startedAt);
    const startMs=startRaw ? Date.parse(startRaw) : NaN;
    const parsedAsOf=newsImpactFiniteNumber(asOfMs);
    const safeAsOfMs=parsedAsOf ?? Date.now();
    if (!Number.isFinite(startMs) || startMs>safeAsOfMs) return null;

    const recoveredRaw=newsImpactText(episode.recoveredAt);
    const recoveredCandidate=recoveredRaw ? Date.parse(recoveredRaw) : NaN;
    if (Number.isFinite(recoveredCandidate) && recoveredCandidate<startMs) return null;
    const recoveredMs=Number.isFinite(recoveredCandidate) && recoveredCandidate<=safeAsOfMs
      ? recoveredCandidate
      : NaN;

    const terminalMs=Number.isFinite(recoveredMs) ? recoveredMs : safeAsOfMs;
    const ackRaw=newsImpactText(episode.firstAcknowledgedAt);
    const ackCandidate=ackRaw ? Date.parse(ackRaw) : NaN;
    const ackMs=Number.isFinite(ackCandidate) && ackCandidate>=startMs && ackCandidate<=terminalMs
      ? ackCandidate
      : NaN;

    const ackTarget=newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,30);
    const recoveryTarget=newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,360);
    const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
    const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
    const recoveryLatencyMinutes=Number.isFinite(recoveredMs) ? elapsedMinutes : null;
    const ackEligible=Number.isFinite(ackMs) || elapsedMinutes>=ackTarget;
    const ackMet=ackEligible && Number.isFinite(ackLatencyMinutes) && ackLatencyMinutes<=ackTarget;
    const ackBreached=ackEligible && !ackMet;
    const recoveryEligible=Number.isFinite(recoveredMs) || elapsedMinutes>=recoveryTarget;
    const recoveryMet=recoveryEligible && Number.isFinite(recoveryLatencyMinutes) && recoveryLatencyMinutes<=recoveryTarget;
    const recoveryBreached=recoveryEligible && !recoveryMet;
    return {
      elapsedMinutes,
      ackLatencyMinutes,
      recoveryLatencyMinutes,
      ackEligible,
      ackMet,
      ackBreached,
      ackStatus:ackMet ? 'met' : ackBreached ? 'breached' : 'pending',
      recoveryEligible,
      recoveryMet,
      recoveryBreached,
      recoveryStatus:recoveryMet ? 'met' : recoveryBreached ? 'breached' : 'pending',
    };
  }

  function newsImpactRecoverySloPct(met = 0, eligible = 0) {
    const safeEligible=newsImpactCount(eligible);
    if (!safeEligible) return null;
    const safeMet=Math.min(safeEligible,newsImpactCount(met));
    return Math.round((safeMet/safeEligible)*1000)/10;
  }

  function buildNewsImpactRecoveryIncidentSloDashboard(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const weekMs=7*86400_000;
    const earliestMs=asOfMs-safeWeeks*weekMs;
    const episodes=(episodeRows || []).map(episode=>({
      ...episode,
      slo:newsImpactRecoveryEpisodeSloState(episode,asOfMs),
    })).filter(x=>x.slo && Date.parse(x.startedAt)>=earliestMs && Date.parse(x.startedAt)<=asOfMs);
  
    const summarize=(rows=[])=>{
      const ackEligible=rows.filter(x=>x.slo.ackEligible).length;
      const ackMet=rows.filter(x=>x.slo.ackMet).length;
      const ackBreached=rows.filter(x=>x.slo.ackBreached).length;
      const recoveryEligible=rows.filter(x=>x.slo.recoveryEligible).length;
      const recoveryMet=rows.filter(x=>x.slo.recoveryMet).length;
      const recoveryBreached=rows.filter(x=>x.slo.recoveryBreached).length;
      const ackLatencies=rows.map(x=>x.slo.ackLatencyMinutes).filter(Number.isFinite);
      const recoveryLatencies=rows.map(x=>x.slo.recoveryLatencyMinutes).filter(Number.isFinite);
      return {
        episodes:rows.length,
        active:rows.filter(x=>x.active).length,
        recovered:rows.filter(x=>!x.active).length,
        ackEligible,
        ackMet,
        ackBreached,
        ackSloPct:newsImpactRecoverySloPct(ackMet,ackEligible),
        recoveryEligible,
        recoveryMet,
        recoveryBreached,
        recoverySloPct:newsImpactRecoverySloPct(recoveryMet,recoveryEligible),
        avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
        avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
      };
    };
  
    const weekly=[];
    for (let offset=safeWeeks-1; offset>=0; offset-=1) {
      const startMs=asOfMs-(offset+1)*weekMs;
      const endMs=asOfMs-offset*weekMs;
      const rows=episodes.filter(x=>{
        const at=Date.parse(x.startedAt);
        return at>=startMs && at<endMs;
      });
      weekly.push({
        startAt:new Date(startMs).toISOString(),
        endAt:new Date(endMs).toISOString(),
        label:`${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
        ...summarize(rows),
      });
    }
  
    const recurrence=new Map();
    for (const episode of episodes) {
      const key=`${episode.reason}|${episode.action}`;
      const bucket=recurrence.get(key) || {
        reason:episode.reason,
        reasonLabel:episode.reasonLabel || episode.reason,
        action:episode.action,
        actionLabel:episode.actionLabel || episode.action,
        episodes:0,
        active:0,
        ackBreaches:0,
        recoveryBreaches:0,
        lastStartedAt:episode.startedAt,
        guards:new Set(),
      };
      bucket.episodes+=1;
      if (episode.active) bucket.active+=1;
      if (episode.slo.ackBreached) bucket.ackBreaches+=1;
      if (episode.slo.recoveryBreached) bucket.recoveryBreaches+=1;
      if (Date.parse(episode.startedAt)>Date.parse(bucket.lastStartedAt)) bucket.lastStartedAt=episode.startedAt;
      for (const code of episode.guardCodes || []) bucket.guards.add(code);
      recurrence.set(key,bucket);
    }
    const repeatedAll=[...recurrence.values()].map(x=>({
      reason:x.reason,
      reasonLabel:x.reasonLabel,
      action:x.action,
      actionLabel:x.actionLabel,
      episodes:x.episodes,
      active:x.active,
      ackBreaches:x.ackBreaches,
      recoveryBreaches:x.recoveryBreaches,
      lastStartedAt:x.lastStartedAt,
      guards:[...x.guards].sort(),
    })).filter(x=>x.episodes>=2)
      .sort((a,b)=>b.episodes-a.episodes || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || Date.parse(b.lastStartedAt)-Date.parse(a.lastStartedAt));
    const repeated=repeatedAll.slice(0,10);
  
    const summary=summarize(episodes);
    const current=weekly[weekly.length-1] || null;
    const previous=weekly[weekly.length-2] || null;
    const delta=(a,b)=>Number.isFinite(Number(a)) && Number.isFinite(Number(b))
      ? Math.round((Number(a)-Number(b))*10)/10
      : null;
    return {
      available:true,
      windowDays:safeWeeks*7,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        ...summary,
        recurringPairs:repeatedAll.length,
        ackDeltaPctPoints:delta(current?.ackSloPct,previous?.ackSloPct),
        recoveryDeltaPctPoints:delta(current?.recoverySloPct,previous?.recoverySloPct),
      },
      weekly,
      repeated,
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false},
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachFeed(episodeRows = [], {asOfMs = Date.now(), limit = 20} = {}) {
    const priorityRank={critical:0,high:1,medium:2};
    const safeLimit=Math.max(1,Math.min(50,Number(limit || 20)));
    const items=(episodeRows || []).map(episode=>{
      const slo=newsImpactRecoveryEpisodeSloState(episode,asOfMs);
      if (!slo || (!slo.ackBreached && !slo.recoveryBreached)) return null;
      const breachTypes=[];
      if (slo.ackBreached) breachTypes.push('ack');
      if (slo.recoveryBreached) breachTypes.push('recovery');
      let severity='medium';
      if (episode.active && slo.recoveryBreached) severity='critical';
      else if (episode.active && slo.ackBreached && Number(slo.elapsedMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) severity='critical';
      else if (episode.active && slo.ackBreached) severity='high';
      else if (slo.recoveryBreached) severity='high';
      return {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        startedAt:episode.startedAt || null,
        lastSeenAt:episode.lastSeenAt || null,
        recoveredAt:episode.recoveredAt || null,
        active:Boolean(episode.active),
        occurrences:Number(episode.occurrences || 0),
        guards:Array.isArray(episode.guardCodes) ? [...episode.guardCodes].sort() : [],
        breachTypes,
        severity,
        ackStatus:slo.ackStatus,
        recoveryStatus:slo.recoveryStatus,
        ageMinutes:slo.elapsedMinutes,
        ackLatencyMinutes:slo.ackLatencyMinutes,
        recoveryLatencyMinutes:slo.recoveryLatencyMinutes,
      };
    }).filter(Boolean).sort((a,b)=>
      (priorityRank[a.severity] ?? 9)-(priorityRank[b.severity] ?? 9)
      || Number(b.active)-Number(a.active)
      || Date.parse(String(b.startedAt || 0))-Date.parse(String(a.startedAt || 0))
    );
  
    const pairs=new Map();
    for (const item of items) {
      const key=String(item.reason || '')+'|'+String(item.action || '');
      const bucket=pairs.get(key) || {
        reason:item.reason,
        reasonLabel:item.reasonLabel,
        action:item.action,
        actionLabel:item.actionLabel,
        breachEpisodes:0,
        activeBreaches:0,
        ackBreaches:0,
        recoveryBreaches:0,
        lastStartedAt:item.startedAt,
      };
      bucket.breachEpisodes+=1;
      if (item.active) bucket.activeBreaches+=1;
      if (item.breachTypes.includes('ack')) bucket.ackBreaches+=1;
      if (item.breachTypes.includes('recovery')) bucket.recoveryBreaches+=1;
      if (Date.parse(String(item.startedAt || 0))>Date.parse(String(bucket.lastStartedAt || 0))) bucket.lastStartedAt=item.startedAt;
      pairs.set(key,bucket);
    }
    const repeated=[...pairs.values()]
      .filter(x=>x.breachEpisodes>=2)
      .sort((a,b)=>b.activeBreaches-a.activeBreaches || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || b.breachEpisodes-a.breachEpisodes)
      .slice(0,10);
  
    return {
      available:true,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        breachEpisodes:items.length,
        activeBreaches:items.filter(x=>x.active).length,
        critical:items.filter(x=>x.severity==='critical').length,
        ackBreaches:items.filter(x=>x.breachTypes.includes('ack')).length,
        recoveryBreaches:items.filter(x=>x.breachTypes.includes('recovery')).length,
        repeatedPairs:repeated.length,
      },
      items:items.slice(0,safeLimit),
      repeated,
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachWatchlist(feed = {}, {limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const items=Array.isArray(feed?.items) ? feed.items : [];
    const repeated=Array.isArray(feed?.repeated) ? feed.repeated : [];
    const active=items.filter(x=>x?.active);
    const activeSorted=[...active].sort((a,b)=>
      Number(b?.severity==='critical')-Number(a?.severity==='critical')
      || Number(b?.ageMinutes || 0)-Number(a?.ageMinutes || 0)
      || Date.parse(String(a?.startedAt || 0))-Date.parse(String(b?.startedAt || 0))
    );
    const activeRepeatedPairs=repeated
      .filter(x=>Number(x?.activeBreaches || 0)>0)
      .sort((a,b)=>Number(b.activeBreaches || 0)-Number(a.activeBreaches || 0)
        || Number(b.breachEpisodes || 0)-Number(a.breachEpisodes || 0))
      .slice(0,10);
    return {
      available:feed?.available!==false,
      generatedAt:feed?.generatedAt || null,
      summary:{
        active:active.length,
        criticalActive:active.filter(x=>x?.severity==='critical').length,
        ackActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('ack')).length,
        recoveryActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('recovery')).length,
        oldestActiveMinutes:active.length ? Math.max(...active.map(x=>Number(x?.ageMinutes || 0))) : null,
        repeatedActivePairs:activeRepeatedPairs.length,
      },
      items:activeSorted.slice(0,safeLimit),
      repeated:activeRepeatedPairs,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachTriage(watchlist = {}, {limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const items=Array.isArray(watchlist?.items) ? watchlist.items : [];
    const thresholds=watchlist?.thresholds || {};
    const criticalAckMinutes=Number(thresholds.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES);
    const recoveryMinutes=Number(thresholds.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
    const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
    const triageItems=items.filter(x=>x?.active).map(item=>{
      const breachTypes=Array.isArray(item?.breachTypes) ? item.breachTypes : [];
      const ageMinutes=Number(item?.ageMinutes || 0);
      let triageStage='ack_overdue';
      let triageLabel='ACK просрочен';
      if (breachTypes.includes('recovery') || ageMinutes>=recoveryMinutes) {
        triageStage='recovery_overdue';
        triageLabel='Recovery просрочен';
      } else if (breachTypes.includes('ack') && ageMinutes>=criticalAckMinutes) {
        triageStage='ack_critical';
        triageLabel='ACK критически просрочен';
      }
      return {...item,triageStage,triageLabel};
    }).sort((a,b)=>
      (stageRank[a.triageStage] ?? 9)-(stageRank[b.triageStage] ?? 9)
      || Number(b.ageMinutes || 0)-Number(a.ageMinutes || 0)
      || Date.parse(String(a.startedAt || 0))-Date.parse(String(b.startedAt || 0))
    );
    return {
      available:watchlist?.available!==false,
      generatedAt:watchlist?.generatedAt || null,
      summary:{
        total:triageItems.length,
        recoveryOverdue:triageItems.filter(x=>x.triageStage==='recovery_overdue').length,
        ackCritical:triageItems.filter(x=>x.triageStage==='ack_critical').length,
        ackOverdue:triageItems.filter(x=>x.triageStage==='ack_overdue').length,
      },
      items:triageItems.slice(0,safeLimit),
      thresholds:{
        ackMinutes:Number(thresholds.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes,
        recoveryMinutes,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentTriageStageAt(episode = null, atMs = Date.now()) {
    if (!episode) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs) || startMs>atMs) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    if (Number.isFinite(recoveredMs) && recoveredMs<=atMs) return null;
    const ageMinutes=Math.max(0,Math.floor((atMs-startMs)/60000));
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
    const ackBreached=Number.isFinite(ackMs) && ackMs<=atMs
      ? Number(ackLatencyMinutes || 0)>NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES
      : ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
    if (ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES) return 'recovery_overdue';
    if (ackBreached && ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) return 'ack_critical';
    if (ackBreached) return 'ack_overdue';
    return null;
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachTriageTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const weekMs=7*86400_000;
    const weekly=[];
    const pairSnapshots=new Map();
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const snapshotAtMs=asOfMs-i*weekMs;
      const counts={total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
      const seenPairs=new Map();
      for (const episode of episodeRows || []) {
        const stage=newsImpactRecoveryIncidentTriageStageAt(episode,snapshotAtMs);
        if (!stage) continue;
        counts.total+=1;
        if (stage==='recovery_overdue') counts.recoveryOverdue+=1;
        else if (stage==='ack_critical') counts.ackCritical+=1;
        else counts.ackOverdue+=1;
        const key=String(episode.reason || '')+'|'+String(episode.action || '');
        const current=seenPairs.get(key) || {
          reason:String(episode.reason || ''),
          reasonLabel:String(episode.reasonLabel || episode.reason || ''),
          action:String(episode.action || ''),
          actionLabel:String(episode.actionLabel || episode.action || ''),
          stage,
        };
        if (stage==='recovery_overdue' || (stage==='ack_critical' && current.stage==='ack_overdue')) current.stage=stage;
        seenPairs.set(key,current);
      }
      for (const [key,pair] of seenPairs) {
        const bucket=pairSnapshots.get(key) || {
          reason:pair.reason,
          reasonLabel:pair.reasonLabel,
          action:pair.action,
          actionLabel:pair.actionLabel,
          weeksPresent:0,
          recoveryOverdueWeeks:0,
          ackCriticalWeeks:0,
          ackOverdueWeeks:0,
          latestStage:pair.stage,
        };
        bucket.weeksPresent+=1;
        if (pair.stage==='recovery_overdue') bucket.recoveryOverdueWeeks+=1;
        else if (pair.stage==='ack_critical') bucket.ackCriticalWeeks+=1;
        else bucket.ackOverdueWeeks+=1;
        bucket.latestStage=pair.stage;
        pairSnapshots.set(key,bucket);
      }
      weekly.push({
        snapshotAt:new Date(snapshotAtMs).toISOString(),
        ...counts,
      });
    }
    const current=weekly[weekly.length-1] || {total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
    const previous=weekly[weekly.length-2] || current;
    const stuck=[...pairSnapshots.values()]
      .filter(x=>x.weeksPresent>=2)
      .sort((a,b)=>b.recoveryOverdueWeeks-a.recoveryOverdueWeeks
        || b.ackCriticalWeeks-a.ackCriticalWeeks
        || b.weeksPresent-a.weeksPresent
        || String(a.reason).localeCompare(String(b.reason)))
      .slice(0,10);
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentTotal:Number(current.total || 0),
        totalDelta:Number(current.total || 0)-Number(previous.total || 0),
        recoveryOverdueDelta:Number(current.recoveryOverdue || 0)-Number(previous.recoveryOverdue || 0),
        ackCriticalDelta:Number(current.ackCritical || 0)-Number(previous.ackCritical || 0),
        ackOverdueDelta:Number(current.ackOverdue || 0)-Number(previous.ackOverdue || 0),
        stuckPairs:stuck.length,
      },
      weekly,
      stuck,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentSloBurden(episode = null, asOfMs = Date.now()) {
    if (!episode) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs) || startMs>asOfMs) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<=asOfMs ? recoveredMs : asOfMs;
    const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const ackTerminalMs=Number.isFinite(ackMs) && ackMs<=terminalMs ? ackMs : terminalMs;
    const ackElapsedMinutes=Math.max(0,Math.round((ackTerminalMs-startMs)/60000));
    const ackOverdueMinutes=Math.max(0,ackElapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES);
    const recoveryOverdueMinutes=Math.max(0,elapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
    return {
      active:!(Number.isFinite(recoveredMs) && recoveredMs<=asOfMs),
      elapsedMinutes,
      ackOverdueMinutes,
      recoveryOverdueMinutes,
      totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
    };
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachImpactRanking(episodeRows = [], {asOfMs = Date.now(), limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const groups=new Map();
    for (const episode of episodeRows || []) {
      const burden=newsImpactRecoveryIncidentSloBurden(episode,asOfMs);
      if (!burden || burden.totalOverdueMinutes<=0) continue;
      const key=String(episode.reason || '')+'|'+String(episode.action || '');
      const bucket=groups.get(key) || {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        episodes:0,
        activeEpisodes:0,
        ackBreachEpisodes:0,
        recoveryBreachEpisodes:0,
        ackOverdueMinutes:0,
        recoveryOverdueMinutes:0,
        totalOverdueMinutes:0,
        oldestActiveMinutes:null,
        latestStage:null,
      };
      bucket.episodes+=1;
      if (burden.active) {
        bucket.activeEpisodes+=1;
        bucket.oldestActiveMinutes=bucket.oldestActiveMinutes==null
          ? burden.elapsedMinutes
          : Math.max(bucket.oldestActiveMinutes,burden.elapsedMinutes);
        const stage=newsImpactRecoveryIncidentTriageStageAt(episode,asOfMs);
        const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
        if (stage && (bucket.latestStage==null || (stageRank[stage] ?? 9)<(stageRank[bucket.latestStage] ?? 9))) {
          bucket.latestStage=stage;
        }
      }
      if (burden.ackOverdueMinutes>0) bucket.ackBreachEpisodes+=1;
      if (burden.recoveryOverdueMinutes>0) bucket.recoveryBreachEpisodes+=1;
      bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
      bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
      bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
      groups.set(key,bucket);
    }
    const all=[...groups.values()].sort((a,b)=>
      b.totalOverdueMinutes-a.totalOverdueMinutes
      || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
      || b.ackOverdueMinutes-a.ackOverdueMinutes
      || b.episodes-a.episodes
      || String(a.reason).localeCompare(String(b.reason))
    );
    const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
    const ranking=all.slice(0,safeLimit).map((row,index)=>({
      ...row,
      rank:index+1,
      contributionPct:totalOverdueMinutes>0
        ? Math.round((Number(row.totalOverdueMinutes || 0)/totalOverdueMinutes)*1000)/10
        : 0,
    }));
    return {
      available:true,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        pairs:all.length,
        activePairs:all.filter(x=>x.activeEpisodes>0).length,
        breachEpisodes:all.reduce((sum,row)=>sum+Number(row.episodes || 0),0),
        totalOverdueMinutes,
        ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
        recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
        topContributionPct:ranking[0]?.contributionPct || 0,
      },
      ranking,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      methodology:'sum_minutes_above_existing_ack_and_recovery_slo',
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentOverdueWithinWindow(episode = null, windowStartMs = 0, windowEndMs = Date.now()) {
    if (!episode || typeof episode!=='object' || Array.isArray(episode) || !Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs<=windowStartMs) return null;
    const startedAt=newsImpactText(episode.startedAt);
    const recoveredAt=newsImpactText(episode.recoveredAt);
    const acknowledgedAt=newsImpactText(episode.firstAcknowledgedAt);
    const startMs=startedAt ? Date.parse(startedAt) : NaN;
    if (!Number.isFinite(startMs) || startMs>=windowEndMs) return null;
    const recoveredMs=recoveredAt ? Date.parse(recoveredAt) : NaN;
    const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<windowEndMs ? recoveredMs : windowEndMs;
    if (terminalMs<=windowStartMs) return null;
    const ackMs=acknowledgedAt ? Date.parse(acknowledgedAt) : NaN;
    const ackTerminalMs=Number.isFinite(ackMs) && ackMs<terminalMs ? ackMs : terminalMs;
    const overlapMinutes=(fromMs,toMs)=>{
      const from=Math.max(windowStartMs,fromMs);
      const to=Math.min(windowEndMs,toMs);
      return to>from ? Math.max(0,Math.round((to-from)/60000)) : 0;
    };
    const ackOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES*60000;
    const recoveryOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES*60000;
    const ackOverdueMinutes=overlapMinutes(ackOverdueStartMs,ackTerminalMs);
    const recoveryOverdueMinutes=overlapMinutes(recoveryOverdueStartMs,terminalMs);
    return {
      ackOverdueMinutes,
      recoveryOverdueMinutes,
      totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
    };
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachImpactTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4, limit = 10} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const weekMs=7*86400_000;
    const weekly=[];
    const pairSeries=new Map();
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const windowEndMs=asOfMs-i*weekMs;
      const windowStartMs=windowEndMs-weekMs;
      const groups=new Map();
      for (const episode of episodeRows || []) {
        const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
        if (!burden || burden.totalOverdueMinutes<=0) continue;
        const key=String(episode.reason || '')+'|'+String(episode.action || '');
        const bucket=groups.get(key) || {
          reason:String(episode.reason || ''),
          reasonLabel:String(episode.reasonLabel || episode.reason || ''),
          action:String(episode.action || ''),
          actionLabel:String(episode.actionLabel || episode.action || ''),
          episodes:0,
          ackOverdueMinutes:0,
          recoveryOverdueMinutes:0,
          totalOverdueMinutes:0,
        };
        bucket.episodes+=1;
        bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
        bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
        bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
        groups.set(key,bucket);
      }
      const all=[...groups.values()].sort((a,b)=>
        b.totalOverdueMinutes-a.totalOverdueMinutes
        || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
        || b.ackOverdueMinutes-a.ackOverdueMinutes
        || String(a.reason).localeCompare(String(b.reason))
      );
      const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
      const pairMap=new Map(all.map(row=>[String(row.reason)+'|'+String(row.action),row]));
      weekly.push({
        windowStart:new Date(windowStartMs).toISOString(),
        windowEnd:new Date(windowEndMs).toISOString(),
        totalOverdueMinutes,
        ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
        recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
        pairs:all.length,
        top:all[0] ? {
          reason:all[0].reason,
          reasonLabel:all[0].reasonLabel,
          action:all[0].action,
          actionLabel:all[0].actionLabel,
          totalOverdueMinutes:all[0].totalOverdueMinutes,
          contributionPct:totalOverdueMinutes>0 ? Math.round((all[0].totalOverdueMinutes/totalOverdueMinutes)*1000)/10 : 0,
        } : null,
      });
      for (const row of all) {
        const key=String(row.reason)+'|'+String(row.action);
        if (!pairSeries.has(key)) pairSeries.set(key,{
          reason:row.reason,
          reasonLabel:row.reasonLabel,
          action:row.action,
          actionLabel:row.actionLabel,
          values:new Array(safeWeeks).fill(null).map(()=>({ackOverdueMinutes:0,recoveryOverdueMinutes:0,totalOverdueMinutes:0,episodes:0})),
        });
      }
      const weekIndex=weekly.length-1;
      for (const [key,series] of pairSeries) {
        const row=pairMap.get(key);
        if (row) series.values[weekIndex]={
          ackOverdueMinutes:Number(row.ackOverdueMinutes || 0),
          recoveryOverdueMinutes:Number(row.recoveryOverdueMinutes || 0),
          totalOverdueMinutes:Number(row.totalOverdueMinutes || 0),
          episodes:Number(row.episodes || 0),
        };
      }
    }
    const currentWeek=weekly[weekly.length-1] || {totalOverdueMinutes:0};
    const previousWeek=weekly[weekly.length-2] || currentWeek;
    const pairTrends=[...pairSeries.values()].map(series=>{
      const current=series.values[series.values.length-1] || {totalOverdueMinutes:0};
      const previous=series.values[series.values.length-2] || {totalOverdueMinutes:0};
      const deltaMinutes=Number(current.totalOverdueMinutes || 0)-Number(previous.totalOverdueMinutes || 0);
      return {
        reason:series.reason,
        reasonLabel:series.reasonLabel,
        action:series.action,
        actionLabel:series.actionLabel,
        currentOverdueMinutes:Number(current.totalOverdueMinutes || 0),
        previousOverdueMinutes:Number(previous.totalOverdueMinutes || 0),
        deltaMinutes,
        direction:deltaMinutes>0 ? 'increased' : deltaMinutes<0 ? 'decreased' : 'unchanged',
        currentContributionPct:Number(currentWeek.totalOverdueMinutes || 0)>0
          ? Math.round((Number(current.totalOverdueMinutes || 0)/Number(currentWeek.totalOverdueMinutes || 0))*1000)/10
          : 0,
        weekly:series.values,
      };
    }).sort((a,b)=>
      Math.abs(b.deltaMinutes)-Math.abs(a.deltaMinutes)
      || b.currentOverdueMinutes-a.currentOverdueMinutes
      || String(a.reason).localeCompare(String(b.reason))
    );
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentOverdueMinutes:Number(currentWeek.totalOverdueMinutes || 0),
        previousOverdueMinutes:Number(previousWeek.totalOverdueMinutes || 0),
        deltaMinutes:Number(currentWeek.totalOverdueMinutes || 0)-Number(previousWeek.totalOverdueMinutes || 0),
        increasedPairs:pairTrends.filter(x=>x.direction==='increased').length,
        decreasedPairs:pairTrends.filter(x=>x.direction==='decreased').length,
        unchangedPairs:pairTrends.filter(x=>x.direction==='unchanged').length,
      },
      weekly,
      pairs:pairTrends.slice(0,safeLimit),
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo',
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactConcentration(impactRanking = {}) {
    const source=impactRanking && typeof impactRanking==='object' && !Array.isArray(impactRanking)
      ? impactRanking
      : null;
    const ranking=(source && Array.isArray(source.ranking) ? source.ranking : [])
      .filter(row=>
        row
        && typeof row==='object'
        && !Array.isArray(row)
        && typeof row.reason==='string'
        && row.reason
        && typeof row.action==='string'
        && row.action
      );
    const reportedPairs=newsImpactFiniteNumber(source?.summary?.pairs);
    const totalPairs=reportedPairs!==null && Number.isSafeInteger(reportedPairs) && reportedPairs>=0
      ? reportedPairs
      : ranking.length;
    const cumulativePct=(count)=>Math.min(
      100,
      Math.round(ranking.slice(0,count).reduce((sum,row)=>sum+newsImpactPercentage(row.contributionPct),0)*10)/10,
    );
    const top1Pct=cumulativePct(1);
    const top3Pct=cumulativePct(3);
    const top5Pct=cumulativePct(5);
    const concentrationRows=ranking.slice(0,5).map((row,index)=>({
      rank:index+1,
      reason:row.reason,
      reasonLabel:newsImpactText(row.reasonLabel,row.reason),
      action:row.action,
      actionLabel:newsImpactText(row.actionLabel,row.action),
      contributionPct:newsImpactPercentage(row.contributionPct),
      cumulativeContributionPct:cumulativePct(index+1),
      totalOverdueMinutes:newsImpactNonNegativeNumber(row.totalOverdueMinutes),
      activeEpisodes:newsImpactCount(row.activeEpisodes),
    }));
    return {
      available:Boolean(source && source.available!==false),
      generatedAt:newsImpactText(source?.generatedAt) || null,
      summary:{
        pairs:totalPairs,
        totalOverdueMinutes:newsImpactNonNegativeNumber(source?.summary?.totalOverdueMinutes),
        top1ContributionPct:top1Pct,
        top3ContributionPct:top3Pct,
        top5ContributionPct:top5Pct,
        residualAfterTop5Pct:Math.max(0,Math.round((100-top5Pct)*10)/10),
        coveredPairs:Math.min(5,totalPairs,ranking.length),
      },
      rows:concentrationRows,
      methodology:'cumulative_share_of_total_overdue_minutes',
      thresholds:{
        ackMinutes:newsImpactNonNegativeNumber(source?.thresholds?.ackMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES)),
        criticalAckMinutes:newsImpactNonNegativeNumber(source?.thresholds?.criticalAckMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES)),
        recoveryMinutes:newsImpactNonNegativeNumber(source?.thresholds?.recoveryMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES)),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(episodeRows = [], options = {}) {
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const configuredWeeks=newsImpactFiniteNumber(safeOptions.weeks);
    const safeWeeks=configuredWeeks!==null && Number.isSafeInteger(configuredWeeks)
      ? Math.max(2,Math.min(4,configuredWeeks))
      : 4;
    const configuredAsOf=newsImpactFiniteNumber(safeOptions.asOfMs);
    const candidateAsOf=configuredAsOf!==null ? new Date(configuredAsOf).getTime() : NaN;
    const asOfMs=Number.isFinite(candidateAsOf) ? candidateAsOf : Date.now();
    const safeEpisodes=Array.isArray(episodeRows) ? episodeRows : [];
    const weekMs=7*86400_000;
    const weekly=[];
    const direction=(delta)=>delta>0 ? 'increased' : delta<0 ? 'decreased' : 'unchanged';
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const windowEndMs=asOfMs-i*weekMs;
      const windowStartMs=windowEndMs-weekMs;
      const groups=new Map();
      for (const episode of safeEpisodes) {
        if (!episode || typeof episode!=='object' || Array.isArray(episode)) continue;
        const reason=newsImpactText(episode.reason);
        const action=newsImpactText(episode.action);
        if (!reason || !action) continue;
        const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
        const burdenMinutes=newsImpactNonNegativeNumber(burden?.totalOverdueMinutes);
        if (!burden || burdenMinutes<=0) continue;
        const key=reason+'|'+action;
        const bucket=groups.get(key) || {
          reason,
          reasonLabel:newsImpactText(episode.reasonLabel,reason),
          action,
          actionLabel:newsImpactText(episode.actionLabel,action),
          totalOverdueMinutes:0,
        };
        bucket.totalOverdueMinutes+=burdenMinutes;
        groups.set(key,bucket);
      }
      const all=[...groups.values()].sort((a,b)=>
        b.totalOverdueMinutes-a.totalOverdueMinutes
        || a.reason.localeCompare(b.reason)
        || a.action.localeCompare(b.action)
      );
      const totalOverdueMinutes=all.reduce((sum,row)=>sum+newsImpactNonNegativeNumber(row.totalOverdueMinutes),0);
      const share=(count)=>totalOverdueMinutes>0
        ? Math.min(100,Math.round((all.slice(0,count).reduce((sum,row)=>sum+newsImpactNonNegativeNumber(row.totalOverdueMinutes),0)/totalOverdueMinutes)*1000)/10)
        : 0;
      const top1ContributionPct=share(1);
      const top3ContributionPct=share(3);
      const top5ContributionPct=share(5);
      weekly.push({
        windowStart:new Date(windowStartMs).toISOString(),
        windowEnd:new Date(windowEndMs).toISOString(),
        pairs:all.length,
        totalOverdueMinutes,
        top1ContributionPct,
        top3ContributionPct,
        top5ContributionPct,
        residualAfterTop5Pct:Math.max(0,Math.round((100-top5ContributionPct)*10)/10),
        topPair:all[0] ? {
          reason:all[0].reason,
          reasonLabel:all[0].reasonLabel,
          action:all[0].action,
          actionLabel:all[0].actionLabel,
          totalOverdueMinutes:newsImpactNonNegativeNumber(all[0].totalOverdueMinutes),
        } : null,
      });
    }
    const current=weekly[weekly.length-1] || {pairs:0,totalOverdueMinutes:0,top1ContributionPct:0,top3ContributionPct:0,top5ContributionPct:0};
    const previous=weekly[weekly.length-2] || current;
    const top1DeltaPctPoints=Math.round((newsImpactPercentage(current.top1ContributionPct)-newsImpactPercentage(previous.top1ContributionPct))*10)/10;
    const top3DeltaPctPoints=Math.round((newsImpactPercentage(current.top3ContributionPct)-newsImpactPercentage(previous.top3ContributionPct))*10)/10;
    const top5DeltaPctPoints=Math.round((newsImpactPercentage(current.top5ContributionPct)-newsImpactPercentage(previous.top5ContributionPct))*10)/10;
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentPairs:newsImpactCount(current.pairs),
        previousPairs:newsImpactCount(previous.pairs),
        pairDelta:newsImpactCount(current.pairs)-newsImpactCount(previous.pairs),
        currentOverdueMinutes:newsImpactNonNegativeNumber(current.totalOverdueMinutes),
        previousOverdueMinutes:newsImpactNonNegativeNumber(previous.totalOverdueMinutes),
        top1ContributionPct:newsImpactPercentage(current.top1ContributionPct),
        top3ContributionPct:newsImpactPercentage(current.top3ContributionPct),
        top5ContributionPct:newsImpactPercentage(current.top5ContributionPct),
        top1DeltaPctPoints,
        top3DeltaPctPoints,
        top5DeltaPctPoints,
        top1Direction:direction(top1DeltaPctPoints),
        top3Direction:direction(top3DeltaPctPoints),
        top5Direction:direction(top5DeltaPctPoints),
      },
      weekly,
      methodology:'weekly_cumulative_share_of_total_overdue_minutes',
      thresholds:{
        ackMinutes:newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes:newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
        recoveryMinutes:newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
    impactRanking = {},
    impactTrend = {},
    concentration = {},
    concentrationTrend = {},
  ) {
    const rankingSource=impactRanking && typeof impactRanking==='object' && !Array.isArray(impactRanking) ? impactRanking : null;
    const trendSource=impactTrend && typeof impactTrend==='object' && !Array.isArray(impactTrend) ? impactTrend : null;
    const concentrationSource=concentration && typeof concentration==='object' && !Array.isArray(concentration) ? concentration : null;
    const concentrationTrendSource=concentrationTrend && typeof concentrationTrend==='object' && !Array.isArray(concentrationTrend) ? concentrationTrend : null;
    const topPair=Array.isArray(rankingSource?.ranking)
      && rankingSource.ranking[0]
      && typeof rankingSource.ranking[0]==='object'
      && !Array.isArray(rankingSource.ranking[0])
      ? rankingSource.ranking[0]
      : null;
    const rankingSummary=rankingSource?.summary && typeof rankingSource.summary==='object' && !Array.isArray(rankingSource.summary) ? rankingSource.summary : {};
    const trendSummary=trendSource?.summary && typeof trendSource.summary==='object' && !Array.isArray(trendSource.summary) ? trendSource.summary : {};
    const concentrationSummary=concentrationSource?.summary && typeof concentrationSource.summary==='object' && !Array.isArray(concentrationSource.summary) ? concentrationSource.summary : {};
    const concentrationTrendSummary=concentrationTrendSource?.summary && typeof concentrationTrendSource.summary==='object' && !Array.isArray(concentrationTrendSource.summary) ? concentrationTrendSource.summary : {};
    const available=[rankingSource,trendSource,concentrationSource,concentrationTrendSource].every(x=>x && x.available!==false);
    const generatedAt=[rankingSource?.generatedAt,trendSource?.generatedAt,concentrationTrendSource?.generatedAt,concentrationSource?.generatedAt]
      .find(value=>typeof value==='string' && value) || null;
    return {
      available,
      generatedAt,
      summary:{
        cumulativeOverdueMinutes:newsImpactNonNegativeNumber(rankingSummary.totalOverdueMinutes),
        cumulativeAckOverdueMinutes:newsImpactNonNegativeNumber(rankingSummary.ackOverdueMinutes),
        cumulativeRecoveryOverdueMinutes:newsImpactNonNegativeNumber(rankingSummary.recoveryOverdueMinutes),
        breachPairs:newsImpactCount(rankingSummary.pairs),
        activePairs:newsImpactCount(rankingSummary.activePairs),
        breachEpisodes:newsImpactCount(rankingSummary.breachEpisodes),
        currentWeekOverdueMinutes:newsImpactNonNegativeNumber(trendSummary.currentOverdueMinutes),
        previousWeekOverdueMinutes:newsImpactNonNegativeNumber(trendSummary.previousOverdueMinutes),
        weekDeltaMinutes:newsImpactSignedNumber(trendSummary.deltaMinutes),
        weeklyIncreasedPairs:newsImpactCount(trendSummary.increasedPairs),
        weeklyDecreasedPairs:newsImpactCount(trendSummary.decreasedPairs),
        weeklyUnchangedPairs:newsImpactCount(trendSummary.unchangedPairs),
        top1ContributionPct:newsImpactPercentage(concentrationSummary.top1ContributionPct),
        top3ContributionPct:newsImpactPercentage(concentrationSummary.top3ContributionPct),
        top5ContributionPct:newsImpactPercentage(concentrationSummary.top5ContributionPct),
        top1WeeklyDeltaPctPoints:newsImpactSignedNumber(concentrationTrendSummary.top1DeltaPctPoints),
        top3WeeklyDeltaPctPoints:newsImpactSignedNumber(concentrationTrendSummary.top3DeltaPctPoints),
        top5WeeklyDeltaPctPoints:newsImpactSignedNumber(concentrationTrendSummary.top5DeltaPctPoints),
        top1WeeklyDirection:newsImpactDirection(concentrationTrendSummary.top1Direction),
        top3WeeklyDirection:newsImpactDirection(concentrationTrendSummary.top3Direction),
        top5WeeklyDirection:newsImpactDirection(concentrationTrendSummary.top5Direction),
      },
      topPair:topPair && typeof topPair.reason==='string' && typeof topPair.action==='string' ? {
        reason:topPair.reason,
        reasonLabel:newsImpactText(topPair.reasonLabel,topPair.reason),
        action:topPair.action,
        actionLabel:newsImpactText(topPair.actionLabel,topPair.action),
        totalOverdueMinutes:newsImpactNonNegativeNumber(topPair.totalOverdueMinutes),
        contributionPct:newsImpactPercentage(topPair.contributionPct),
        activeEpisodes:newsImpactCount(topPair.activeEpisodes),
        ackOverdueMinutes:newsImpactNonNegativeNumber(topPair.ackOverdueMinutes),
        recoveryOverdueMinutes:newsImpactNonNegativeNumber(topPair.recoveryOverdueMinutes),
      } : null,
      sourceReleases:['RC93','RC94','RC95','RC96'],
      methodology:'summary_of_existing_slo_impact_views',
      thresholds:{
        ackMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.ackMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES)),
        criticalAckMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.criticalAckMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES)),
        recoveryMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.recoveryMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES)),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
    impactRanking = {},
    impactTrend = {},
    executiveSummary = {},
    options = {},
  ) {
    const rankingSource=impactRanking && typeof impactRanking==='object' && !Array.isArray(impactRanking) ? impactRanking : null;
    const trendSource=impactTrend && typeof impactTrend==='object' && !Array.isArray(impactTrend) ? impactTrend : null;
    const executiveSource=executiveSummary && typeof executiveSummary==='object' && !Array.isArray(executiveSummary) ? executiveSummary : null;
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const configuredLimit=newsImpactFiniteNumber(safeOptions.limit);
    const safeLimit=configuredLimit!==null && Number.isSafeInteger(configuredLimit)
      ? Math.max(1,Math.min(10,configuredLimit))
      : 5;
    const ranking=(rankingSource && Array.isArray(rankingSource.ranking) ? rankingSource.ranking : [])
      .filter(row=>
        row
        && typeof row==='object'
        && !Array.isArray(row)
        && typeof row.reason==='string'
        && row.reason
        && typeof row.action==='string'
        && row.action
        && newsImpactNonNegativeNumber(row.totalOverdueMinutes)>0
      );
    const trendPairs=(trendSource && Array.isArray(trendSource.pairs) ? trendSource.pairs : [])
      .filter(row=>
        row
        && typeof row==='object'
        && !Array.isArray(row)
        && typeof row.reason==='string'
        && row.reason
        && typeof row.action==='string'
        && row.action
      );
    const trendByKey=new Map(trendPairs.map(row=>[
      row.reason+'|'+row.action,
      row,
    ]));
    const rows=ranking.map(row=>{
      const key=row.reason+'|'+row.action;
      const trend=trendByKey.get(key) || {};
      const weekDeltaMinutes=newsImpactSignedNumber(trend.deltaMinutes);
      return {
        reason:row.reason,
        reasonLabel:newsImpactText(row.reasonLabel,row.reason),
        action:row.action,
        actionLabel:newsImpactText(row.actionLabel,row.action),
        totalOverdueMinutes:newsImpactNonNegativeNumber(row.totalOverdueMinutes),
        contributionPct:newsImpactPercentage(row.contributionPct),
        activeEpisodes:newsImpactCount(row.activeEpisodes),
        ackOverdueMinutes:newsImpactNonNegativeNumber(row.ackOverdueMinutes),
        recoveryOverdueMinutes:newsImpactNonNegativeNumber(row.recoveryOverdueMinutes),
        currentWeekOverdueMinutes:newsImpactNonNegativeNumber(trend.currentOverdueMinutes),
        previousWeekOverdueMinutes:newsImpactNonNegativeNumber(trend.previousOverdueMinutes),
        weekDeltaMinutes,
        weekDirection:weekDeltaMinutes>0 ? 'increased' : weekDeltaMinutes<0 ? 'decreased' : 'unchanged',
        currentContributionPct:newsImpactPercentage(trend.currentContributionPct),
      };
    }).sort((a,b)=>
      b.currentWeekOverdueMinutes-a.currentWeekOverdueMinutes
      || b.weekDeltaMinutes-a.weekDeltaMinutes
      || b.totalOverdueMinutes-a.totalOverdueMinutes
      || a.reason.localeCompare(b.reason)
      || a.action.localeCompare(b.action)
    ).slice(0,safeLimit).map((row,index)=>({...row,queuePosition:index+1}));
  
    const summary=executiveSource?.summary && typeof executiveSource.summary==='object' && !Array.isArray(executiveSource.summary)
      ? executiveSource.summary
      : {};
    const rankingSummary=rankingSource?.summary && typeof rankingSource.summary==='object' && !Array.isArray(rankingSource.summary)
      ? rankingSource.summary
      : {};
    const trendSummary=trendSource?.summary && typeof trendSource.summary==='object' && !Array.isArray(trendSource.summary)
      ? trendSource.summary
      : {};
    const preferNonNegative=(primary,fallback)=>{
      const value=newsImpactFiniteNumber(primary);
      return value!==null && value>=0 ? value : newsImpactNonNegativeNumber(fallback);
    };
    const preferSigned=(primary,fallback)=>{
      const value=newsImpactFiniteNumber(primary);
      return value!==null ? value : newsImpactSignedNumber(fallback);
    };
    const generatedAt=[executiveSource?.generatedAt,trendSource?.generatedAt,rankingSource?.generatedAt]
      .find(value=>typeof value==='string' && value) || null;
    return {
      available:[rankingSource,trendSource,executiveSource].every(x=>x && x.available!==false),
      generatedAt,
      summary:{
        queuedPairs:rows.length,
        breachPairs:newsImpactCount(preferNonNegative(summary.breachPairs,rankingSummary.pairs)),
        activePairs:newsImpactCount(preferNonNegative(summary.activePairs,rankingSummary.activePairs)),
        currentWeekOverdueMinutes:preferNonNegative(summary.currentWeekOverdueMinutes,trendSummary.currentOverdueMinutes),
        weekDeltaMinutes:preferSigned(summary.weekDeltaMinutes,trendSummary.deltaMinutes),
        increasingQueuedPairs:rows.filter(x=>x.weekDirection==='increased').length,
        decreasingQueuedPairs:rows.filter(x=>x.weekDirection==='decreased').length,
        unchangedQueuedPairs:rows.filter(x=>x.weekDirection==='unchanged').length,
      },
      rows,
      ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue',
      sourceReleases:['RC93','RC94','RC97'],
      thresholds:{
        ackMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.ackMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES)),
        criticalAckMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.criticalAckMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES)),
        recoveryMinutes:newsImpactNonNegativeNumber(rankingSource?.thresholds?.recoveryMinutes,newsImpactNonNegativeNumber(NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES)),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentCenter(strategyRows = [], incidentEvents = [], acknowledgements = [], evidenceReason = 'ok', options = {}) {
    const priorityRank={critical:0,high:1,medium:2,low:3};
    const safeOptions=options && typeof options==='object' && !Array.isArray(options) ? options : {};
    const optionAsOf=newsImpactFiniteNumber(safeOptions.asOfMs);
    const asOfMs=optionAsOf ?? Date.now();
    const safeStrategies=Array.isArray(strategyRows)
      ? strategyRows.filter(row=>row && typeof row==='object' && !Array.isArray(row) && typeof row.reason==='string' && row.reason && typeof row.action==='string' && row.action)
      : [];
    const safeEvents=Array.isArray(incidentEvents)
      ? incidentEvents.filter(row=>row && typeof row==='object' && !Array.isArray(row))
      : [];
    const safeAcknowledgements=Array.isArray(acknowledgements)
      ? acknowledgements.filter(row=>row && typeof row==='object' && !Array.isArray(row))
      : [];
    const current=new Map(safeStrategies.map(row=>[row.reason+'|'+row.action,row]));
    const ackMap=new Map(
      safeAcknowledgements
        .filter(row=>typeof row.reason==='string' && typeof row.action==='string' && typeof row.code==='string')
        .map(row=>[newsImpactRecoveryIncidentKey(row.reason,row.action,row.code),row]),
    );
    const groups=new Map();

    for (const event of safeEvents) {
      const reason=typeof event.reason==='string' ? event.reason : '';
      const action=typeof event.action==='string' ? event.action : '';
      const code=typeof event.guardReason==='string' && NEWS_IMPACT_RECOVERY_INCIDENT_CODES?.has?.(event.guardReason)
        ? event.guardReason
        : '';
      const at=typeof event.at==='string' ? event.at : '';
      if (!reason || !action || !code || !Number.isFinite(Date.parse(at))) continue;
      const key=newsImpactRecoveryIncidentKey(reason,action,code);
      const bucket=groups.get(key) || {
        code,
        priority:event.priority==='high' || event.priority==='medium' ? event.priority : (code==='performance_drift' ? 'high' : 'medium'),
        reason,
        reasonLabel:newsImpactText(event.reasonLabel,reason),
        action,
        actionLabel:newsImpactText(event.actionLabel,action),
        firstSeenAt:at,
        lastSeenAt:at,
        occurrences:0,
        lastStrategy:event.strategy==='adaptive' ? 'adaptive' : 'fixed',
        lastRecovery:newsImpactText(event.recovery),
        lastRecoveryLabel:newsImpactText(event.recoveryLabel,newsImpactText(event.recovery)),
        episodeStartedAt:newsImpactText(event.episodeStartedAt,at),
        episodeLastSeenAt:newsImpactText(event.episodeLastSeenAt,at),
        episodeRecoveredAt:newsImpactText(event.episodeRecoveredAt) || null,
        episodeOccurrences:Math.max(1,newsImpactCount(event.episodeOccurrences)),
      };
      bucket.occurrences+=1;
      if (Date.parse(at)<Date.parse(bucket.firstSeenAt)) bucket.firstSeenAt=at;
      if (Date.parse(at)>Date.parse(bucket.lastSeenAt)) {
        bucket.lastSeenAt=at;
        bucket.lastStrategy=event.strategy==='adaptive' ? 'adaptive' : bucket.lastStrategy;
        bucket.lastRecovery=newsImpactText(event.recovery,bucket.lastRecovery);
        bucket.lastRecoveryLabel=newsImpactText(event.recoveryLabel,bucket.lastRecoveryLabel);
        bucket.episodeStartedAt=newsImpactText(event.episodeStartedAt,at);
        bucket.episodeLastSeenAt=newsImpactText(event.episodeLastSeenAt,at);
        bucket.episodeRecoveredAt=newsImpactText(event.episodeRecoveredAt) || null;
        bucket.episodeOccurrences=Math.max(1,newsImpactCount(event.episodeOccurrences));
      }
      groups.set(key,bucket);
    }

    const withAcknowledgement=(item,active,currentOnly=false)=>{
      const ack=ackMap.get(newsImpactRecoveryIncidentKey(item.reason,item.action,item.code)) || null;
      const ackSeenAt=newsImpactText(ack?.incidentSeenAt);
      const ackAt=newsImpactText(ack?.acknowledgedAt);
      const acknowledged=active===true
        && currentOnly!==true
        && typeof item.lastSeenAt==='string'
        && Boolean(ack)
        && ackSeenAt===item.lastSeenAt
        && Number.isFinite(Date.parse(ackAt))
        && Date.parse(ackAt)>=Date.parse(item.lastSeenAt);
      const status=active===true ? 'active' : 'recovered';
      const startedAt=newsImpactText(item.episodeStartedAt,newsImpactText(item.firstSeenAt)) || null;
      const lastEpisodeSeenAt=newsImpactText(item.episodeLastSeenAt,newsImpactText(item.lastSeenAt)) || null;
      const recoveredAt=active===true ? null : (newsImpactText(item.episodeRecoveredAt) || null);
      const startedMs=startedAt ? Date.parse(startedAt) : NaN;
      const recoveredMs=recoveredAt ? Date.parse(recoveredAt) : NaN;
      const acknowledgedMs=acknowledged ? Date.parse(ackAt) : NaN;
      const ageMinutes=active===true && Number.isFinite(startedMs)
        ? Math.max(0,Math.floor((asOfMs-startedMs)/60000))
        : null;
      const ackLatencyMinutes=acknowledged && Number.isFinite(startedMs) && Number.isFinite(acknowledgedMs)
        ? Math.max(0,Math.round((acknowledgedMs-startedMs)/60000))
        : null;
      const recoveryLatencyMinutes=active!==true && Number.isFinite(startedMs) && Number.isFinite(recoveredMs)
        ? Math.max(0,Math.round((recoveredMs-startedMs)/60000))
        : null;
      const ackStatus=currentOnly===true || !Number.isFinite(startedMs)
        ? 'unavailable'
        : acknowledged
          ? (Number(ackLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'met' : 'breached')
          : active===true
            ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'breached' : 'pending')
            : 'unavailable';
      const recoveryStatus=currentOnly===true || !Number.isFinite(startedMs)
        ? 'unavailable'
        : active===true
          ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'breached' : 'pending')
          : Number.isFinite(recoveredMs)
            ? (Number(recoveryLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'met' : 'breached')
            : 'unavailable';
      let effectivePriority=item.priority==='high' || item.priority==='medium' ? item.priority : 'medium';
      let escalationReason='';
      if (active===true && recoveryStatus==='breached') {
        effectivePriority='critical';
        escalationReason='recovery_slo_breach';
      } else if (active===true && !acknowledged && Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) {
        effectivePriority='critical';
        escalationReason='ack_critical_overdue';
      } else if (active===true && !acknowledged && ackStatus==='breached') {
        effectivePriority=effectivePriority==='medium' ? 'high' : 'critical';
        escalationReason='ack_slo_breach';
      }
      return {
        ...item,
        status,
        acknowledged,
        acknowledgedAt:acknowledged ? ackAt : null,
        alertSuppressed:acknowledged,
        canAcknowledge:Boolean(active===true && currentOnly!==true && item.lastSeenAt && NEWS_IMPACT_RECOVERY_INCIDENT_CODES?.has?.(item.code)),
        runbook:newsImpactRecoveryIncidentRunbook(item.code),
        currentOnly:currentOnly===true,
        effectivePriority,
        escalated:effectivePriority!==(item.priority || 'medium'),
        escalationReason,
        slo:{
          startedAt,
          lastSeenAt:lastEpisodeSeenAt,
          recoveredAt,
          ageMinutes,
          ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          ackLatencyMinutes,
          recoveryLatencyMinutes,
          ackStatus,
          recoveryStatus,
        },
      };
    };

    const rows=[...groups.values()].map(item=>{
      const now=current.get(item.reason+'|'+item.action) || null;
      const active=Boolean(now && typeof now.guardReason==='string' && now.guardReason===item.code);
      return withAcknowledgement({
        ...item,
        currentStrategy:now?.strategy==='adaptive' ? 'adaptive' : (now ? 'fixed' : ''),
        currentRecovery:newsImpactText(now?.selectedRecovery),
        currentRecoveryLabel:newsImpactText(now?.selectedRecoveryLabel,newsImpactText(now?.selectedRecovery)),
        currentGuardReason:newsImpactText(now?.guardReason),
      },active,false);
    });

    for (const now of safeStrategies) {
      if (typeof now.guardReason!=='string' || !NEWS_IMPACT_RECOVERY_INCIDENT_CODES?.has?.(now.guardReason)) continue;
      const exists=rows.some(x=>x.reason===now.reason && x.action===now.action && x.code===now.guardReason && x.status==='active');
      if (exists) continue;
      rows.push(withAcknowledgement({
        code:now.guardReason,
        priority:now.guardReason==='performance_drift' ? 'high' : 'medium',
        reason:now.reason,
        reasonLabel:newsImpactText(now.reasonLabel,now.reason),
        action:now.action,
        actionLabel:newsImpactText(now.actionLabel,now.action),
        firstSeenAt:null,
        lastSeenAt:null,
        occurrences:0,
        lastStrategy:now.strategy==='adaptive' ? 'adaptive' : 'fixed',
        lastRecovery:newsImpactText(now.selectedRecovery),
        lastRecoveryLabel:newsImpactText(now.selectedRecoveryLabel,newsImpactText(now.selectedRecovery)),
        currentStrategy:now.strategy==='adaptive' ? 'adaptive' : 'fixed',
        currentRecovery:newsImpactText(now.selectedRecovery),
        currentRecoveryLabel:newsImpactText(now.selectedRecoveryLabel,newsImpactText(now.selectedRecovery)),
        currentGuardReason:now.guardReason,
      },true,true));
    }

    const safeEvidenceReason=typeof evidenceReason==='string' ? evidenceReason : 'evidence_unavailable';
    if (safeEvidenceReason!=='ok') {
      rows.unshift({
        code:'strategy_evidence_unavailable',
        priority:'medium',
        reason:'',
        reasonLabel:'Recovery Strategy',
        action:'',
        actionLabel:'',
        firstSeenAt:null,
        lastSeenAt:null,
        occurrences:0,
        lastStrategy:'fixed',
        lastRecovery:'',
        lastRecoveryLabel:'',
        status:'active',
        currentStrategy:'fixed',
        currentRecovery:'',
        currentRecoveryLabel:'',
        currentGuardReason:safeEvidenceReason || 'evidence_unavailable',
        currentOnly:true,
        acknowledged:false,
        acknowledgedAt:null,
        alertSuppressed:false,
        canAcknowledge:false,
        runbook:newsImpactRecoveryIncidentRunbook('strategy_evidence_unavailable'),
        effectivePriority:'medium',
        escalated:false,
        escalationReason:'',
        slo:{
          startedAt:null,lastSeenAt:null,recoveredAt:null,ageMinutes:null,
          ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          ackLatencyMinutes:null,recoveryLatencyMinutes:null,ackStatus:'unavailable',recoveryStatus:'unavailable',
        },
      });
    }

    return rows.sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1)
      || (a.acknowledged?1:0)-(b.acknowledged?1:0)
      || (priorityRank[a.effectivePriority || a.priority] ?? 9)-(priorityRank[b.effectivePriority || b.priority] ?? 9)
      || (Date.parse(b.lastSeenAt || 0)-Date.parse(a.lastSeenAt || 0))
      || a.reason.localeCompare(b.reason)
      || a.action.localeCompare(b.action))
      .slice(0,30);
  }

  function summarizeNewsImpactRecoveryIncidents(rows = []) {
    const list=Array.isArray(rows)
      ? rows.filter(row=>row && typeof row==='object' && !Array.isArray(row))
      : [];
    const ackLatencies=list.map(x=>newsImpactNonNegativeNumber(x?.slo?.ackLatencyMinutes,NaN)).filter(Number.isFinite);
    const recoveryLatencies=list.map(x=>newsImpactNonNegativeNumber(x?.slo?.recoveryLatencyMinutes,NaN)).filter(Number.isFinite);
    return {
      total:list.length,
      active:list.filter(x=>x.status==='active').length,
      recovered:list.filter(x=>x.status==='recovered').length,
      highActive:list.filter(x=>x.status==='active' && x.priority==='high').length,
      mediumActive:list.filter(x=>x.status==='active' && x.priority==='medium').length,
      acknowledgedActive:list.filter(x=>x.status==='active' && x.acknowledged===true).length,
      unacknowledgedActive:list.filter(x=>x.status==='active' && x.acknowledged!==true).length,
      suppressedAlerts:list.filter(x=>x.status==='active' && x.alertSuppressed===true).length,
      escalatedActive:list.filter(x=>x.status==='active' && x.escalated===true).length,
      criticalActive:list.filter(x=>x.status==='active' && x.effectivePriority==='critical').length,
      ackSloBreached:list.filter(x=>x.status==='active' && x?.slo?.ackStatus==='breached').length,
      recoverySloBreached:list.filter(x=>x.status==='active' && x?.slo?.recoveryStatus==='breached').length,
      ackMeasured:ackLatencies.length,
      recoveryMeasured:recoveryLatencies.length,
      avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
      avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
      latest:list
        .filter(x=>typeof x.lastSeenAt==='string' && Number.isFinite(Date.parse(x.lastSeenAt)))
        .sort((a,b)=>Date.parse(b.lastSeenAt)-Date.parse(a.lastSeenAt))[0] || null,
    };
  }

  function newsImpactRecoveryIncidentSloImpactConcentrationDrill() {
    const ranking={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{pairs:6,totalOverdueMinutes:1000},
      thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
      ranking:[
        {reason:'server_error',action:'full_ai',contributionPct:40,totalOverdueMinutes:400,activeEpisodes:1},
        {reason:'timeout',action:'share',contributionPct:25,totalOverdueMinutes:250,activeEpisodes:1},
        {reason:'provider_unavailable',action:'full_ai',contributionPct:15,totalOverdueMinutes:150,activeEpisodes:0},
        {reason:'match_missing',action:'news',contributionPct:10,totalOverdueMinutes:100,activeEpisodes:1},
        {reason:'data_invalid',action:'recheck',contributionPct:5,totalOverdueMinutes:50,activeEpisodes:0},
        {reason:'other',action:'market',contributionPct:5,totalOverdueMinutes:50,activeEpisodes:0},
      ],
    };
    const result=buildNewsImpactRecoveryIncidentSloImpactConcentration(ranking);
    return {
      pass:result.summary.pairs===6
        && result.summary.totalOverdueMinutes===1000
        && result.summary.top1ContributionPct===40
        && result.summary.top3ContributionPct===80
        && result.summary.top5ContributionPct===95
        && result.summary.residualAfterTop5Pct===5
        && result.summary.coveredPairs===5
        && result.rows.length===5
        && result.rows[2]?.cumulativeContributionPct===80
        && result.methodology==='cumulative_share_of_total_overdue_minutes'
        && result.thresholds.source==='rc87_existing_slo'
        && result.routingChanged===false
        && result.persistence==='none'
        && result.privacy.telegramIdsExposed===false,
      cases:13,
    };
  }
  
  
  function newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill() {
    const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
    const mk=(reason,action,startedAt,ackAt,recoveredAt)=>({
      reason,reasonLabel:reason,action,actionLabel:action,startedAt,firstAcknowledgedAt:ackAt,recoveredAt,
    });
    const episodes=[
      mk('a','full_ai','2026-09-10T00:00:00.000Z','2026-09-10T02:00:00.000Z','2026-09-10T02:10:00.000Z'),
      mk('b','share','2026-09-11T00:00:00.000Z','2026-09-11T01:30:00.000Z','2026-09-11T01:40:00.000Z'),
      mk('c','news','2026-09-12T00:00:00.000Z','2026-09-12T01:00:00.000Z','2026-09-12T01:10:00.000Z'),
      mk('d','market','2026-09-13T00:00:00.000Z','2026-09-13T00:40:00.000Z','2026-09-13T00:50:00.000Z'),
      mk('e','recheck','2026-09-14T00:00:00.000Z','2026-09-14T00:40:00.000Z','2026-09-14T00:50:00.000Z'),
      mk('f','squads','2026-09-15T00:00:00.000Z','2026-09-15T00:40:00.000Z','2026-09-15T00:50:00.000Z'),
      mk('a','full_ai','2026-09-17T00:00:00.000Z','2026-09-17T02:30:00.000Z','2026-09-17T02:40:00.000Z'),
      mk('b','share','2026-09-18T00:00:00.000Z','2026-09-18T01:30:00.000Z','2026-09-18T01:40:00.000Z'),
      mk('c','news','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z','2026-09-19T01:10:00.000Z'),
      mk('d','market','2026-09-20T00:00:00.000Z','2026-09-20T00:50:00.000Z','2026-09-20T01:00:00.000Z'),
      mk('e','recheck','2026-09-21T00:00:00.000Z','2026-09-21T00:40:00.000Z','2026-09-21T00:50:00.000Z'),
      mk('f','squads','2026-09-22T00:00:00.000Z','2026-09-22T00:40:00.000Z','2026-09-22T00:50:00.000Z'),
    ];
    const result=buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(episodes,{asOfMs,weeks:2});
    const previous=result.weekly[0];
    const current=result.weekly[1];
    return {
      pass:result.weekly.length===2
        && previous?.totalOverdueMinutes===210
        && previous?.top1ContributionPct===42.9
        && previous?.top3ContributionPct===85.7
        && previous?.top5ContributionPct===95.2
        && current?.totalOverdueMinutes===250
        && current?.top1ContributionPct===48
        && current?.top3ContributionPct===84
        && current?.top5ContributionPct===96
        && result.summary.top1DeltaPctPoints===5.1
        && result.summary.top3DeltaPctPoints===-1.7
        && result.summary.top5DeltaPctPoints===0.8
        && result.summary.top1Direction==='increased'
        && result.summary.top3Direction==='decreased'
        && result.summary.top5Direction==='increased'
        && result.methodology==='weekly_cumulative_share_of_total_overdue_minutes'
        && result.thresholds.source==='rc87_existing_slo'
        && result.routingChanged===false
        && result.persistence==='none'
        && result.privacy.telegramIdsExposed===false,
      cases:18,
    };
  }
  
  
  function newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill() {
    const ranking={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{pairs:4,activePairs:2,breachEpisodes:7,totalOverdueMinutes:1000,ackOverdueMinutes:650,recoveryOverdueMinutes:350},
      thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
      ranking:[
        {reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',totalOverdueMinutes:400,contributionPct:40,activeEpisodes:1,ackOverdueMinutes:250,recoveryOverdueMinutes:150},
      ],
    };
    const trend={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{currentOverdueMinutes:300,previousOverdueMinutes:220,deltaMinutes:80,increasedPairs:2,decreasedPairs:1,unchangedPairs:1},
    };
    const concentration={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{top1ContributionPct:40,top3ContributionPct:85,top5ContributionPct:100},
    };
    const concentrationTrend={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{
        top1DeltaPctPoints:5,
        top3DeltaPctPoints:-2,
        top5DeltaPctPoints:0,
        top1Direction:'increased',
        top3Direction:'decreased',
        top5Direction:'unchanged',
      },
    };
    const result=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(ranking,trend,concentration,concentrationTrend);
    return {
      pass:result.available===true
        && result.summary.cumulativeOverdueMinutes===1000
        && result.summary.cumulativeAckOverdueMinutes===650
        && result.summary.cumulativeRecoveryOverdueMinutes===350
        && result.summary.currentWeekOverdueMinutes===300
        && result.summary.weekDeltaMinutes===80
        && result.summary.activePairs===2
        && result.summary.top1ContributionPct===40
        && result.summary.top3ContributionPct===85
        && result.summary.top1WeeklyDeltaPctPoints===5
        && result.summary.top3WeeklyDirection==='decreased'
        && result.topPair?.reason==='server_error'
        && result.topPair?.totalOverdueMinutes===400
        && result.sourceReleases.join(',')==='RC93,RC94,RC95,RC96'
        && result.methodology==='summary_of_existing_slo_impact_views'
        && result.thresholds.source==='rc87_existing_slo'
        && result.routingChanged===false
        && result.persistence==='none'
        && result.privacy.telegramIdsExposed===false,
      cases:19,
    };
  }
  
  
  function newsImpactRecoveryIncidentSloImpactFocusQueueDrill() {
    const ranking={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{pairs:4,activePairs:3},
      thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
      ranking:[
        {reason:'a',action:'full_ai',totalOverdueMinutes:900,contributionPct:45,activeEpisodes:1,ackOverdueMinutes:500,recoveryOverdueMinutes:400},
        {reason:'b',action:'share',totalOverdueMinutes:700,contributionPct:35,activeEpisodes:1,ackOverdueMinutes:400,recoveryOverdueMinutes:300},
        {reason:'c',action:'news',totalOverdueMinutes:300,contributionPct:15,activeEpisodes:1,ackOverdueMinutes:200,recoveryOverdueMinutes:100},
        {reason:'d',action:'market',totalOverdueMinutes:100,contributionPct:5,activeEpisodes:0,ackOverdueMinutes:100,recoveryOverdueMinutes:0},
      ],
    };
    const trend={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{currentOverdueMinutes:500,deltaMinutes:80},
      pairs:[
        {reason:'a',action:'full_ai',currentOverdueMinutes:180,previousOverdueMinutes:200,deltaMinutes:-20,direction:'decreased',currentContributionPct:36},
        {reason:'b',action:'share',currentOverdueMinutes:210,previousOverdueMinutes:120,deltaMinutes:90,direction:'increased',currentContributionPct:42},
        {reason:'c',action:'news',currentOverdueMinutes:90,previousOverdueMinutes:80,deltaMinutes:10,direction:'increased',currentContributionPct:18},
        {reason:'d',action:'market',currentOverdueMinutes:20,previousOverdueMinutes:20,deltaMinutes:0,direction:'unchanged',currentContributionPct:4},
      ],
    };
    const executive={
      available:true,
      generatedAt:'2026-09-23T18:00:00.000Z',
      summary:{breachPairs:4,activePairs:3,currentWeekOverdueMinutes:500,weekDeltaMinutes:80},
    };
    const result=buildNewsImpactRecoveryIncidentSloImpactFocusQueue(ranking,trend,executive,{limit:3});
    return {
      pass:result.summary.queuedPairs===3
        && result.summary.breachPairs===4
        && result.summary.activePairs===3
        && result.summary.currentWeekOverdueMinutes===500
        && result.summary.weekDeltaMinutes===80
        && result.summary.increasingQueuedPairs===2
        && result.summary.decreasingQueuedPairs===1
        && result.rows[0]?.reason==='b'
        && result.rows[0]?.queuePosition===1
        && result.rows[1]?.reason==='a'
        && result.rows[2]?.reason==='c'
        && result.ordering==='current_week_overdue_then_week_delta_then_cumulative_overdue'
        && result.thresholds.source==='rc87_existing_slo'
        && result.routingChanged===false
        && result.persistence==='none'
        && result.privacy.telegramIdsExposed===false,
      cases:16,
    };
  }
  
  function newsImpactRecoveryIncidentSloDrill() {
    const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
    const failures=[
      {created_at:'2026-09-23T15:00:00.000Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
      {created_at:'2026-09-23T15:10:00.000Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
      {created_at:'2026-09-23T16:00:00.000Z',metadata:{reason:'timeout',action:'share',recovery:'retry_soon',strategy:'fixed',strategy_guard:'recent_regression'}},
      {created_at:'2026-09-23T16:40:00.000Z',metadata:{reason:'timeout',action:'share',recovery:'retry_soon',strategy:'fixed',strategy_guard:'fixed_default'}},
      {created_at:'2026-09-23T11:00:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',recovery:'retry_later',strategy:'fixed',strategy_guard:'performance_drift'}},
    ];
    const events=buildNewsImpactRecoveryIncidentEvents(failures);
    const acknowledgements=buildNewsImpactRecoveryIncidentAcknowledgements([
      {created_at:'2026-09-23T11:20:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-23T11:00:00.000Z'}},
    ]);
    const current=[
      {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry',selectedRecoveryLabel:'повторить',guardReason:'performance_drift'},
      {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',selectedRecovery:'retry_soon',selectedRecoveryLabel:'повторить скоро',guardReason:'fixed_default'},
      {reason:'provider_unavailable',reasonLabel:'Источник данных недоступен',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry_later',selectedRecoveryLabel:'повторить позже',guardReason:'performance_drift'},
    ];
    const incidents=buildNewsImpactRecoveryIncidentCenter(current,events,acknowledgements,'ok',{asOfMs});
    const summary=summarizeNewsImpactRecoveryIncidents(incidents);
    const server=incidents.find(x=>x.reason==='server_error');
    const timeout=incidents.find(x=>x.reason==='timeout');
    const provider=incidents.find(x=>x.reason==='provider_unavailable');
    return {
      pass:server?.status==='active'
        && server?.slo?.ageMinutes===180
        && server?.slo?.ackStatus==='breached'
        && server?.effectivePriority==='critical'
        && timeout?.status==='recovered'
        && timeout?.slo?.recoveryLatencyMinutes===40
        && timeout?.slo?.recoveryStatus==='met'
        && provider?.acknowledged===true
        && provider?.slo?.ackLatencyMinutes===20
        && provider?.slo?.recoveryStatus==='breached'
        && provider?.effectivePriority==='critical'
        && summary.criticalActive===2
        && summary.ackSloBreached===1
        && summary.recoverySloBreached===1,
      cases:14,
    };
  }
  
  function newsImpactRecoveryIncidentAckDrill() {
    const events=[
      {at:'2026-09-10T10:00:00.000Z',reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',recovery:'retry',recoveryLabel:'повторить',guardReason:'performance_drift',priority:'high'},
      {at:'2026-09-12T10:00:00.000Z',reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',recovery:'retry_soon',recoveryLabel:'повторить скоро',guardReason:'recent_regression',priority:'medium'},
    ];
    const ackRows=[
      {created_at:'2026-09-10T10:05:00.000Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-10T10:00:00.000Z'}},
      {created_at:'2026-09-12T09:00:00.000Z',metadata:{reason:'timeout',action:'share',incident_guard:'recent_regression',incident_seen_at:'2026-09-11T10:00:00.000Z'}},
    ];
    const acknowledgements=buildNewsImpactRecoveryIncidentAcknowledgements(ackRows);
    const current=[
      {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry',selectedRecoveryLabel:'повторить',guardReason:'performance_drift'},
      {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',selectedRecovery:'retry_soon',selectedRecoveryLabel:'повторить скоро',guardReason:'recent_regression'},
    ];
    const incidents=buildNewsImpactRecoveryIncidentCenter(current,events,acknowledgements,'ok');
    const alerts=buildNewsImpactRecoveryAdminAlerts(current,'ok',incidents);
    const drift=incidents.find(x=>x.code==='performance_drift');
    const regression=incidents.find(x=>x.code==='recent_regression');
    return {
      pass:drift?.acknowledged===true
        && drift?.alertSuppressed===true
        && drift?.canAcknowledge===true
        && regression?.acknowledged===false
        && alerts.some(x=>x.code==='recent_regression')
        && !alerts.some(x=>x.code==='performance_drift')
        && newsImpactRecoveryIncidentRunbook('performance_drift').steps.length>=3
        && !Object.prototype.hasOwnProperty.call(drift || {},'telegram_id'),
      cases:8,
    };
  }
  
  function newsImpactRecoveryKeyboard(request, decision, action, fixtureId, recovery = 'retry') {
    const r=cleanNewsImpactRecoveryCode(recovery) || 'retry';
    const retryLabel=r==='retry_soon' ? '🔄 Повторить через несколько секунд'
      : r==='retry_later' ? '🕒 Повторить позже'
        : r==='wait_quota_reset' ? '⏳ Повторить после обновления лимита'
          : '🔄 Повторить';
    const rows=[];
    if (r==='open_search') {
      rows.push([{text:'🔎 Выбрать другой матч',web_app:{url:telegramWebAppUrl(request,{view:'search'})}}]);
    } else if (r==='open_full_ai') {
      rows.push([{text:'📊 Открыть полный AI',web_app:{url:newsImpactRecoveryAnalysisUrl(request,fixtureId,decision,action,'open_full_ai')}}]);
    } else {
      rows.push([{text:retryLabel,callback_data:newsImpactRecoveryCallback(decision,action,r,fixtureId)}]);
    }
    if (action!=='full_ai' && r!=='open_full_ai') rows.push([{text:'📊 Открыть полный AI',web_app:{url:newsImpactRecoveryAnalysisUrl(request,fixtureId,decision,action,'open_full_ai')}}]);
    return {inline_keyboard:rows};
  }
  
  async function sendNewsImpactRecoveryMessage(request,cfg,{userId,chatId,fixtureId,decision,action,error,fallback='server_error'}={}) {
    const reason=newsImpactFailureCode(error,fallback);
    const recovery=await selectNewsImpactRecoveryStrategy(cfg,reason,action);
    await recordNewsImpactFailure(cfg,{
      userId,fixtureId,decision,action,channel:'telegram',reason,recovery:recovery.code,strategy:recovery.strategy,strategyReason:recovery.guardReason,status:Number(error?.status || 0),
    });
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      text:`⚠️ ${recovery.message}`,
      reply_markup:newsImpactRecoveryKeyboard(request,decision,action,fixtureId,recovery.code),
    }).catch(()=>null);
    return {reason,recovery};
  }
  
  function newsImpactFunnelConfidenceDrill() {
    const insufficient=newsImpactConversionConfidence(1,3);
    const early=newsImpactConversionConfidence(5,10);
    const stable=newsImpactConversionConfidence(24,30);
    const booleanSample=newsImpactConversionConfidence(true,true);
    const forgedBottleneck=newsImpactActionFunnelBottleneck([
      {code:'forged',users:1,conversionPct:0,confidence:{eligibleForBottleneck:true}},
    ]);
    return {
      pass:insufficient.status==='insufficient'
        && insufficient.eligibleForBottleneck===false
        && early.status==='early'
        && early.eligibleForBottleneck===true
        && early.lowerPct<50
        && early.upperPct>50
        && stable.status==='stable'
        && stable.stable===true
        && booleanSample.status==='empty'
        && forgedBottleneck===null,
      cases:10,
    };
  }
  
  function newsImpactTrendConfidence(value) {
    if (!value || typeof value!=='object' || Array.isArray(value)) return null;
    if (value.eligibleForBottleneck!==true) return null;
    const lowerPct=newsImpactFiniteNumber(value.lowerPct);
    const upperPct=newsImpactFiniteNumber(value.upperPct);
    if (
      lowerPct===null
      || upperPct===null
      || lowerPct<0
      || upperPct>100
      || lowerPct>upperPct
    ) return null;
    return {lowerPct,upperPct};
  }

  function newsImpactTrendSignal(current = {}, previous = {}) {
    const currentRow=current && typeof current==='object' && !Array.isArray(current) ? current : {};
    const previousRow=previous && typeof previous==='object' && !Array.isArray(previous) ? previous : {};
    const minUsers=newsImpactSampleThreshold(NEWS_IMPACT_FUNNEL_MIN_USERS,10);
    if (newsImpactCount(currentRow.users)<minUsers || newsImpactCount(previousRow.users)<minUsers) return 'insufficient';
    const currentConfidence=newsImpactTrendConfidence(currentRow.confidence);
    const previousConfidence=newsImpactTrendConfidence(previousRow.confidence);
    if (!currentConfidence || !previousConfidence) return 'insufficient';
    if (currentConfidence.lowerPct>previousConfidence.upperPct) return 'improved';
    if (currentConfidence.upperPct<previousConfidence.lowerPct) return 'weakened';
    return 'uncertain';
  }
  
  function buildNewsImpactActionTrend(currentRows = [], previousRows = []) {
    const safeCurrent=Array.isArray(currentRows) ? currentRows : [];
    const safePrevious=Array.isArray(previousRows) ? previousRows : [];
    const previousByCode=new Map(
      safePrevious
        .filter(row=>row && typeof row==='object' && !Array.isArray(row) && typeof row.code==='string' && row.code)
        .map(row=>[row.code,row]),
    );
    return safeCurrent
      .filter(current=>current && typeof current==='object' && !Array.isArray(current) && typeof current.code==='string' && current.code)
      .map(current=>{
      const code=current.code;
      const label=typeof current.label==='string' ? current.label : code;
      const previous=previousByCode.get(code) || {
        code,label,
        users:0,actedUsers:0,conversionPct:0,
        confidence:newsImpactConversionConfidence(0,0),
      };
      const currentPctRaw=newsImpactFiniteNumber(current.conversionPct);
      const previousPctRaw=newsImpactFiniteNumber(previous.conversionPct);
      const currentPctValid=currentPctRaw!==null && currentPctRaw>=0 && currentPctRaw<=100;
      const previousPctValid=previousPctRaw!==null && previousPctRaw>=0 && previousPctRaw<=100;
      const currentPct=currentPctValid ? currentPctRaw : 0;
      const previousPct=previousPctValid ? previousPctRaw : 0;
      const signal=currentPctValid && previousPctValid
        ? newsImpactTrendSignal(current,previous)
        : 'insufficient';
      const deltaPctPoints=currentPctValid && previousPctValid
        ? Math.round((currentPct-previousPct)*10)/10
        : 0;
      return {
        code,
        label,
        signal,
        deltaPctPoints,
        currentUsers:newsImpactCount(current.users),
        previousUsers:newsImpactCount(previous.users),
        currentPct,
        previousPct,
        currentConfidence:current.confidence && typeof current.confidence==='object' && !Array.isArray(current.confidence)
          ? current.confidence
          : newsImpactConversionConfidence(0,0),
        previousConfidence:previous.confidence && typeof previous.confidence==='object' && !Array.isArray(previous.confidence)
          ? previous.confidence
          : newsImpactConversionConfidence(0,0),
      };
    });
  }
  
  function newsImpactActionTrendDrill() {
    const current=[
      {code:'material',label:'material',users:30,conversionPct:66.7,confidence:newsImpactConversionConfidence(20,30)},
      {code:'stable',label:'stable',users:30,conversionPct:50,confidence:newsImpactConversionConfidence(15,30)},
      {code:'detail',label:'detail',users:5,conversionPct:40,confidence:newsImpactConversionConfidence(2,5)},
    ];
    const previous=[
      {code:'material',label:'material',users:30,conversionPct:16.7,confidence:newsImpactConversionConfidence(5,30)},
      {code:'stable',label:'stable',users:30,conversionPct:46.7,confidence:newsImpactConversionConfidence(14,30)},
      {code:'detail',label:'detail',users:5,conversionPct:20,confidence:newsImpactConversionConfidence(1,5)},
    ];
    const trend=buildNewsImpactActionTrend(current,previous);
    const forged=newsImpactTrendSignal(
      {confidence:{eligibleForBottleneck:'true',lowerPct:90,upperPct:100}},
      {confidence:{eligibleForBottleneck:true,lowerPct:0,upperPct:10}},
    );
    const malformed=buildNewsImpactActionTrend({broken:true},null);
    return {
      pass:trend.find(x=>x.code==='material')?.signal==='improved'
        && trend.find(x=>x.code==='stable')?.signal==='uncertain'
        && trend.find(x=>x.code==='detail')?.signal==='insufficient'
        && trend.find(x=>x.code==='material')?.deltaPctPoints===50
        && forged==='insufficient'
        && malformed.length===0,
      cases:6,
    };
  }
  
  function newsImpactDecisionKeyboard(request, match = {}, favorites = [], newsImpact = null) {
    const fixtureId=newsImpactPositiveId(match?.fixtureId);
    if (!fixtureId) {
      try {
        const fallback=typeof footballBotKeyboard==='function' ? footballBotKeyboard(request) : null;
        return fallback && typeof fallback==='object' && !Array.isArray(fallback)
          ? fallback
          : {inline_keyboard:[]};
      } catch {
        return {inline_keyboard:[]};
      }
    }
    const card=newsImpactDecisionCard(newsImpact);
    const decision=cleanNewsImpactDecisionCode(card?.code) || 'unavailable';
    const tracked=(action,text)=>{
      const callbackData=newsImpactActionCallback(decision,action,fixtureId);
      return callbackData ? {text,callback_data:callbackData} : null;
    };
    const fullAi=(text)=>{
      const url=newsImpactTrackedAnalysisUrl(request,fixtureId,decision);
      return url ? {text,web_app:{url}} : null;
    };
    const rows=[];
    const pushRow=(...buttons)=>{
      const safeButtons=buttons.filter(Boolean);
      if (safeButtons.length) rows.push(safeButtons);
    };
    if (decision==='material') {
      pushRow(fullAi('📊 Открыть обновлённый AI-разбор'));
      pushRow(tracked('squads','👥 Проверить составы'),tracked('market','💹 Проверить рынок'));
    } else if (decision==='detail') {
      pushRow(fullAi('🧠 Открыть полный разбор'));
      pushRow(tracked('recheck','🔄 Перепроверить AI'));
    } else if (decision==='stable') {
      pushRow(tracked('news','📰 Ещё новости'),fullAi('📊 Полный AI-разбор'));
    } else {
      pushRow(tracked('recheck','🔄 Повторить AI-проверку'),fullAi('📊 Полный AI-разбор'));
    }
    let favoriteRow=[];
    try {
      const candidate=typeof favoriteMatchTeamRow==='function' ? favoriteMatchTeamRow(match,Array.isArray(favorites) ? favorites : []) : [];
      favoriteRow=Array.isArray(candidate) ? candidate.filter(Boolean) : [];
    } catch {}
    if (favoriteRow.length) rows.push(favoriteRow);
    pushRow(tracked('share','↗ Поделиться матчем'));
    return {inline_keyboard:rows};
  }
  function newsImpactDecisionDrill() {
    const material=newsImpactDecisionCard({requested:true,compared:true,material:true,stable:false,reasonCode:'material_change'});
    const stable=newsImpactDecisionCard({requested:true,compared:true,material:false,stable:true,reasonCode:'stable'});
    const guarded=newsImpactDecisionCard({requested:true,compared:false,material:false,stable:true,reasonCode:'snapshot_not_before_news'});
    const malformed=newsImpactDecisionCard({requested:true,compared:'false',material:'true',stable:'true',reasonCode:'snapshot_not_before_news'});
    return {pass:material?.code==='material'
      && material?.priority===4
      && stable?.code==='stable'
      && guarded?.code==='guarded'
      && guarded?.label==='Причинность не подтверждается'
      && malformed?.code==='guarded'
      && newsImpactDecisionCard({requested:'true',compared:true})===null,
      cases:7};
  }

  return {
    newsImpactDecisionCard,
    cleanNewsImpactDecisionCode,
    cleanNewsImpactActionCode,
    newsImpactActionCallback,
    newsImpactTrackedAnalysisUrl,
    cleanNewsImpactRecoveryCode,
    newsImpactRecoveryCallback,
    newsImpactRecoveryAnalysisUrl,
    newsImpactActionDrill,
    newsImpactRowDecision,
    newsImpactRowAction,
    newsImpactConversionConfidence,
    newsImpactEventTime,
    buildNewsImpactActionFunnel,
    newsImpactActionFunnelBottleneck,
    newsImpactActionFunnelDrill,
    newsImpactTemporalAttributionDrill,
    newsImpactOutcomeCode,
    recordNewsImpactOutcome,
    newsImpactJourneyKey,
    buildNewsImpactActionOutcomeQuality,
    newsImpactOutcomeBottleneck,
    newsImpactOutcomeQualityDrill,
    newsImpactFailureCode,
    newsImpactRecoveryForFailure,
    recordNewsImpactFailure,
    buildNewsImpactFailureDiagnostics,
    newsImpactFailureDiagnosticsDrill,
    recordNewsImpactRecoveryAttempt,
    newsImpactRecoveryJourneyKey,
    buildNewsImpactRecoveryEffectiveness,
    newsImpactRecoveryBest,
    newsImpactRecoveryEffectivenessDrill,
    newsImpactRecoveryPresentation,
    buildNewsImpactRecoveryStrategyEvidence,
    newsImpactRecoveryStrategyDecision,
    buildNewsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryDriftDecision,
    buildNewsImpactRecoveryDriftMatrix,
    buildNewsImpactRecoveryTransitionHistory,
    summarizeNewsImpactRecoveryTransitions,
    buildNewsImpactRecoveryAdminAlerts,
    summarizeNewsImpactRecoveryAlerts,
    buildNewsImpactRecoveryIncidentEvents,
    newsImpactRecoveryIncidentKey,
    newsImpactRecoveryIncidentRunbook,
    buildNewsImpactRecoveryIncidentAcknowledgements,
    buildNewsImpactRecoveryIncidentAcknowledgementHistory,
    buildNewsImpactRecoveryIncidentEpisodeHistory,
    newsImpactRecoveryEpisodeSloState,
    newsImpactRecoverySloPct,
    buildNewsImpactRecoveryIncidentSloDashboard,
    buildNewsImpactRecoveryIncidentSloBreachFeed,
    buildNewsImpactRecoveryIncidentSloBreachWatchlist,
    buildNewsImpactRecoveryIncidentSloBreachTriage,
    newsImpactRecoveryIncidentTriageStageAt,
    buildNewsImpactRecoveryIncidentSloBreachTriageTrend,
    newsImpactRecoveryIncidentSloBurden,
    buildNewsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentOverdueWithinWindow,
    buildNewsImpactRecoveryIncidentSloBreachImpactTrend,
    buildNewsImpactRecoveryIncidentSloImpactConcentration,
    buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend,
    buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary,
    buildNewsImpactRecoveryIncidentSloImpactFocusQueue,
    buildNewsImpactRecoveryIncidentCenter,
    summarizeNewsImpactRecoveryIncidents,
    loadNewsImpactRecoveryStrategyEvidence,
    selectNewsImpactRecoveryStrategy,
    newsImpactRecoveryStrategyDrill,
    newsImpactRecoveryStabilityDrill,
    newsImpactRecoveryDriftDrill,
    newsImpactRecoveryTransitionDrill,
    newsImpactRecoveryIncidentDrill,
    newsImpactRecoveryIncidentSloDashboardDrill,
    newsImpactRecoveryIncidentSloBreachFeedDrill,
    newsImpactRecoveryIncidentSloBreachWatchlistDrill,
    newsImpactRecoveryIncidentSloBreachTriageDrill,
    newsImpactRecoveryIncidentSloBreachTriageTrendDrill,
    newsImpactRecoveryIncidentSloBreachImpactRankingDrill,
    newsImpactRecoveryIncidentSloBreachImpactTrendDrill,
    newsImpactRecoveryIncidentSloImpactConcentrationDrill,
    newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill,
    newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill,
    newsImpactRecoveryIncidentSloImpactFocusQueueDrill,
    newsImpactRecoveryIncidentSloDrill,
    newsImpactRecoveryIncidentAckDrill,
    newsImpactRecoveryKeyboard,
    sendNewsImpactRecoveryMessage,
    newsImpactFunnelConfidenceDrill,
    newsImpactTrendSignal,
    buildNewsImpactActionTrend,
    newsImpactActionTrendDrill,
    newsImpactDecisionKeyboard,
    newsImpactDecisionDrill
  };
}
