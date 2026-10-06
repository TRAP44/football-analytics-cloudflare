const SECTION_NAMES = new Set(['verdict','referee','squads','market','review']);

export function createTelegramBotOrchestrationRuntime(deps = {}) {
  if (!deps || typeof deps!=='object' || Array.isArray(deps)) {
    throw new TypeError('Telegram bot orchestration runtime dependencies are required.');
  }

  const {
    addFavorite,
    analysisFreshness,
    analysisKickoffHandoff,
    apiMatchCenter,
    botAiVerdictText,
    botAnalyzeFixture,
    footballBotKeyboard,
    footballMatchActionKeyboard,
    getFavorites,
    loadBotTeamCard,
    markTelegramWebhookMutation,
    marketMovementNote,
    newsImpactDecisionCard,
    normalizeBotFixtureCard,
    publicSiteUrl,
    recordGrowthEvent,
    rememberBotFixtureCards,
    removeFavorite,
    telegramApi,
    telegramFullAnalysisUrl,
    telegramHtmlEscape,
    telegramWebAppUrl
  } = deps;

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function rowsOrEmpty(value, limit = 500) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safeText(value, max = 1200, fallback = '') {
    if (!['string','number','bigint'].includes(typeof value)) return fallback;
    try {
      const text=String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  function safeMessageText(value, max = 3900, fallback = '') {
    if (typeof value!=='string') return fallback;
    try {
      const text=value
        .normalize('NFKC')
        .replace(/\r\n?/g,'\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
        .trim();
      if (!text) return fallback;
      return text.length<=max ? text : fallback;
    } catch {
      return fallback;
    }
  }

  function finiteNumber(value) {
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number!==null && Number.isSafeInteger(number) && number>0
      ? number
      : null;
  }

  function chatIdValue(value) {
    const number=finiteNumber(value);
    return number!==null && Number.isSafeInteger(number) && number!==0
      ? number
      : null;
  }

  function requireFunction(name, fn) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
    return fn;
  }

  function optionalCall(fn, fallback, ...args) {
    if (typeof fn!=='function') return fallback;
    try {
      const value=fn(...args);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async function optionalAsync(fn, fallback, ...args) {
    if (typeof fn!=='function') return fallback;
    try {
      const value=await fn(...args);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function backgroundCall(fn,...args) {
    if (typeof fn!=='function') return;
    try {
      Promise.resolve(fn(...args)).catch(()=>{});
    } catch {}
  }

  function escapeHtml(value, max = 1600) {
    const text=safeText(value,max);
    if (typeof telegramHtmlEscape==='function') {
      try { return String(telegramHtmlEscape(text)); }
      catch {}
    }
    return text
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function safeHttpUrl(value) {
    const raw=safeText(value,2000);
    if (!raw) return '';
    try {
      const url=new URL(raw);
      if (!['http:','https:'].includes(url.protocol)) return '';
      if (url.username || url.password) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function generatedHttpUrl(factory, request, ...args) {
    if (typeof factory!=='function') return '';
    try { return safeHttpUrl(factory(request,...args)); }
    catch { return ''; }
  }

  function generatedHttpsUrl(factory, request, ...args) {
    const raw=generatedHttpUrl(factory,request,...args);
    if (!raw) return '';
    try { return new URL(raw).protocol==='https:' ? raw : ''; }
    catch { return ''; }
  }

  function requestUrl(request) {
    const raw=safeText(request?.url,2000);
    if (!raw) return null;
    try {
      const url=new URL(raw);
      if (!['http:','https:'].includes(url.protocol)) return null;
      if (url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function generatedWebAppUrl(factory, request, ...args) {
    const base=requestUrl(request);
    if (!base || base.protocol!=='https:' || typeof factory!=='function') return '';
    try {
      const raw=safeHttpUrl(factory(request,...args));
      if (!raw) return '';
      const url=new URL(raw);
      if (url.protocol!=='https:' || url.origin!==base.origin) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function statusError(message, status = 500, code = '') {
    const error=new Error(message);
    error.status=status;
    if (code) error.code=code;
    return error;
  }

  function formattedNumber(value, { suffix = '', digits = null, fallback = '—' } = {}) {
    const number=finiteNumber(value);
    if (number===null) return fallback;
    const rendered=digits===null ? String(number) : number.toFixed(digits);
    return `${rendered}${suffix}`;
  }

  function safeMatchKeyboard(request, match, favorites = []) {
    if (typeof footballMatchActionKeyboard!=='function') return undefined;
    try {
      return footballMatchActionKeyboard(request, match, '', rowsOrEmpty(favorites));
    } catch {
      return undefined;
    }
  }

  function botAiHandoffText(data = {}) {
    const root=plainObject(data) || {};
    const match=plainObject(root.match) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const ai=plainObject(root.aiInstructor) || {};
    const signal=plainObject(ai.betSignal) || {};
    const verdict=plainObject(ai.verdict) || {};
    const trust=plainObject(ai.dataTrust) || {};
    const confidenceScore=finiteNumber(ai.confidenceScore);
    const trustNumber=finiteNumber(trust.score);
    const confidence=confidenceScore!==null ? `${Math.round(confidenceScore)}/100` : '—';
    const trustScore=trustNumber!==null ? `${Math.round(trustNumber)}%` : '—';
    const skip=safeText(signal.code,32)==='skip';
    const fallbackFreshness={state:'unknown',label:'—',reason:'',ageMinutes:0,needsRecheck:false};
    const freshness=plainObject(root.freshness)
      || plainObject(optionalCall(analysisFreshness,fallbackFreshness,root))
      || fallbackFreshness;
    const fallbackHandoff={locked:false,state:'',label:'',reason:''};
    const handoff=plainObject(root.kickoffHandoff)
      || plainObject(optionalCall(analysisKickoffHandoff,fallbackHandoff,root))
      || fallbackHandoff;
    const handoffLocked=handoff.locked===true;
    const freshIcon=freshness.needsRecheck===true?'🟠':safeText(freshness.state,32)==='started'?'⚪':'🟢';
    const recheck=plainObject(root.recheck) || {};
    const delta=recheck.performed===true ? plainObject(recheck.delta) : null;
    const newsImpact=plainObject(root.newsImpact);
    const deltaLines=!newsImpact?.requested && delta?.available===true
      ? [
          safeText(delta.summary,500),
          ...rowsOrEmpty(delta.items,3).map(item=>{
            const row=plainObject(item) || {};
            const title=safeText(row.title,240,'Изменение');
            const after=safeText(row.after,240);
            return `• ${title}${after?`: ${after}`:''}`;
          }),
        ].filter(Boolean)
      : [];
    const newsDecision=plainObject(optionalCall(newsImpactDecisionCard,null,newsImpact));
    const newsImpactLines=newsImpact?.requested===true
      ? [
          newsDecision ? `${safeText(newsDecision.icon,16)} ${safeText(newsDecision.label,200)}`.trim() : 'Новостной контекст проверен.',
          safeText(newsDecision?.headline || newsImpact.summary,500,'Новостной контекст проверен.'),
          newsImpact.compared===true
            ? `Существенность: ${newsImpact.material===true ? 'есть существенные изменения' : newsImpact.stable===true ? 'значимых изменений нет' : 'изменились отдельные детали'}.`
            : 'Существенность: сравнение до/после не выполнено.',
          ...rowsOrEmpty(newsImpact.items,3).map(item=>{
            const row=plainObject(item) || {};
            const title=safeText(row.title,240,'Изменение');
            const before=safeText(row.before,240);
            const after=safeText(row.after,240);
            return `• ${title}${before&&after?`: ${before} → ${after}`:after?`: ${after}`:''}`;
          }),
          newsDecision?.action ? `Что делать: ${safeText(newsDecision.action,500)}` : '',
        ].filter(Boolean)
      : [];
    const ageMinutes=finiteNumber(freshness.ageMinutes);
    const ageText=ageMinutes!==null && ageMinutes>=0 ? Math.round(ageMinutes) : 0;

    return [
      '🧠 <b>MatchRadar AI · короткая оценка</b>',
      `<b>${escapeHtml(home.name || 'Хозяева',120)} — ${escapeHtml(away.name || 'Гости',120)}</b>`,
      '',
      handoffLocked
        ? `⏱ <b>Предматчевый сигнал зафиксирован: ${escapeHtml(signal.label || 'без сигнала',240)}</b>`
        : `🎯 ${skip ? '<b>Сигнала нет — матч лучше пропустить</b>' : `<b>${escapeHtml(signal.label || 'Изучить матч',240)}</b>`}`,
      `📊 Исход: ${escapeHtml(verdict.outcome || '—',240)}`,
      `🧠 Уверенность: ${escapeHtml(ai.confidenceLabel || '—',120)} · ${confidence}`,
      `⚠️ Риск: ${escapeHtml(ai.riskLabel || '—',120)}`,
      `🗂 Данные: ${escapeHtml(trust.label || '—',160)} · ${trustScore}`,
      `${freshIcon} Свежесть: <b>${escapeHtml(freshness.label || '—',160)}</b> · ${ageText} мин.`,
      '',
      handoffLocked
        ? `До старта AI объяснял сигнал так: ${escapeHtml(signal.reason || ai.riskNote || 'по доступным предматчевым данным',800)}`
        : `Почему: ${escapeHtml(signal.reason || ai.riskNote || 'Оцениваю доступные данные матча.',800)}`,
      freshness.reason ? `Свежесть: ${escapeHtml(freshness.reason,800)}` : '',
      safeText(handoff.state,32)==='imminent' ? `⏳ ${escapeHtml(handoff.label,160)}: ${escapeHtml(handoff.reason,800)}` : '',
      handoffLocked ? `➡️ ${escapeHtml(handoff.reason,800)}` : '',
      ...(newsImpactLines.length ? ['', '📰 <b>News Impact Delta</b>', ...newsImpactLines.map(line=>escapeHtml(line,1200))] : []),
      ...(deltaLines.length ? ['', '🔄 <b>Что изменилось после перепроверки</b>', ...deltaLines.map(line=>escapeHtml(line,1200))] : []),
      '',
      handoffLocked
        ? '<i>После стартового свистка MatchRadar AI не превращает предматчевый сигнал в live-рекомендацию. Используйте центр матча для счёта, событий и статистики.</i>'
        : '<i>Полный AI-разбор откроется сразу на этом матче — повторно искать его не нужно.</i>',
    ].filter(line=>line!==null && line!==undefined).join('\n');
  }

  function botRefereeText(data = {}) {
    const root=plainObject(data) || {};
    const match=plainObject(root.match) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const ai=plainObject(root.aiInstructor) || {};
    const history=plainObject(ai.refereeHistory) || {};
    const refereeProfile=plainObject(ai.refereeProfile) || {};
    const name=safeText(history.name || refereeProfile.name || ai.referee || match.referee,180);
    if (!name) return '🧑‍⚖️ Судья на этот матч ещё не опубликован источником данных.';
    const rows=[
      `🧑‍⚖️ <b>Судья · ${escapeHtml(home.name,120)} — ${escapeHtml(away.name,120)}</b>`,
      '',
      `Арбитр: <b>${escapeHtml(name,180)}</b>`,
    ];
    if (history.available===true) {
      rows.push(`Стиль: ${escapeHtml(history.styleLabel || '—',180)}`);
      rows.push(`Средние карточки: ${formattedNumber(history.avgYellow)} жёлт. · ${formattedNumber(history.avgRed)} красн.`);
      rows.push(`Фолы: ${formattedNumber(history.avgFouls)} за матч · выборка ${formattedNumber(history.sample)} матчей`);
    } else {
      rows.push(escapeHtml(ai.refereeNote || 'Подтверждённой исторической выборки пока недостаточно.',800));
    }
    return rows.join('\n');
  }

  function botSquadsText(data = {}) {
    const root=plainObject(data) || {};
    const match=plainObject(root.match) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const ai=plainObject(root.aiInstructor) || {};
    const impact=plainObject(root.lineupImpact) || plainObject(ai.lineupImpact) || {};
    const abs=plainObject(root.absences) || {};
    const lineups=plainObject(root.lineups) || {};
    const side=(name,list,lineupValue)=>{
      const lineup=plainObject(lineupValue) || {};
      const quality=plainObject(lineup.quality);
      const startXI=rowsOrEmpty(lineup.startXI,20);
      const misses=rowsOrEmpty(list,4)
        .map(item=>escapeHtml(plainObject(item)?.name || 'Игрок',180))
        .filter(Boolean)
        .join(', ') || 'нет подтверждённых потерь';
      const confirmed=quality?.confirmed===true || (!quality && startXI.length===11);
      const formation=escapeHtml(lineup.formation || 'схема не указана',80);
      return `<b>${escapeHtml(name,120)}</b>\nПотери: ${misses}\nСостав: ${confirmed ? `подтверждён · ${formation}` : 'ещё не подтверждён'}`;
    };
    return [
      `👥 <b>Составы и потери · ${escapeHtml(home.name,120)} — ${escapeHtml(away.name,120)}</b>`,
      '',
      side(home.name || 'Хозяева',abs.home,lineups.home),
      '',
      side(away.name || 'Гости',abs.away,lineups.away),
      '',
      `AI-контекст: ${escapeHtml(impact.note || 'Проверяйте стартовые составы ближе к матчу.',800)}`,
    ].join('\n');
  }

  function botMarketRiskText(data = {}) {
    const root=plainObject(data) || {};
    const match=plainObject(root.match) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const ai=plainObject(root.aiInstructor) || {};
    const market=plainObject(root.market) || {};
    const odds=plainObject(market.odds) || {};
    const homeOdd=finiteNumber(odds.home);
    const drawOdd=finiteNumber(odds.draw);
    const awayOdd=finiteNumber(odds.away);
    const oddsLine=homeOdd!==null && drawOdd!==null && awayOdd!==null
      ? `П1 ${homeOdd} · X ${drawOdd} · П2 ${awayOdd}`
      : 'актуальные 1X2 коэффициенты недоступны';
    const risks=rowsOrEmpty(Array.isArray(ai.risks) ? ai.risks : root.risks,3);
    const movement=safeText(ai.marketNote,800)
      || safeText(optionalCall(marketMovementNote,'',plainObject(root.marketMovement) || {}),800);
    return [
      `💹 <b>Рынок и риски · ${escapeHtml(home.name,120)} — ${escapeHtml(away.name,120)}</b>`,
      '',
      `Коэффициенты: ${escapeHtml(oddsLine,300)}`,
      `Движение: ${escapeHtml(movement || 'Достоверных данных о движении рынка пока нет.',800)}`,
      `Риск AI: <b>${escapeHtml(ai.riskLabel || '—',120)}</b>`,
      ...(risks.length ? ['', '<b>Что может сломать сценарий:</b>', ...risks.map(item=>`• ${escapeHtml(item,500)}`)] : []),
    ].join('\n');
  }

  async function botMatchCenterFixture(request, cfg, fixtureId) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) throw statusError('Некорректный идентификатор матча.',400,'FIXTURE_ID_INVALID');
    const url=requestUrl(request);
    if (!url) throw statusError('Некорректный адрес запроса.',400,'REQUEST_URL_INVALID');
    url.pathname='/api/match-center';
    url.search='';
    url.searchParams.set('fixtureId',String(id));
    const api=requireFunction('apiMatchCenter',apiMatchCenter);
    const response=await api(new Request(url.toString(),{method:'GET'}),cfg);
    if (!response || typeof response.ok!=='boolean' || typeof response.json!=='function') {
      throw statusError('Центр матча вернул некорректный ответ.',502,'MATCH_CENTER_INVALID_RESPONSE');
    }
    let payload=null;
    try { payload=await response.json(); } catch {}
    const body=plainObject(payload);
    if (!response.ok) {
      const error=statusError(
        safeText(body?.error,500,'Не удалось открыть центр матча.'),
        Number.isInteger(response.status) && response.status>=400 && response.status<=599 ? response.status : 502,
        safeText(body?.code,80),
      );
      error.payload=body || {};
      throw error;
    }
    if (!body) throw statusError('Центр матча вернул некорректные данные.',502,'MATCH_CENTER_INVALID_PAYLOAD');
    return body;
  }

  function botPostMatchReviewText(data = {}) {
    const root=plainObject(data) || {};
    const match=plainObject(root.match) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const review=plainObject(root.postMatchReview) || {};
    if (review.available!==true) {
      return [
        `🧠 <b>Итог AI · ${escapeHtml(home.name,120)} — ${escapeHtml(away.name,120)}</b>`,
        '',
        escapeHtml(review.summary || 'Для этого матча нет сохранённого предматчевого снимка, поэтому честное сравнение с AI-прогнозом недоступно.',1000),
        '',
        '<i>Фактические события и статистика доступны в центре матча.</i>',
      ].join('\n');
    }
    const outcome=plainObject(review.outcome) || {};
    const score=plainObject(review.score) || {};
    const homeScore=finiteNumber(score.home);
    const awayScore=finiteNumber(score.away);
    const scoreText=homeScore!==null && awayScore!==null ? `${homeScore}:${awayScore}` : '—:—';
    const marketLines=rowsOrEmpty(review.markets,8).map(item=>{
      const row=plainObject(item) || {};
      const probability=finiteNumber(row.probability);
      return `${row.correct===true?'✓':'✕'} ${safeText(row.label,160,'Рынок')}: ${safeText(row.predicted,220,'—')}${probability!==null?` (${probability}%)`:''} → ${safeText(row.actual,220,'—')}`;
    });
    const evidence=rowsOrEmpty(review.evidence,3).map(item=>{
      const row=plainObject(item) || {};
      return `• ${safeText(row.icon,16,'•')} ${safeText(row.title,180,'Фактор')}: ${safeText(row.text,500,'—')}`;
    });
    const outcomeProbability=finiteNumber(outcome.probability);
    return [
      `🧠 <b>Итог AI · ${escapeHtml(home.name,120)} — ${escapeHtml(away.name,120)}</b>`,
      `Счёт: <b>${escapeHtml(scoreText,40)}</b>`,
      '',
      `${outcome.correct===true?'✅':'❌'} <b>${escapeHtml(review.headline,500)}</b>`,
      `До матча: ${escapeHtml(outcome.predictedLabel || '—',220)}${outcomeProbability!==null?` · ${outcomeProbability}%`:''}`,
      `Факт: ${escapeHtml(outcome.actualLabel || '—',220)}`,
      ...(marketLines.length ? ['', '<b>Дополнительные рынки:</b>', ...marketLines.map(line=>escapeHtml(line,1000))] : []),
      ...(evidence.length ? ['', '<b>Что видно по матчу:</b>', ...evidence.map(line=>escapeHtml(line,1000))] : []),
      '',
      escapeHtml(plainObject(review.calibration)?.note || '',800),
      '<i>Наблюдаемые факторы не доказывают причинность результата.</i>',
    ].filter(Boolean).join('\n');
  }

  async function sendBotFixtureSection(request, cfg, userId, chatId, fixtureId, section = 'verdict', options = {}) {
    const id=positiveSafeInteger(fixtureId);
    const uid=positiveSafeInteger(userId);
    const cid=chatIdValue(chatId);
    const selected=safeText(section,32,'verdict');
    const suppressFallback=plainObject(options)?.suppressFallback===true;
    if (!id || !uid || !cid || !SECTION_NAMES.has(selected)) {
      const message=!SECTION_NAMES.has(selected)
        ? 'Неизвестный раздел матча.'
        : !id
          ? 'Матч не определён.'
          : !uid
            ? 'Пользователь не определён.'
            : 'Чат не определён.';
      return {ok:false,status:400,code:'TELEGRAM_SECTION_INPUT_INVALID',message};
    }

    try {
      if (selected !== 'review' && typeof markTelegramWebhookMutation==='function') {
        markTelegramWebhookMutation(cfg, 'analysis_quota_or_history');
      }
      const data = selected === 'review'
        ? await botMatchCenterFixture(request, cfg, id)
        : await requireFunction('botAnalyzeFixture',botAnalyzeFixture)(request, cfg, uid, id);
      const root=plainObject(data);
      if (!root) throw statusError('AI-разбор вернул некорректные данные.',502,'BOT_ANALYSIS_INVALID_PAYLOAD');
      const text = selected === 'review'
        ? botPostMatchReviewText(root)
        : selected === 'referee'
          ? botRefereeText(root)
          : selected === 'squads'
            ? botSquadsText(root)
            : selected === 'market'
              ? botMarketRiskText(root)
              : requireFunction('botAiVerdictText',botAiVerdictText)(root);
      const normalized=typeof normalizeBotFixtureCard==='function'
        ? optionalCall(normalizeBotFixtureCard,null,root.match)
        : root.match;
      const match=plainObject(normalized) || plainObject(root.match) || {};
      if (typeof rememberBotFixtureCards==='function' && Object.keys(match).length) {
        await optionalAsync(rememberBotFixtureCards,null,[match],cfg);
      }
      const favorites=rowsOrEmpty(await optionalAsync(getFavorites,[],uid,cfg));
      if (selected === 'verdict') {
        backgroundCall(recordGrowthEvent,cfg,{userId:uid,eventName:'quick_ai',channel:'telegram',fixtureId:id,metadata:{section:selected}});
      }
      if (selected === 'review') {
        backgroundCall(recordGrowthEvent,cfg,{userId:uid,eventName:'post_match_review',channel:'telegram',fixtureId:id,metadata:{available:plainObject(root.postMatchReview)?.available===true}});
      }
      const payload={
        chat_id:cid,
        parse_mode:'HTML',
        text:safeMessageText(text,3900,'Не удалось сформировать раздел матча.'),
      };
      const replyMarkup=safeMatchKeyboard(request,match,favorites);
      if (replyMarkup) payload.reply_markup=replyMarkup;
      await requireFunction('telegramApi',telegramApi)('sendMessage',cfg,payload);
      return {ok:true,status:200};
    } catch (error) {
      const rawStatus=finiteNumber(error?.status);
      const status=rawStatus!==null && Number.isInteger(rawStatus) && rawStatus>=400 && rawStatus<=599
        ? rawStatus
        : 500;
      const message=status===429
        ? 'Лимит AI-разборов или источника данных временно исчерпан. Попробуйте позже.'
        : status===409
          ? 'Данные матча сейчас противоречивы, поэтому AI-разбор временно заблокирован.'
          : safeText(error?.message,500,'Не удалось получить AI-разбор матча.');
      if (!suppressFallback && cid && typeof telegramApi==='function') {
        const fallbackPayload={chat_id:cid,text:`⚠️ ${message}`};
        const fullUrl=generatedWebAppUrl(telegramFullAnalysisUrl,request,id,'brief');
        if (fullUrl) {
          fallbackPayload.reply_markup={inline_keyboard:[[{text:'📊 Открыть матч',web_app:{url:fullUrl}}]]};
        }
        await optionalAsync(telegramApi,null,'sendMessage',cfg,fallbackPayload);
      }
      return {
        ok:false,
        status,
        code:safeText(error?.code || plainObject(error?.payload)?.code,80),
        message,
      };
    }
  }

  async function toggleBotFavorite(userId, teamId, cfg) {
    const uid=positiveSafeInteger(userId);
    const id=positiveSafeInteger(teamId);
    if (!uid) throw statusError('Пользователь не определён.',400,'TELEGRAM_USER_INVALID');
    if (!id) throw statusError('Команда не определена.',400,'TEAM_ID_INVALID');
    const favorites=rowsOrEmpty(await requireFunction('getFavorites',getFavorites)(uid,cfg));
    const current=favorites.find(item=>positiveSafeInteger(plainObject(item)?.team_id)===id);
    if (current) {
      await requireFunction('removeFavorite',removeFavorite)(uid,id,cfg);
      const row=plainObject(current) || {};
      return {
        active:false,
        team:{
          id,
          name:safeText(row.team_name,120,'Команда'),
          logo:safeText(row.team_logo,1000),
        },
      };
    }
    const team=plainObject(await requireFunction('loadBotTeamCard',loadBotTeamCard)(id,cfg));
    const name=safeText(team?.name,120);
    if (!team || !name) throw statusError('Данные клуба устарели. Откройте карточку матча заново.',409,'TEAM_CARD_STALE');
    const normalized={...team,id:positiveSafeInteger(team.id) || id,name};
    await requireFunction('addFavorite',addFavorite)(uid,normalized,cfg);
    return {active:true,team:normalized};
  }

  async function configureFootballBot(request, cfg, chatId) {
    const cid=chatIdValue(chatId);
    if (!cid) throw statusError('Чат не определён.',400,'TELEGRAM_CHAT_INVALID');
    const api=requireFunction('telegramApi',telegramApi);
    const appUrl=generatedHttpsUrl(telegramWebAppUrl,request);
    const call=(method,payload)=>Promise.resolve().then(()=>api(method,cfg,payload));
    const calls=[
      call('setMyCommands', { commands: [] }),
      call('setMyName', { name: 'MatchRadar AI' }),
      call('setMyShortDescription', { short_description: 'Матчи, LIVE и AI-разбор — быстро и по делу.' }),
      call('setMyDescription', { description: 'AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.' }),
    ];
    if (appUrl) {
      calls.push(call('setChatMenuButton', {
        chat_id:cid,
        menu_button:{type:'web_app',text:'⚽ MatchRadar AI',web_app:{url:appUrl}},
      }));
    }
    return Promise.allSettled(calls);
  }

  async function sendFootballBotHome(request, cfg, chatId, telegramUser = {}) {
    const cid=chatIdValue(chatId);
    if (!cid) throw statusError('Чат не определён.',400,'TELEGRAM_CHAT_INVALID');
    const user=plainObject(telegramUser) || {};
    const firstName=safeText(user.first_name,40);
    const hello=firstName ? `Привет, <b>${escapeHtml(firstName,40)}</b>.` : 'Привет.';
    const replyMarkup=typeof footballBotKeyboard==='function'
      ? optionalCall(footballBotKeyboard,undefined,request)
      : undefined;
    const payload={
      chat_id:cid,
      parse_mode:'HTML',
      text:[
        '⚽ <b>MatchRadar AI</b>',
        'Видим, что меняет матч.',
        '',
        `${hello} Напишите клуб прямо в чат — например «Реал», «Арсенал», «Бавария», «Бока Хуниорс» или «Интер Майами».`,
        '',
        '<b>Что будет дальше:</b> я найду ближайший матч; после одного нажатия сразу покажу короткую AI-оценку в чате.',
        '📊 Кнопка полного AI-разбора откроет Mini App сразу на выбранном матче — повторный поиск не нужен.',
        '📰 Новости и 🔴 LIVE остаются здесь, в Telegram.',
        '',
        '<i>Если данных мало или перевеса нет, MatchRadar AI прямо предложит пропустить матч.</i>',
      ].join('\n'),
    };
    if (replyMarkup) payload.reply_markup=replyMarkup;
    await requireFunction('telegramApi',telegramApi)('sendMessage', cfg, payload);
  }

  async function sendFootballBotHelp(request, cfg, chatId) {
    const cid=chatIdValue(chatId);
    if (!cid) throw statusError('Чат не определён.',400,'TELEGRAM_CHAT_INVALID');
    const links=[
      ['Privacy','/privacy.html'],
      ['Terms','/terms.html'],
      ['Status','/status.html'],
    ].map(([label,path])=>{
      const url=generatedHttpUrl(publicSiteUrl,request,path);
      return url ? `<a href="${escapeHtml(url,2000)}">${label}</a>` : '';
    }).filter(Boolean).join(' · ');
    const replyMarkup=typeof footballBotKeyboard==='function'
      ? optionalCall(footballBotKeyboard,undefined,request)
      : undefined;
    const payload={
      chat_id:cid,
      parse_mode:'HTML',
      text:[
        '<b>Как пользоваться MatchRadar AI</b>',
        '',
        '⚽ <b>Матчи сегодня</b> — персональная лента матчей.',
        '🔴 <b>LIVE</b> — матчи, которые идут сейчас.',
        '🧠 <b>AI-подборка</b> — три заметных матча дня.',
        '🔎 <b>Найти матч</b> — бот попросит написать команду или игру.',
        '⭐ <b>Мои команды</b> — избранное.',
        '🕘 <b>Последний разбор</b> — сохранённый AI-вердикт.',
        '📈 <b>Протокол AI</b> — подтверждённая история прогнозов без рекламного «процента побед».',
        '📰 <b>Новости</b> — важные события с источниками и объяснением контекста.',
        '☀️ <b>Утренняя подборка</b> — матчи дня и главное за утро.',
        '',
        'После одного нажатия на матч короткая AI-оценка появляется прямо в Telegram. <b>Полный AI-разбор</b> открывается в Mini App сразу на этом fixture.',
        '',
        '<i>MatchRadar AI — информационно-аналитический сервис. Он не гарантирует исход матча и не является финансовой или букмекерской рекомендацией.</i>',
        ...(links ? ['',links] : []),
      ].join('\n'),
    };
    if (replyMarkup) payload.reply_markup=replyMarkup;
    await requireFunction('telegramApi',telegramApi)('sendMessage', cfg, payload);
  }

  return {
    botAiHandoffText,
    botRefereeText,
    botSquadsText,
    botMarketRiskText,
    botMatchCenterFixture,
    botPostMatchReviewText,
    sendBotFixtureSection,
    toggleBotFavorite,
    configureFootballBot,
    sendFootballBotHome,
    sendFootballBotHelp
  };
}
