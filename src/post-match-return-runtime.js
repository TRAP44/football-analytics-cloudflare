import { neutralSignalText } from './signal-wording.js';
export function createPostMatchReturnRuntime(deps = {}) {
  const {
    APP_VERSION,
    memory,
    actualOutcomeFromGoals,
    bumpTelemetry,
    fetchWithTimeout,
    fixtureIdentity,
    freeQuotaHealthy,
    getCache,
    getCacheEntry,
    hasSupabase,
    loadProviderFixturesForDate,
    loadRuntimeControls,
    postMatchOutcomeLabel,
    postMatchPredictionProbability,
    recordGrowthEvent,
    recordOpsEvent,
    redactOpsString,
    sendTelegramMessage,
    setCache,
    settlePredictionsFromFixtures,
    supaDelete,
    supaHeaders,
    supaPatch,
    supaSelectMany,
    supaSelectPaged,
    telegramHtmlEscape,
    withSingleFlight
  } = deps;

  const POST_MATCH_RETURN_MIN_DELAY_MINUTES = 105;
  const POST_MATCH_RETURN_MAX_AGE_HOURS = 18;
  const POST_MATCH_RETURN_COOLDOWN_MINUTES = 30;
  const POST_MATCH_RETURN_MARKER_DAYS = 30;
  
  function postMatchReturnDisabledKey(userId) {
    return `postmatch:return:disabled:${Number(userId || 0)}:v1`;
  }
  function postMatchReturnCooldownKey(userId) {
    return `postmatch:return:cooldown:${Number(userId || 0)}:v1`;
  }
  function postMatchReturnDeliveryKey(userId, fixtureId) {
    return `postmatch:return:delivery:${Number(userId || 0)}:${Number(fixtureId || 0)}:v1`;
  }
  
  function postMatchPositiveId(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value>0 ? value : 0;
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return 0;
    const id=Number(value.trim());
    return Number.isSafeInteger(id) && id>0 ? id : 0;
  }

  function postMatchGoal(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value>=0 ? value : null;
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
    const goals=Number(value.trim());
    return Number.isSafeInteger(goals) && goals>=0 ? goals : null;
  }

  function postMatchReturnEligibility(history = {}, prediction = {}, now = Date.now()) {
    const userId=postMatchPositiveId(history?.telegram_id);
    const fixtureId=postMatchPositiveId(history?.fixture_id);
    const kickoffMs=Date.parse(history?.fixture_date || '');
    const settled=String(prediction?.status || '')==='settled';
    const homeGoals=postMatchGoal(prediction?.actual_home_goals);
    const awayGoals=postMatchGoal(prediction?.actual_away_goals);
    if (!userId || !fixtureId || !Number.isFinite(kickoffMs)) return {eligible:false,reason:'identity'};
    if (kickoffMs > now-POST_MATCH_RETURN_MIN_DELAY_MINUTES*60_000) return {eligible:false,reason:'too_early'};
    if (kickoffMs < now-POST_MATCH_RETURN_MAX_AGE_HOURS*3600_000) return {eligible:false,reason:'too_old'};
    if (!settled || homeGoals===null || awayGoals===null) return {eligible:false,reason:'not_settled'};
    return {eligible:true,reason:'settled',userId,fixtureId,kickoffMs};
  }
  
  function postMatchReturnMessage(history = {}, prediction = {}) {
    const fixtureId=Number(history.fixture_id || prediction.fixture_id || 0);
    const home=String(history.home_name || prediction.home_name || 'Хозяева');
    const away=String(history.away_name || prediction.away_name || 'Гости');
    const homeGoals=Number(prediction.actual_home_goals);
    const awayGoals=Number(prediction.actual_away_goals);
    const predicted=String(prediction.predicted_outcome || '');
    const actual=String(prediction.actual_outcome || actualOutcomeFromGoals(homeGoals,awayGoals));
    const predictedLabel=postMatchOutcomeLabel(predicted);
    const actualLabel=postMatchOutcomeLabel(actual);
    const probability=postMatchPredictionProbability(prediction,predicted);
    const correct=prediction.correct===true || (predicted && predicted===actual);
    // Нейтральный вывод по коду сигнала, а не сохранённая ставочная метка.
    const signal=neutralSignalText(history.ai_signal_code,{home,away});
    const text=[
      '🏁 <b>Матч завершён · MatchRadar AI</b>',
      `<b>${telegramHtmlEscape(home)} — ${telegramHtmlEscape(away)} · ${homeGoals}:${awayGoals}</b>`,
      history.league_name ? telegramHtmlEscape(history.league_name) : '',
      '',
      signal ? `🧠 До матча: <b>${telegramHtmlEscape(signal)}</b>` : '',
      `📊 Исход модели: <b>${telegramHtmlEscape(predictedLabel)}</b>${probability===null?'':` · ${probability}%`} → факт <b>${telegramHtmlEscape(actualLabel)}</b>`,
      correct ? '✅ Главный исход совпал.' : '❌ Главный исход не совпал.',
      '',
      'Откройте итог AI — сверю исход, голы и фактический контекст матча.',
    ].filter(Boolean).join('\n');
    return {
      text,
      replyMarkup:{inline_keyboard:[
        [{text:'🧠 Открыть итог AI',callback_data:`match:return_review:${fixtureId}`}],
        [{text:'⚽ Матчи сегодня',callback_data:'feed:today'},{text:'🔕 Не присылать итоги',callback_data:'postmatch:return:off'}],
      ]},
      correct,
    };
  }
  
  function postMatchReturnDrill() {
    const now=Date.parse('2026-09-23T22:00:00Z');
    const history={telegram_id:10,fixture_id:77,fixture_date:'2026-09-23T19:30:00Z',home_name:'Home',away_name:'Away',league_name:'League',ai_signal_label:'П1 осторожно'};
    const settled={fixture_id:77,status:'settled',predicted_outcome:'home',home_prob:58,draw_prob:24,away_prob:18,actual_home_goals:2,actual_away_goals:0,actual_outcome:'home',correct:true};
    const pending={...settled,status:'pending'};
    const eligible=postMatchReturnEligibility(history,settled,now);
    const blockedPending=postMatchReturnEligibility(history,pending,now);
    const blockedEarly=postMatchReturnEligibility({...history,fixture_date:'2026-09-23T21:00:00Z'},settled,now);
    const message=postMatchReturnMessage(history,settled);
    return {pass:eligible.eligible && !blockedPending.eligible && !blockedEarly.eligible && message.correct && message.text.includes('2:0') && message.replyMarkup.inline_keyboard[0][0].callback_data==='match:return_review:77',cases:4};
  }
  
  async function loadPostMatchReturnCandidates(cfg, now = Date.now()) {
    if (!hasSupabase(cfg)) return {rows:[],truncated:false};
    const since=new Date(now-POST_MATCH_RETURN_MAX_AGE_HOURS*3600_000).toISOString();
    const cutoff=now-POST_MATCH_RETURN_MIN_DELAY_MINUTES*60_000;
    const page=await supaSelectPaged(cfg,'analysis_history',{fixture_date:`gte.${since}`},{
      pageSize:500,
      maxRows:5000,
      order:'fixture_date.desc',
    });
    return {
      rows:(Array.isArray(page?.rows) ? page.rows : []).filter(row=>{
        const kickoff=Date.parse(row?.fixture_date || '');
        return postMatchPositiveId(row?.telegram_id)>0
          && postMatchPositiveId(row?.fixture_id)>0
          && Number.isFinite(kickoff) && kickoff<=cutoff;
      }),
      truncated:Boolean(page?.truncated),
    };
  }
  
  async function loadPostMatchReturnPredictions(fixtureIds = [], cfg) {
    const ids=[...new Set((Array.isArray(fixtureIds)?fixtureIds:[]).map(postMatchPositiveId).filter(Boolean))];
    const rows=[];
    for (let i=0;i<ids.length;i+=60) {
      const chunk=ids.slice(i,i+60);
      const page=await supaSelectMany(cfg,'model_predictions',{fixture_id:`in.(${chunk.join(',')})`},{limit:chunk.length+5});
      rows.push(...(page || []));
    }
    return rows;
  }
  
  async function refreshPostMatchSettlement(candidates = [], predictions = [], cfg) {
    const byId=new Map((predictions || []).map(row=>[Number(row.fixture_id),row]));
    const pendingIds=new Set((candidates || [])
      .map(row=>Number(row.fixture_id || 0))
      .filter(id=>id && String(byId.get(id)?.status || '')==='pending'));
    if (!pendingIds.size) return {probed:0,settled:0,skipped:'no_pending'};
    if (!freeQuotaHealthy(15,2)) return {probed:0,settled:0,skipped:'quota_guard'};
  
    const dates=[...new Set((candidates || [])
      .filter(row=>pendingIds.has(Number(row.fixture_id || 0)))
      .map(row=>String(row.fixture_date || '').slice(0,10))
      .filter(Boolean))].slice(0,2);
    let probed=0, settled=0;
    for (const date of dates) {
      const markerKey=`postmatch:return:probe:${date}:v1`;
      if (await getCache(markerKey,cfg)) continue;
      await setCache(markerKey,0,{state:'probing',at:new Date().toISOString()},cfg,30);
      try {
        const fixtures=await loadProviderFixturesForDate(date,cfg);
        const relevant=(fixtures || []).filter(f=>pendingIds.has(fixtureIdentity(f)));
        const result=await settlePredictionsFromFixtures(relevant,cfg);
        probed++;
        settled+=Number(result.settled || 0);
        await setCache(markerKey,0,{state:'done',at:new Date().toISOString(),checked:result.checked,settled:result.settled},cfg,30);
      } catch (error) {
        await setCache(markerKey,0,{state:'failed',at:new Date().toISOString(),error:redactOpsString(error?.message || error,120)},cfg,10);
      }
    }
    return {probed,settled};
  }
  
  async function claimPostMatchReturnDelivery(userId, fixtureId, cfg) {
    const key=postMatchReturnDeliveryKey(userId,fixtureId);
    if (!hasSupabase(cfg)) return {claimed:false,key};
    const prior=await getCacheEntry(key,cfg,true).catch(()=>null);
    const priorClaimedAt=Date.parse(prior?.payload?.claimedAt || '');
    if (prior?.payload?.state==='claimed' && Number.isFinite(priorClaimedAt) && priorClaimedAt < Date.now()-15*60_000) {
      memory.cache.delete(key);
      await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
    }
    const expiresAt=new Date(Date.now()+POST_MATCH_RETURN_MARKER_DAYS*86400_000).toISOString();
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('on_conflict','cache_key');
    const payload={state:'claimed',userId:Number(userId),fixtureId:Number(fixtureId),claimedAt:new Date().toISOString(),version:APP_VERSION};
    const r=await fetchWithTimeout(url,{
      method:'POST',
      headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
      body:JSON.stringify([{cache_key:key,fixture_id:Number(fixtureId),payload,expires_at:expiresAt}]),
    },7000,'Supabase post-match return claim');
    if (!r.ok) throw new Error(`Supabase post-match return claim: HTTP ${r.status}`);
    const rows=await r.json().catch(()=>[]);
    if (Array.isArray(rows) && rows.length===1) {
      memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
      return {claimed:true,key};
    }
    return {claimed:false,key};
  }
  
  async function finishPostMatchReturnClaim(key, userId, fixtureId, cfg) {
    if (!key) return;
    const payload={state:'sent',userId:Number(userId),fixtureId:Number(fixtureId),sentAt:new Date().toISOString(),version:APP_VERSION};
    const expiresAt=Date.now()+POST_MATCH_RETURN_MARKER_DAYS*86400_000;
    memory.cache.set(key,{payload,expiresAt});
    if (hasSupabase(cfg)) await supaPatch(cfg,'analysis_cache',{cache_key:`eq.${key}`},{payload,expires_at:new Date(expiresAt).toISOString()}).catch(()=>null);
  }
  
  async function releasePostMatchReturnClaim(key, cfg) {
    if (!key) return;
    memory.cache.delete(key);
    if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
  }
  
  async function processPostMatchReturns(cfg) {
    return await withSingleFlight('cron:post-match-return', async()=>{
      if (!hasSupabase(cfg) || !cfg.botToken) return {checked:0,eligible:0,sent:0,failed:0,skipped:'not_configured'};
      const runtime=await loadRuntimeControls(cfg);
      if (runtime.value?.remindersEnabled===false) return {checked:0,eligible:0,sent:0,failed:0,skipped:'notifications_disabled'};
  
      const now=Date.now();
      let candidatePage={rows:[],truncated:false};
      try { candidatePage=await loadPostMatchReturnCandidates(cfg,now); }
      catch (error) {
        await recordOpsEvent(cfg,{severity:'warning',source:'post_match_return',eventType:'post_match_return',code:'RETURN_HISTORY_READ_FAILED',message:error?.message || error,endpoint:'cron:post-match-return'}).catch(()=>null);
        return {checked:0,eligible:0,sent:0,failed:1,truncated:false};
      }
      const candidates=candidatePage.rows || [];
      if (candidatePage.truncated) {
        await recordOpsEvent(cfg,{
          severity:'warning',
          source:'post_match_return',
          eventType:'post_match_return',
          code:'RETURN_HISTORY_TRUNCATED',
          message:'Post-match return history scan reached the 5000-row safety cap.',
          endpoint:'cron:post-match-return',
          meta:{loaded:Number(candidates.length || 0),cap:5000},
        }).catch(()=>null);
      }
      if (!candidates.length) return {checked:0,eligible:0,sent:0,failed:0,truncated:Boolean(candidatePage.truncated)};
  
      const ids=[...new Set(candidates.map(row=>Number(row.fixture_id || 0)).filter(Boolean))];
      let predictions=await loadPostMatchReturnPredictions(ids,cfg).catch(()=>[]);
      const refresh=await refreshPostMatchSettlement(candidates,predictions,cfg);
      if (Number(refresh.settled || 0)>0) predictions=await loadPostMatchReturnPredictions(ids,cfg).catch(()=>predictions);
      const predictionMap=new Map(predictions.map(row=>[Number(row.fixture_id),row]));
  
      let eligible=0,sent=0,failed=0,deduped=0,disabled=0,cooldown=0;
      const sentUsers=new Set();
      for (const history of candidates) {
        const userId=Number(history.telegram_id || 0);
        const fixtureId=Number(history.fixture_id || 0);
        const prediction=predictionMap.get(fixtureId);
        const state=postMatchReturnEligibility(history,prediction,now);
        if (!state.eligible) continue;
        eligible++;
        if (sentUsers.has(userId)) { cooldown++; continue; }
        if (await getCache(postMatchReturnDisabledKey(userId),cfg)) { disabled++; continue; }
        if (await getCache(postMatchReturnCooldownKey(userId),cfg)) { cooldown++; continue; }
  
        let claim;
        try { claim=await claimPostMatchReturnDelivery(userId,fixtureId,cfg); }
        catch (error) { failed++; continue; }
        if (!claim.claimed) { deduped++; continue; }
  
        const message=postMatchReturnMessage(history,prediction);
        const result=await sendTelegramMessage(userId,message.text,cfg,{parseMode:'HTML',replyMarkup:message.replyMarkup});
        if (result.ok) {
          sent++;
          sentUsers.add(userId);
          await finishPostMatchReturnClaim(claim.key,userId,fixtureId,cfg);
          await setCache(postMatchReturnCooldownKey(userId),fixtureId,{sentAt:new Date().toISOString(),fixtureId},cfg,POST_MATCH_RETURN_COOLDOWN_MINUTES);
          void recordGrowthEvent(cfg,{userId,eventName:'post_match_return_sent',channel:'telegram',fixtureId,metadata:{correct:Boolean(message.correct)}});
        } else {
          failed++;
          const forbidden=Number(result.status)===403 || Number(result.errorCode)===403;
          if (forbidden) {
            await setCache(postMatchReturnDisabledKey(userId),fixtureId,{reason:'telegram_forbidden',at:new Date().toISOString()},cfg,525600);
          } else {
            await releasePostMatchReturnClaim(claim.key,cfg);
          }
        }
      }
  
      const summary={checked:candidates.length,eligible,sent,failed,deduped,disabled,cooldown,truncated:Boolean(candidatePage.truncated),providerProbes:Number(refresh.probed || 0),newlySettled:Number(refresh.settled || 0)};
      if (sent || failed) await recordOpsEvent(cfg,{
        severity:failed?'warning':'info',
        source:'post_match_return',
        eventType:'post_match_return',
        code:failed?'RETURN_RUN_WITH_FAILURES':'RETURN_RUN_OK',
        message:`Post-match return: отправлено ${sent}, ошибок ${failed}.`,
        endpoint:'cron:post-match-return',
        meta:summary,
      }).catch(()=>null);
      return summary;
    });
  }
  

  return {
    postMatchReturnDisabledKey,
    postMatchReturnCooldownKey,
    postMatchReturnDeliveryKey,
    postMatchReturnEligibility,
    postMatchReturnMessage,
    postMatchReturnDrill,
    loadPostMatchReturnCandidates,
    loadPostMatchReturnPredictions,
    refreshPostMatchSettlement,
    claimPostMatchReturnDelivery,
    finishPostMatchReturnClaim,
    releasePostMatchReturnClaim,
    processPostMatchReturns
  };
}
