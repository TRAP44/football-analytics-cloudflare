export function createTelegramBotOrchestrationRuntime(deps = {}) {
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

  function botAiHandoffText(data = {}) {
    const match=data.match || {};
    const ai=data.aiInstructor || {};
    const signal=ai.betSignal || {};
    const verdict=ai.verdict || {};
    const trust=ai.dataTrust || {};
    const confidence=Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : '—';
    const trustScore=Number.isFinite(Number(trust.score)) ? `${Math.round(Number(trust.score))}%` : '—';
    const skip=signal.code==='skip';
    const freshness=data.freshness || analysisFreshness(data);
    const handoff=data.kickoffHandoff || analysisKickoffHandoff(data);
    const handoffLocked=Boolean(handoff?.locked);
    const freshIcon=freshness.needsRecheck?'🟠':freshness.state==='started'?'⚪':'🟢';
    const delta=data?.recheck?.performed ? data?.recheck?.delta : null;
    const newsImpact=data?.newsImpact || null;
    const deltaLines=!newsImpact?.requested && delta?.available ? [delta.summary,...(delta.items || []).slice(0,3).map(item=>`• ${item.title}${item.after?`: ${item.after}`:''}`)] : [];
    const newsDecision=newsImpactDecisionCard(newsImpact);
    const newsImpactLines=newsImpact?.requested
      ? [
          newsDecision ? `${newsDecision.icon} ${newsDecision.label}` : 'Новостной контекст проверен.',
          newsDecision?.headline || newsImpact.summary || 'Новостной контекст проверен.',
          newsImpact.compared
            ? `Существенность: ${newsImpact.material ? 'есть существенные изменения' : newsImpact.stable ? 'значимых изменений нет' : 'изменились отдельные детали'}.`
            : 'Существенность: сравнение до/после не выполнено.',
          ...(newsImpact.items || []).slice(0,3).map(item=>`• ${item.title}${item.before&&item.after?`: ${item.before} → ${item.after}`:item.after?`: ${item.after}`:''}`),
          newsDecision?.action ? `Что делать: ${newsDecision.action}` : '',
        ].filter(Boolean)
      : [];
    return [
      '🧠 <b>MatchRadar AI · короткая оценка</b>',
      `<b>${telegramHtmlEscape(match.home?.name || 'Хозяева')} — ${telegramHtmlEscape(match.away?.name || 'Гости')}</b>`,
      '',
      handoffLocked
        ? `⏱ <b>Предматчевый сигнал зафиксирован: ${telegramHtmlEscape(signal.label || 'без сигнала')}</b>`
        : `🎯 ${skip ? '<b>Сигнала нет — матч лучше пропустить</b>' : `<b>${telegramHtmlEscape(signal.label || 'Изучить матч')}</b>`}`,
      `📊 Исход: ${telegramHtmlEscape(verdict.outcome || '—')}`,
      `🧠 Уверенность: ${telegramHtmlEscape(ai.confidenceLabel || '—')} · ${confidence}`,
      `⚠️ Риск: ${telegramHtmlEscape(ai.riskLabel || '—')}`,
      `🗂 Данные: ${telegramHtmlEscape(trust.label || '—')} · ${trustScore}`,
      `${freshIcon} Свежесть: <b>${telegramHtmlEscape(freshness.label || '—')}</b> · ${Number(freshness.ageMinutes || 0)} мин.`,
      '',
      handoffLocked
        ? `До старта AI объяснял сигнал так: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'по доступным предматчевым данным')}`
        : `Почему: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'Оцениваю доступные данные матча.')}`,
      freshness.reason ? `Свежесть: ${telegramHtmlEscape(freshness.reason)}` : '',
      handoff?.state==='imminent' ? `⏳ ${telegramHtmlEscape(handoff.label)}: ${telegramHtmlEscape(handoff.reason)}` : '',
      handoffLocked ? `➡️ ${telegramHtmlEscape(handoff.reason)}` : '',
      ...(newsImpactLines.length ? ['',`📰 <b>News Impact Delta</b>`,...newsImpactLines.map(telegramHtmlEscape)] : []),
      ...(deltaLines.length ? ['',`🔄 <b>Что изменилось после перепроверки</b>`,...deltaLines.map(telegramHtmlEscape)] : []),
      '',
      handoffLocked
        ? '<i>После стартового свистка MatchRadar AI не превращает предматчевый сигнал в live-рекомендацию. Используйте центр матча для счёта, событий и статистики.</i>'
        : '<i>Полный AI-разбор откроется сразу на этом матче — повторно искать его не нужно.</i>',
    ].join('\n');
  }
  
  function botRefereeText(data = {}) {
    const match=data.match || {};
    const ai=data.aiInstructor || {};
    const history=ai.refereeHistory || {};
    const name=history.name || ai.refereeProfile?.name || ai.referee || match.referee || '';
    if (!name) return '🧑‍⚖️ Судья на этот матч ещё не опубликован источником данных.';
    const rows=[`🧑‍⚖️ <b>Судья · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`, '', `Арбитр: <b>${telegramHtmlEscape(name)}</b>`];
    if (history.available) {
      rows.push(`Стиль: ${telegramHtmlEscape(history.styleLabel || '—')}`);
      rows.push(`Средние карточки: ${Number(history.avgYellow || 0)} жёлт. · ${Number(history.avgRed || 0)} красн.`);
      rows.push(`Фолы: ${Number(history.avgFouls || 0)} за матч · выборка ${Number(history.sample || 0)} матчей`);
    } else {
      rows.push(telegramHtmlEscape(ai.refereeNote || 'Подтверждённой исторической выборки пока недостаточно.'));
    }
    return rows.join('\n');
  }
  
  function botSquadsText(data = {}) {
    const match=data.match || {};
    const impact=data.lineupImpact || data.aiInstructor?.lineupImpact || {};
    const abs=data.absences || {home:[],away:[]};
    const lineups=data.lineups || {};
    const side=(name,list,lineup)=>{
      const misses=(list || []).slice(0,4).map(x=>telegramHtmlEscape(x.name || 'Игрок')).join(', ') || 'нет подтверждённых потерь';
      const confirmed=lineup?.quality?.confirmed===true || (!lineup?.quality && Number(lineup?.startXI?.length || 0)===11);
      return `<b>${telegramHtmlEscape(name)}</b>\nПотери: ${misses}\nСостав: ${confirmed ? `подтверждён · ${telegramHtmlEscape(lineup?.formation || 'схема не указана')}` : 'ещё не подтверждён'}`;
    };
    return [
      `👥 <b>Составы и потери · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
      '',
      side(match.home?.name || 'Хозяева',abs.home,lineups.home),
      '',
      side(match.away?.name || 'Гости',abs.away,lineups.away),
      '',
      `AI-контекст: ${telegramHtmlEscape(impact.note || 'Проверяйте стартовые составы ближе к матчу.')}`,
    ].join('\n');
  }
  
  function botMarketRiskText(data = {}) {
    const match=data.match || {};
    const ai=data.aiInstructor || {};
    const market=data.market || {};
    const odds=market.odds || {};
    const oddsLine=odds.home && odds.draw && odds.away ? `П1 ${odds.home} · X ${odds.draw} · П2 ${odds.away}` : 'актуальные 1X2 коэффициенты недоступны';
    const risks=(ai.risks || data.risks || []).slice(0,3);
    return [
      `💹 <b>Рынок и риски · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
      '',
      `Коэффициенты: ${telegramHtmlEscape(oddsLine)}`,
      `Движение: ${telegramHtmlEscape(ai.marketNote || marketMovementNote(data.marketMovement || {}))}`,
      `Риск AI: <b>${telegramHtmlEscape(ai.riskLabel || '—')}</b>`,
      ...(risks.length ? ['', '<b>Что может сломать сценарий:</b>', ...risks.map(x=>`• ${telegramHtmlEscape(x)}`)] : []),
    ].join('\n');
  }
  
  
  async function botMatchCenterFixture(request, cfg, fixtureId) {
    const url=new URL(request.url);
    url.pathname='/api/match-center';
    url.search='';
    url.searchParams.set('fixtureId',String(Number(fixtureId || 0)));
    const response=await apiMatchCenter(new Request(url.toString(),{method:'GET'}),cfg);
    let payload={};
    try { payload=await response.json(); } catch {}
    if (!response.ok) {
      const error=new Error(payload?.error || 'Не удалось открыть центр матча.');
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    return payload;
  }
  
  function botPostMatchReviewText(data = {}) {
    const match=data.match || {};
    const review=data.postMatchReview || {};
    if (!review.available) {
      return [
        `🧠 <b>Итог AI · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
        '',
        telegramHtmlEscape(review.summary || 'Для этого матча нет сохранённого предматчевого снимка, поэтому честное сравнение с AI-прогнозом недоступно.'),
        '',
        '<i>Фактические события и статистика доступны в центре матча.</i>',
      ].join('\n');
    }
    const outcome=review.outcome || {};
    const score=review.score || {};
    const marketLines=(review.markets || []).map(x=>`${x.correct?'✓':'✕'} ${x.label}: ${x.predicted}${Number.isFinite(Number(x.probability))?` (${Number(x.probability)}%)`:''} → ${x.actual}`);
    const evidence=(review.evidence || []).slice(0,3).map(x=>`• ${x.icon || '•'} ${x.title}: ${x.text}`);
    return [
      `🧠 <b>Итог AI · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
      `Счёт: <b>${Number(score.home)}:${Number(score.away)}</b>`,
      '',
      `${outcome.correct?'✅':'❌'} <b>${telegramHtmlEscape(review.headline || '')}</b>`,
      `До матча: ${telegramHtmlEscape(outcome.predictedLabel || '—')}${Number.isFinite(Number(outcome.probability))?` · ${Number(outcome.probability)}%`:''}`,
      `Факт: ${telegramHtmlEscape(outcome.actualLabel || '—')}`,
      ...(marketLines.length ? ['', '<b>Дополнительные рынки:</b>', ...marketLines.map(telegramHtmlEscape)] : []),
      ...(evidence.length ? ['', '<b>Что видно по матчу:</b>', ...evidence.map(telegramHtmlEscape)] : []),
      '',
      telegramHtmlEscape(review.calibration?.note || ''),
      '<i>Наблюдаемые факторы не доказывают причинность результата.</i>',
    ].filter(Boolean).join('\n');
  }
  
  async function sendBotFixtureSection(request, cfg, userId, chatId, fixtureId, section = 'verdict', options = {}) {
    try {
      if (section !== 'review') markTelegramWebhookMutation(cfg, 'analysis_quota_or_history');
      const data = section === 'review'
        ? await botMatchCenterFixture(request, cfg, fixtureId)
        : await botAnalyzeFixture(request, cfg, userId, fixtureId);
      const text = section === 'review' ? botPostMatchReviewText(data)
        : section === 'referee' ? botRefereeText(data)
          : section === 'squads' ? botSquadsText(data)
            : section === 'market' ? botMarketRiskText(data)
              : botAiVerdictText(data);
      const match=normalizeBotFixtureCard(data.match);
      await rememberBotFixtureCards([match],cfg);
      const favorites=await getFavorites(userId,cfg).catch(()=>[]);
      if (section === 'verdict') void recordGrowthEvent(cfg,{userId,eventName:'quick_ai',channel:'telegram',fixtureId,metadata:{section}});
      if (section === 'review') void recordGrowthEvent(cfg,{userId,eventName:'post_match_review',channel:'telegram',fixtureId,metadata:{available:Boolean(data?.postMatchReview?.available)}});
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        parse_mode:'HTML',
        text,
        reply_markup:footballMatchActionKeyboard(request, match, '', favorites),
      });
      return {ok:true,status:200};
    } catch (error) {
      const status=Number(error?.status || 0);
      const message=status===429
        ? 'Лимит AI-разборов или источника данных временно исчерпан. Попробуйте позже.'
        : status===409
          ? 'Данные матча сейчас противоречивы, поэтому AI-разбор временно заблокирован.'
          : error?.message || 'Не удалось получить AI-разбор матча.';
      if (!options.suppressFallback) {
        await telegramApi('sendMessage',cfg,{
          chat_id:chatId,
          text:`⚠️ ${message}`,
          reply_markup:{inline_keyboard:[[{text:'📊 Открыть матч',web_app:{url:telegramFullAnalysisUrl(request,Number(fixtureId),'brief')}}]]},
        }).catch(()=>null);
      }
      return {ok:false,status,code:String(error?.code || error?.payload?.code || ''),message};
    }
  }
  
  async function toggleBotFavorite(userId, teamId, cfg) {
    const id=Number(teamId || 0);
    if (!id) throw new Error('Команда не определена.');
    const favorites=await getFavorites(userId,cfg);
    const current=favorites.find(x=>Number(x.team_id)===id);
    if (current) {
      await removeFavorite(userId,id,cfg);
      return {active:false,team:{id,name:current.team_name || 'Команда',logo:current.team_logo || ''}};
    }
    const team=await loadBotTeamCard(id,cfg);
    if (!team?.name) throw new Error('Данные клуба устарели. Откройте карточку матча заново.');
    await addFavorite(userId,team,cfg);
    return {active:true,team};
  }
  
  async function configureFootballBot(request, cfg, chatId) {
    const appUrl = telegramWebAppUrl(request);
    await Promise.allSettled([
      telegramApi('setMyCommands', cfg, { commands: [] }),
      telegramApi('setMyName', cfg, { name: 'MatchRadar AI' }),
      telegramApi('setMyShortDescription', cfg, { short_description: 'Матчи, LIVE и AI-разбор — быстро и по делу.' }),
      telegramApi('setMyDescription', cfg, { description: 'AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.' }),
      telegramApi('setChatMenuButton', cfg, { chat_id: chatId, menu_button: { type: 'web_app', text: '⚽ MatchRadar AI', web_app: { url: appUrl } } }),
    ]);
  }
  
  async function sendFootballBotHome(request, cfg, chatId, telegramUser = {}) {
    const firstName=String(telegramUser?.first_name || '').trim().slice(0,40);
    const hello=firstName ? `Привет, <b>${telegramHtmlEscape(firstName)}</b>.` : 'Привет.';
    await telegramApi('sendMessage', cfg, {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: [
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
      reply_markup: footballBotKeyboard(request),
    });
  }
  
  async function sendFootballBotHelp(request, cfg, chatId) {
    await telegramApi('sendMessage', cfg, {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: [
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
        '',
        `<a href="${telegramHtmlEscape(publicSiteUrl(request,'/privacy.html'))}">Privacy</a> · <a href="${telegramHtmlEscape(publicSiteUrl(request,'/terms.html'))}">Terms</a> · <a href="${telegramHtmlEscape(publicSiteUrl(request,'/status.html'))}">Status</a>`,
      ].join('\n'),
      reply_markup: footballBotKeyboard(request),
    });
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
