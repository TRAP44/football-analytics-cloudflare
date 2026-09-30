export function createAdminLaunchFunnelModule({
  state,
  $,
  isAdmin,
  escapeHtml,
  api,
  toast,
  dateTime,
} = {}) {
  function launchFunnelPct(value) {
    const n=Number(value || 0);
    return Number.isFinite(n) ? `${n.toFixed(n % 1 ? 1 : 0)}%` : '0%';
  }
  
  function renderLaunchFunnel() {
    if (!isAdmin()) return;
    const status=$('launchFunnelStatus');
    const meta=$('launchFunnelMeta');
    const kpis=$('launchFunnelKpis');
    const stages=$('launchFunnelStages');
    const campaigns=$('launchFunnelCampaigns');
    const mediaCampaigns=$('launchFunnelMediaCampaigns');
    if (!status || !meta || !kpis || !stages || !campaigns || !mediaCampaigns) return;
  
    if (state.launchFunnelLoading) {
      status.textContent='Собираю first-party воронку…';
      meta.textContent='Только агрегированные данные';
      kpis.innerHTML=stages.innerHTML=campaigns.innerHTML=mediaCampaigns.innerHTML='';
      return;
    }
  
    const d=state.launchFunnel;
    if (!d?.available) {
      status.textContent=d?.reason || 'Воронка запуска ещё не загружена.';
      meta.textContent='Нужна миграция v6.15 и события пользователей.';
      kpis.innerHTML=stages.innerHTML=campaigns.innerHTML=mediaCampaigns.innerHTML='';
      return;
    }
  
    status.textContent=`Launch funnel · ${Number(d.days || 7)} дн.`;
    meta.textContent=`${Number(d.uniqueUsers || 0)} пользователей · ${Number(d.events || 0)} событий · хранение ${Number(d.retentionDays || 90)} дней`;
    const first=d.funnel?.[0] || {};
    const last=d.funnel?.at?.(-1) || d.funnel?.[d.funnel.length-1] || {};
    const handoff=d.handoff || {};
    const rechecks=d.rechecks || {};
    const media=d.mediaLoop || {};
    const impactActions=d.newsImpactActionSummary || {};
    const impactOutcomeSummary=d.newsImpactOutcomeSummary || {};
    const impactOutcomeQuality=Array.isArray(d.newsImpactActionOutcomeQuality) ? d.newsImpactActionOutcomeQuality : [];
    const impactOutcomeBottleneck=d.newsImpactOutcomeBottleneck || null;
    const impactOutcomeGuard=d.newsImpactOutcomeGuard || {outcomeWindowMinutes:5,minimumSample:10};
    const impactFailureSummary=d.newsImpactFailureSummary || {};
    const impactFailureDiagnostics=Array.isArray(d.newsImpactFailureDiagnostics) ? d.newsImpactFailureDiagnostics : [];
    const impactFailureGuard=d.newsImpactFailureGuard || {rawErrorsStored:false};
    const impactRecoverySummary=d.newsImpactRecoverySummary || {};
    const impactRecoveryEffectiveness=Array.isArray(d.newsImpactRecoveryEffectiveness) ? d.newsImpactRecoveryEffectiveness : [];
    const impactRecoveryBest=d.newsImpactRecoveryBestStrategy || null;
    const impactRecoveryGuard=d.newsImpactRecoveryGuard || {windowMinutes:5,minimumSample:10};
    const impactRecoveryStrategySummary=d.newsImpactRecoveryStrategySummary || {};
    const impactRecoveryStrategyMatrix=Array.isArray(d.newsImpactRecoveryStrategyMatrix) ? d.newsImpactRecoveryStrategyMatrix : [];
    const impactRecoveryStrategyGuard=d.newsImpactRecoveryStrategyGuard || {minAttempts:30,minLiftPctPoints:5,lookbackDays:30,stabilityWindowDays:7,stabilityMinAttempts:10,driftPriorMinAttempts:20,driftRecentMinAttempts:10,driftDropPctPoints:15};
    const impactRecoveryTransitionHistory=Array.isArray(d.newsImpactRecoveryTransitionHistory) ? d.newsImpactRecoveryTransitionHistory : [];
    const impactRecoveryTransitionSummary=d.newsImpactRecoveryTransitionSummary || {};
    const impactRecoveryStrategyAlerts=Array.isArray(d.newsImpactRecoveryStrategyAlerts) ? d.newsImpactRecoveryStrategyAlerts : [];
    const impactRecoveryAlertSummary=d.newsImpactRecoveryAlertSummary || {};
    const impactRecoveryIncidents=Array.isArray(d.newsImpactRecoveryIncidents) ? d.newsImpactRecoveryIncidents : [];
    const impactRecoveryIncidentSummary=d.newsImpactRecoveryIncidentSummary || {};
    const impactRecoveryIncidentSloGuard=d.newsImpactRecoveryIncidentSloGuard || {ackTargetMinutes:30,ackCriticalMinutes:120,recoveryTargetMinutes:360};
    const impactRecoveryIncidentSloDashboard=d.newsImpactRecoveryIncidentSloDashboard || {summary:{},weekly:[],repeated:[],windowDays:28};
    const impactRecoverySloSummary=impactRecoveryIncidentSloDashboard.summary || {};
    const impactRecoverySloWeekly=Array.isArray(impactRecoveryIncidentSloDashboard.weekly) ? impactRecoveryIncidentSloDashboard.weekly : [];
    const impactRecoverySloRepeated=Array.isArray(impactRecoveryIncidentSloDashboard.repeated) ? impactRecoveryIncidentSloDashboard.repeated : [];
    const impactRecoveryIncidentSloBreachFeed=d.newsImpactRecoveryIncidentSloBreachFeed || {available:false,summary:{},items:[],repeated:[]};
    const impactRecoveryBreachSummary=impactRecoveryIncidentSloBreachFeed.summary || {};
    const impactRecoveryBreachItems=Array.isArray(impactRecoveryIncidentSloBreachFeed.items) ? impactRecoveryIncidentSloBreachFeed.items : [];
    const impactRecoveryBreachRepeated=Array.isArray(impactRecoveryIncidentSloBreachFeed.repeated) ? impactRecoveryIncidentSloBreachFeed.repeated : [];
    const impactRecoveryIncidentSloBreachWatchlist=d.newsImpactRecoveryIncidentSloBreachWatchlist || {available:false,summary:{},items:[],repeated:[]};
    const impactRecoveryWatchSummary=impactRecoveryIncidentSloBreachWatchlist.summary || {};
    const impactRecoveryWatchItems=Array.isArray(impactRecoveryIncidentSloBreachWatchlist.items) ? impactRecoveryIncidentSloBreachWatchlist.items : [];
    const impactRecoveryWatchRepeated=Array.isArray(impactRecoveryIncidentSloBreachWatchlist.repeated) ? impactRecoveryIncidentSloBreachWatchlist.repeated : [];
    const impactRecoveryIncidentSloBreachTriage=d.newsImpactRecoveryIncidentSloBreachTriage || {available:false,summary:{},items:[]};
    const impactRecoveryTriageSummary=impactRecoveryIncidentSloBreachTriage.summary || {};
    const impactRecoveryTriageItems=Array.isArray(impactRecoveryIncidentSloBreachTriage.items) ? impactRecoveryIncidentSloBreachTriage.items : [];
    const impactRecoveryIncidentSloBreachTriageTrend=d.newsImpactRecoveryIncidentSloBreachTriageTrend || {available:false,summary:{},weekly:[],stuck:[]};
    const impactRecoveryTriageTrendSummary=impactRecoveryIncidentSloBreachTriageTrend.summary || {};
    const impactRecoveryTriageTrendWeekly=Array.isArray(impactRecoveryIncidentSloBreachTriageTrend.weekly) ? impactRecoveryIncidentSloBreachTriageTrend.weekly : [];
    const impactRecoveryTriageTrendStuck=Array.isArray(impactRecoveryIncidentSloBreachTriageTrend.stuck) ? impactRecoveryIncidentSloBreachTriageTrend.stuck : [];
    const impactRecoveryIncidentSloBreachImpactRanking=d.newsImpactRecoveryIncidentSloBreachImpactRanking || {available:false,summary:{},ranking:[]};
    const impactRecoveryImpactSummary=impactRecoveryIncidentSloBreachImpactRanking.summary || {};
    const impactRecoveryImpactRanking=Array.isArray(impactRecoveryIncidentSloBreachImpactRanking.ranking) ? impactRecoveryIncidentSloBreachImpactRanking.ranking : [];
    const impactRecoveryIncidentSloBreachImpactTrend=d.newsImpactRecoveryIncidentSloBreachImpactTrend || {available:false,summary:{},weekly:[],pairs:[]};
    const impactRecoveryImpactTrendSummary=impactRecoveryIncidentSloBreachImpactTrend.summary || {};
    const impactRecoveryImpactTrendWeekly=Array.isArray(impactRecoveryIncidentSloBreachImpactTrend.weekly) ? impactRecoveryIncidentSloBreachImpactTrend.weekly : [];
    const impactRecoveryImpactTrendPairs=Array.isArray(impactRecoveryIncidentSloBreachImpactTrend.pairs) ? impactRecoveryIncidentSloBreachImpactTrend.pairs : [];
    const impactRecoveryIncidentSloImpactConcentration=d.newsImpactRecoveryIncidentSloImpactConcentration || {available:false,summary:{},rows:[]};
    const impactRecoveryConcentrationSummary=impactRecoveryIncidentSloImpactConcentration.summary || {};
    const impactRecoveryConcentrationRows=Array.isArray(impactRecoveryIncidentSloImpactConcentration.rows) ? impactRecoveryIncidentSloImpactConcentration.rows : [];
    const impactRecoveryIncidentSloImpactConcentrationTrend=d.newsImpactRecoveryIncidentSloImpactConcentrationTrend || {available:false,summary:{},weekly:[]};
    const impactRecoveryConcentrationTrendSummary=impactRecoveryIncidentSloImpactConcentrationTrend.summary || {};
    const impactRecoveryConcentrationTrendWeekly=Array.isArray(impactRecoveryIncidentSloImpactConcentrationTrend.weekly) ? impactRecoveryIncidentSloImpactConcentrationTrend.weekly : [];
    const impactRecoveryIncidentSloImpactExecutiveSummary=d.newsImpactRecoveryIncidentSloImpactExecutiveSummary || {available:false,summary:{},topPair:null};
    const impactRecoveryExecutiveSummary=impactRecoveryIncidentSloImpactExecutiveSummary.summary || {};
    const impactRecoveryExecutiveTopPair=impactRecoveryIncidentSloImpactExecutiveSummary.topPair || null;
    const impactRecoveryIncidentSloImpactFocusQueue=d.newsImpactRecoveryIncidentSloImpactFocusQueue || {available:false,summary:{},rows:[]};
    const impactRecoveryFocusSummary=impactRecoveryIncidentSloImpactFocusQueue.summary || {};
    const impactRecoveryFocusRows=Array.isArray(impactRecoveryIncidentSloImpactFocusQueue.rows) ? impactRecoveryIncidentSloImpactFocusQueue.rows : [];
    const impactFunnel=Array.isArray(d.newsImpactActionFunnel) ? d.newsImpactActionFunnel : [];
    const impactBottleneck=d.newsImpactActionBottleneck || null;
    const impactConfidenceGuard=d.newsImpactActionConfidenceGuard || {minUsers:10,stableUsers:30};
    const impactAttributionGuard=d.newsImpactActionAttributionGuard || {actionWindowMinutes:30,maturationMinutes:30};
    const impactTrend=Array.isArray(d.newsImpactActionTrend) ? d.newsImpactActionTrend : [];
    const impactTrendGuard=d.newsImpactActionTrendGuard || {comparisonDays:Number(d.days || 7)};
    kpis.innerHTML=`<div class="release-monitor-kpis">
      <div><span>Входы</span><strong>${Number(first.users || 0)}</strong><small>bot + Mini App</small></div>
      <div><span>Полный AI</span><strong>${Number(last.users || 0)}</strong><small>${launchFunnelPct(last.fromEntryPct)} от входов</small></div>
      <div><span>Кампаний</span><strong>${Number(d.campaigns?.length || 0)}</strong><small>source + campaign</small></div>
      <div><span>Материалов СМИ</span><strong>${Number(d.mediaSummary?.materials || 0)}</strong><small>${Number(d.mediaSummary?.linksCreated || 0)} ссылок создано</small></div>
      <div><span>One‑tap → полный AI</span><strong>${Number(handoff.fullAiUsers || 0)}</strong><small>${launchFunnelPct(handoff.conversionPct)} от AI-handoff</small></div>
      <div><span>AI перепроверки</span><strong>${Number(rechecks.total || 0)}</strong><small>${Number(rechecks.free || 0)} без списания · ${Number(rechecks.material || 0)} со значимыми изменениями</small></div>
      <div><span>Новости → AI</span><strong>${Number(d.returnLoop?.aiIntent || 0)}</strong><small>${launchFunnelPct(d.returnLoop?.intentPct)} нажали AI · ${Number(d.returnLoop?.smartFixtureIntent || 0)} через smart fixture · News Impact: ${Number(d.returnLoop?.impactCompared || 0)} сравнений / ${Number(d.returnLoop?.impactMaterial || 0)} существенных · решения: 🔴 ${Number(d.newsImpactDecisionSummary?.material || 0)} · 🟡 ${Number(d.newsImpactDecisionSummary?.detail || 0)} · 🟢 ${Number(d.newsImpactDecisionSummary?.stable || 0)} · действия: полный AI ${Number(impactActions.fullAi || 0)} · составы ${Number(impactActions.squads || 0)} · рынок ${Number(impactActions.market || 0)} · перепроверка ${Number(impactActions.recheck || 0)} · новости ${Number(impactActions.news || 0)} · поделились ${Number(impactActions.share || 0)} · подтверждённых результатов ${Number(impactOutcomeSummary.confirmed || 0)}/${Number(impactOutcomeSummary.attempts || 0)} · сбоев доставки ${Number(impactFailureSummary.total || 0)} · recovery ${Number(impactRecoverySummary.recovered || 0)}/${Number(impactRecoverySummary.attempts || 0)} · adaptive rules ${Number(impactRecoveryStrategySummary.adaptive || 0)} · Возврат из новостей: ${Number(d.returnLoop?.newsReturn || 0)} до матча</small></div>
      <div><span>Recovery-инциденты</span><strong>${Number(impactRecoveryIncidentSummary.active || 0)}</strong><small>активных · эскалаций ${Number(impactRecoveryIncidentSummary.escalatedActive || 0)} · critical ${Number(impactRecoveryIncidentSummary.criticalActive || 0)} · восстановлено ${Number(impactRecoveryIncidentSummary.recovered || 0)}</small></div>
      <div><span>SLO · 4 недели</span><strong>${impactRecoverySloSummary.ackSloPct==null?'—':launchFunnelPct(impactRecoverySloSummary.ackSloPct)}</strong><small>ACK вовремя · recovery ${impactRecoverySloSummary.recoverySloPct==null?'—':launchFunnelPct(impactRecoverySloSummary.recoverySloPct)} · повторов ${Number(impactRecoverySloSummary.recurringPairs || 0)}</small></div>
      <div><span>SLO breaches</span><strong>${Number(impactRecoveryBreachSummary.activeBreaches || 0)}</strong><small>активных · critical ${Number(impactRecoveryBreachSummary.critical || 0)} · ACK ${Number(impactRecoveryBreachSummary.ackBreaches || 0)} · recovery ${Number(impactRecoveryBreachSummary.recoveryBreaches || 0)}</small></div>
      <div><span>Media deep-link → AI</span><strong>${Number(media.aiUsers || 0)}</strong><small>${Number(media.deepLinkUsers || 0)} открыли · ${launchFunnelPct(media.conversionPct)} получили AI</small></div>
    </div>`;
  
    const rows=d.funnel || [];
    const bottleneck=d.bottleneck;
    const searchQuality=d.searchQuality || {};
    stages.innerHTML=`<div class="release-monitor-section-head"><strong>Воронка</strong><span>уникальные пользователи</span></div>
      ${bottleneck ? `<div class="data-notice">🎯 Узкое место: <strong>${escapeHtml(bottleneck.label || '')}</strong> · теряется ${launchFunnelPct(bottleneck.dropPct)} пользователей перехода.</div>` : ''}
      ${impactBottleneck && Number(impactBottleneck.users || 0) ? `<div class="data-notice">🧭 После News Impact: самая низкая конверсия при достаточной выборке у состояния <strong>${escapeHtml(impactBottleneck.label || impactBottleneck.code || '')}</strong> · ${Number(impactBottleneck.actedUsers || 0)} из ${Number(impactBottleneck.users || 0)} продолжили · ${launchFunnelPct(impactBottleneck.conversionPct)} · 95% ДИ ${launchFunnelPct(impactBottleneck.confidence?.lowerPct)}–${launchFunnelPct(impactBottleneck.confidence?.upperPct)}.</div>` : impactFunnel.some(x=>Number(x.users || 0)>0) ? `<div class="data-notice">🧪 News Impact: данных пока мало для определения узкого места. Нужно минимум <strong>${Number(impactConfidenceGuard.minUsers || 10)}</strong> пользователей в одном состоянии решения.</div>` : ''}
      ${impactFunnel.some(x=>Number(x.observedUsers || 0)>0) ? `<div class="data-notice">⏱ Атрибуция действий: действие считается только после Decision Card и в течение <strong>${Number(impactAttributionGuard.actionWindowMinutes || 30)} мин.</strong>; решения младше ${Number(impactAttributionGuard.maturationMinutes || 30)} мин. ещё не входят в конверсию.</div>` : ''}
      ${Number(rechecks.total || 0) ? `<div class="data-notice">🕒 Freshness guard: <strong>${Number(rechecks.total || 0)}</strong> перепроверок · ${Number(rechecks.material || 0)} со значимыми изменениями · ${Number(rechecks.stable || 0)} без значимых изменений.</div>` : ''}
      ${Number(handoff.users || 0) ? `<div class="data-notice">⚡ One‑tap AI: <strong>${Number(handoff.users || 0)}</strong> пользователей получили Telegram‑бриф · ${Number(handoff.fullAiUsers || 0)} дошли до полного AI · конверсия ${launchFunnelPct(handoff.conversionPct)}.</div>` : ''}
      ${Number(media.deepLinkOpens || 0) ? `<div class="data-notice">📣 Media loop: <strong>${Number(media.shareEvents || 0)}</strong> созданных share-ссылок · ${Number(media.deepLinkOpens || 0)} открытий fixture deep-link · ${Number(media.aiUsers || 0)} пользователей получили AI без повторного поиска.</div>` : ''}
      ${Number(searchQuality.attempts || 0) ? `<div class="data-notice">🔎 Качество поиска: <strong>${launchFunnelPct(searchQuality.matchPct)}</strong> поисков сразу дали матч · матч ${Number(searchQuality.match || 0)} · клуб распознан без матча ${Number(searchQuality.recognizedNoMatch || 0)} · не найдено ${Number(searchQuality.notFound || 0)} · спасено последним матчем ${Number(searchQuality.recoveredRecent || 0)}.</div>` : ''}
      <div class="launch-funnel-stages">${rows.map((x,index)=>`<div>
        <span>${index+1}. ${escapeHtml(x.label || x.key || '')}</span>
        <strong>${Number(x.users || 0)}</strong>
        <small>${index ? `${launchFunnelPct(x.fromPreviousPct)} от предыдущего · ${launchFunnelPct(x.fromEntryPct)} от входа` : 'точка входа'}</small>
      </div>`).join('')}</div>
      ${impactFunnel.some(x=>Number(x.users || 0)>0) ? `<div class="release-monitor-section-head"><strong>News Impact → действие</strong><span>по состояниям решения</span></div>
        <div class="launch-campaign-list">${impactFunnel.filter(x=>Number(x.users || 0)>0).map(x=>`<div>
          <span><b>${escapeHtml(x.label || x.code || '')}</b></span>
          <strong>${Number(x.actedUsers || 0)} / ${Number(x.users || 0)}</strong>
          <small>${launchFunnelPct(x.conversionPct)} продолжили · 95% ДИ ${launchFunnelPct(x.confidence?.lowerPct)}–${launchFunnelPct(x.confidence?.upperPct)} · ${escapeHtml(x.confidence?.label || 'мало данных')} · ${Number(x.immatureUsers || 0) ? `${Number(x.immatureUsers || 0)} свежих решений ещё не вошли · ` : ''}чаще: ${escapeHtml(x.topAction?.label || 'нет действий')}</small>
        </div>`).join('')}</div>` : ''}
      ${impactOutcomeQuality.some(x=>Number(x.observed || 0)>0) ? `<div class="release-monitor-section-head"><strong>News Impact: действие → результат</strong><span>подтверждённая сервером доставка</span></div>
        ${impactOutcomeBottleneck && Number(impactOutcomeBottleneck.attempts || 0)>=Number(impactOutcomeGuard.minimumSample || 10) ? `<div class="data-notice">🧩 Самая низкая подтверждённая доставка при достаточной выборке: <strong>${escapeHtml(impactOutcomeBottleneck.label || impactOutcomeBottleneck.action || '')}</strong> · ${Number(impactOutcomeBottleneck.confirmed || 0)}/${Number(impactOutcomeBottleneck.attempts || 0)} · ${launchFunnelPct(impactOutcomeBottleneck.completionPct)}.</div>` : ''}
        <div class="launch-campaign-list">${impactOutcomeQuality.filter(x=>Number(x.observed || 0)>0).map(x=>`<div>
          <span><b>${escapeHtml(x.label || x.action || '')}</b></span>
          <strong>${Number(x.confirmed || 0)} / ${Number(x.attempts || 0)}</strong>
          <small>${launchFunnelPct(x.completionPct)} подтверждено · 95% ДИ ${launchFunnelPct(x.confidence?.lowerPct)}–${launchFunnelPct(x.confidence?.upperPct)} · ${escapeHtml(x.confidence?.label || 'мало данных')} · ${Number(x.pending || 0) ? `${Number(x.pending || 0)} ещё в окне ожидания · ` : ''}окно ${Number(impactOutcomeGuard.outcomeWindowMinutes || 5)} мин.</small>
        </div>`).join('')}</div>
        <p class="tiny">Подтверждённый результат означает успешную доставку запрошенного экрана/раздела. Это не оценка удовлетворённости пользователя и не доказательство качества прогноза.</p>` : ''}
      ${impactFailureDiagnostics.length ? `<div class="release-monitor-section-head"><strong>News Impact: диагностика сбоев</strong><span>категориальные причины без raw error</span></div>
        ${impactFailureSummary.topReason ? `<div class="data-notice">🛠 Чаще всего доставка прерывалась по причине <strong>${escapeHtml(impactFailureSummary.topReason.label || impactFailureSummary.topReason.reason || '')}</strong> · ${Number(impactFailureSummary.topReason.events || 0)} событий.</div>` : ''}
        <div class="launch-campaign-list">${impactFailureDiagnostics.map(x=>`<div>
          <span><b>${escapeHtml(x.label || x.reason || '')}</b></span>
          <strong>${Number(x.events || 0)}</strong>
          <small>${Number(x.users || 0)} пользователей · действия: ${escapeHtml((x.actions || []).slice(0,3).map(a=>`${a.label} ${a.count}`).join(' · ') || '—')} · восстановление: ${escapeHtml((x.recoveries || []).slice(0,2).map(r=>`${r.label} ${r.count}`).join(' · ') || '—')}</small>
        </div>`).join('')}</div>
        <p class="tiny">Сбой доставки не означает, что пользователь недоволен. В growth_events сохраняются только категориальные reason/recovery/status; сырой текст ошибки не сохраняется.</p>` : ''}
      ${impactRecoveryEffectiveness.some(x=>Number(x.observed || 0)>0) ? `<div class="release-monitor-section-head"><strong>Recovery → подтверждённый результат</strong><span>только реальные повторные попытки</span></div>
        ${impactRecoveryBest && Number(impactRecoveryBest.attempts || 0)>=Number(impactRecoveryGuard.minimumSample || 10) ? `<div class="data-notice">🧯 При достаточной выборке наиболее результативный recovery: <strong>${escapeHtml(impactRecoveryBest.label || impactRecoveryBest.recovery || '')}</strong> · ${Number(impactRecoveryBest.recovered || 0)}/${Number(impactRecoveryBest.attempts || 0)} · ${launchFunnelPct(impactRecoveryBest.successPct)}.</div>` : '<div class="data-notice">🧪 Recovery-данных пока недостаточно для сравнения стратегий.</div>'}
        <div class="launch-campaign-list">${impactRecoveryEffectiveness.filter(x=>Number(x.observed || 0)>0).map(x=>`<div>
          <span><b>${escapeHtml(x.label || x.recovery || '')}</b></span>
          <strong>${Number(x.recovered || 0)} / ${Number(x.attempts || 0)}</strong>
          <small>${launchFunnelPct(x.successPct)} восстановлено · 95% ДИ ${launchFunnelPct(x.confidence?.lowerPct)}–${launchFunnelPct(x.confidence?.upperPct)} · ${escapeHtml(x.confidence?.label || 'мало данных')} · ${Number(x.pending || 0) ? `${Number(x.pending || 0)} ещё ожидают · ` : ''}${Number(x.failed || 0)} без подтверждённой доставки</small>
        </div>`).join('')}</div>
        <p class="tiny">Recovery считается успешным только после подтверждённой сервером доставки результата в течение ${Number(impactRecoveryGuard.windowMinutes || 5)} минут. Сам показ fallback или повторной кнопки успехом не считается.</p>` : ''}
      ${impactRecoveryIncidents.length ? `<div class="release-monitor-section-head"><strong>Recovery Incident Center</strong><span>активных ${Number(impactRecoveryIncidentSummary.active || 0)} · эскалаций ${Number(impactRecoveryIncidentSummary.escalatedActive || 0)} · ACK SLO просрочено ${Number(impactRecoveryIncidentSummary.ackSloBreached || 0)} · Recovery SLO просрочено ${Number(impactRecoveryIncidentSummary.recoverySloBreached || 0)}</span></div>
        <div class="data-notice">⏱ SLO: просмотр ≤ <strong>${Number(impactRecoveryIncidentSloGuard.ackTargetMinutes || 30)} мин</strong>, критическая просрочка без просмотра — ${Number(impactRecoveryIncidentSloGuard.ackCriticalMinutes || 120)} мин, восстановление ≤ <strong>${Math.round(Number(impactRecoveryIncidentSloGuard.recoveryTargetMinutes || 360)/60)} ч</strong>. Эскалация меняет только административный приоритет, а не recovery-routing.</div>
        <div class="launch-campaign-list">${impactRecoveryIncidents.map(x=>{
          const shownPriority=x.effectivePriority || x.priority || 'medium';
          const priority=shownPriority==='critical' ? '🚨 critical' : shownPriority==='high' ? '🔴 high' : shownPriority==='medium' ? '🟠 medium' : '🟡 low';
          const stateLabel=x.status==='active'
            ? (x.acknowledged ? 'активен · просмотрен' : 'активен · требует внимания')
            : 'восстановлен';
          const codeLabel=x.code==='performance_drift' ? 'performance drift'
            : x.code==='recent_regression' ? 'recent regression'
              : x.code==='strategy_evidence_unavailable' ? 'evidence недоступно'
                : x.code || 'incident';
          const when=x.lastSeenAt || (x.currentOnly ? 'текущее состояние' : 'время не зафиксировано');
          const runbookSteps=Array.isArray(x.runbook?.steps) ? x.runbook.steps : [];
          const ackKey=`${x.reason || ''}|${x.action || ''}|${x.code || ''}|${x.lastSeenAt || ''}`;
          const ackBusy=state.recoveryIncidentAckPending.has(ackKey);
          return `<div>
            <span><b>${priority} · ${escapeHtml(x.reasonLabel || 'Recovery Strategy')}</b>${x.actionLabel ? ` · ${escapeHtml(x.actionLabel)}` : ''}</span>
            <strong>${escapeHtml(stateLabel)} · ${escapeHtml(codeLabel)}</strong>
            <small>${Number(x.occurrences || 0)} событий · последнее: ${escapeHtml(when)}${x.currentRecoveryLabel ? ` · сейчас: ${escapeHtml(x.currentStrategy || 'fixed')} / ${escapeHtml(x.currentRecoveryLabel)}` : ''}${x.acknowledgedAt ? ` · просмотрено: ${escapeHtml(dateTime(x.acknowledgedAt) || x.acknowledgedAt)}` : ''}</small>
            ${x.slo ? `<small><b>SLO:</b> ${Number.isFinite(Number(x.slo.ageMinutes)) ? `возраст ${Number(x.slo.ageMinutes)} мин · ` : ''}просмотр: ${x.slo.ackStatus==='met' ? '✅ в норме' : x.slo.ackStatus==='breached' ? '🚨 просрочен' : x.slo.ackStatus==='pending' ? '⏳ ожидается' : '—'}${Number.isFinite(Number(x.slo.ackLatencyMinutes)) ? ` (${Number(x.slo.ackLatencyMinutes)} мин)` : ''} · восстановление: ${x.slo.recoveryStatus==='met' ? '✅ в норме' : x.slo.recoveryStatus==='breached' ? '🚨 просрочено' : x.slo.recoveryStatus==='pending' ? '⏳ в работе' : '—'}${Number.isFinite(Number(x.slo.recoveryLatencyMinutes)) ? ` (${Number(x.slo.recoveryLatencyMinutes)} мин)` : ''}${x.escalated ? ` · приоритет повышен: ${escapeHtml(x.priority || 'medium')} → ${escapeHtml(x.effectivePriority || '')}` : ''}</small>` : ''}
            ${runbookSteps.length ? `<small><b>${escapeHtml(x.runbook?.title || 'Runbook')}:</b> ${runbookSteps.map(step=>escapeHtml(step)).join(' → ')} · Автозащита: ${escapeHtml(x.runbook?.automaticSafety || 'fixed fallback')}</small>` : ''}
            ${x.status==='active' && x.canAcknowledge && !x.acknowledged ? `<button class="reminder-btn recovery-incident-ack-btn" type="button" data-reason="${escapeHtml(x.reason || '')}" data-action="${escapeHtml(x.action || '')}" data-code="${escapeHtml(x.code || '')}" data-last-seen-at="${escapeHtml(x.lastSeenAt || '')}" ${ackBusy?'disabled':''}>${ackBusy?'Сохраняю…':'✓ Просмотрено'}</button>` : ''}
            ${x.status==='active' && x.currentOnly && !x.canAcknowledge ? '<small>Подтверждение станет доступно после первого фактического failure-события этого инцидента.</small>' : ''}
          </div>`;
        }).join('')}</div>
        <p class="tiny">RC87 рассчитывает SLO и эскалацию из фактических timestamps: время до просмотра, возраст активного эпизода и время до восстановления. Просрочка повышает только административный приоритет; fixed/adaptive routing остаётся под RC81–RC86 guard-логикой. После acknowledgement новый failure автоматически снова требует внимания. В Incident Center нет Telegram ID и raw error.</p>` : ''}
      ${impactRecoverySloWeekly.length ? `<div class="release-monitor-section-head"><strong>Incident SLO Dashboard · 4 недели</strong><span>${Number(impactRecoverySloSummary.episodes || 0)} эпизодов · ACK ${impactRecoverySloSummary.ackSloPct==null?'—':launchFunnelPct(impactRecoverySloSummary.ackSloPct)} · Recovery ${impactRecoverySloSummary.recoverySloPct==null?'—':launchFunnelPct(impactRecoverySloSummary.recoverySloPct)}</span></div>
        <div class="data-notice">📈 Динамика считается по отдельным incident episodes, а не по каждому failure-событию. Доля SLO использует только эпизоды, для которых целевое время уже можно объективно оценить; короткий auto-recovery до ACK-порога не считается нарушением просмотра.</div>
        <div class="launch-campaign-list">${impactRecoverySloWeekly.map((x,index)=>{
          const ackDelta=index>0 && x.ackSloPct!=null && impactRecoverySloWeekly[index-1]?.ackSloPct!=null
            ? Math.round((Number(x.ackSloPct)-Number(impactRecoverySloWeekly[index-1].ackSloPct))*10)/10
            : null;
          const recoveryDelta=index>0 && x.recoverySloPct!=null && impactRecoverySloWeekly[index-1]?.recoverySloPct!=null
            ? Math.round((Number(x.recoverySloPct)-Number(impactRecoverySloWeekly[index-1].recoverySloPct))*10)/10
            : null;
          return `<div>
            <span><b>${escapeHtml(x.label || '')}</b></span>
            <strong>ACK ${x.ackSloPct==null?'—':launchFunnelPct(x.ackSloPct)} · Recovery ${x.recoverySloPct==null?'—':launchFunnelPct(x.recoverySloPct)}</strong>
            <small>${Number(x.episodes || 0)} эпизодов · active ${Number(x.active || 0)} · ACK ${Number(x.ackMet || 0)}/${Number(x.ackEligible || 0)}${ackDelta==null?'':` · Δ ${ackDelta>0?'+':''}${ackDelta.toFixed(1)} п.п.`} · Recovery ${Number(x.recoveryMet || 0)}/${Number(x.recoveryEligible || 0)}${recoveryDelta==null?'':` · Δ ${recoveryDelta>0?'+':''}${recoveryDelta.toFixed(1)} п.п.`}${Number.isFinite(Number(x.avgAckMinutes)) ? ` · avg ACK ${Number(x.avgAckMinutes)} мин` : ''}${Number.isFinite(Number(x.avgRecoveryMinutes)) ? ` · avg recovery ${Number(x.avgRecoveryMinutes)} мин` : ''}</small>
          </div>`;
        }).join('')}</div>
        ${impactRecoverySloRepeated.length ? `<div class="release-monitor-section-head"><strong>Повторяющиеся Recovery-проблемы</strong><span>reason + action · минимум 2 эпизода</span></div>
          <div class="launch-campaign-list">${impactRecoverySloRepeated.map(x=>`<div>
            <span><b>${escapeHtml(x.reasonLabel || x.reason || '')}</b> · ${escapeHtml(x.actionLabel || x.action || '')}</span>
            <strong>${Number(x.episodes || 0)} эпизода</strong>
            <small>active ${Number(x.active || 0)} · ACK breaches ${Number(x.ackBreaches || 0)} · Recovery breaches ${Number(x.recoveryBreaches || 0)} · guards: ${escapeHtml((x.guards || []).join(' → ') || '—')} · последнее: ${escapeHtml(x.lastStartedAt || '—')}</small>
          </div>`).join('')}</div>` : '<div class="data-notice">Повторяющихся reason + action за 4 недели пока нет.</div>'}
        <p class="tiny">RC88 — аналитический слой: weekly trend и recurrence выводятся из существующего backend-only growth_events. Telegram ID, raw error и произвольные тексты в SLO Dashboard не возвращаются; routing не меняется.</p>` : ''}
      ${impactRecoveryIncidentSloBreachFeed.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Breach Feed</strong><span>' + Number(impactRecoveryBreachSummary.breachEpisodes || 0) + ' эпизодов · active ' + Number(impactRecoveryBreachSummary.activeBreaches || 0) + ' · critical ' + Number(impactRecoveryBreachSummary.critical || 0) + '</span></div>' +
        (impactRecoveryBreachItems.length ? '<div class="launch-campaign-list">' + impactRecoveryBreachItems.map(x=>'<div><span><b>' + (x.severity==='critical'?'🚨':x.severity==='high'?'⚠️':'ℹ️') + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + escapeHtml((x.breachTypes || []).join(' + ') || 'breach') + '</strong><small>' + (x.active?'active':'recovered') + ' · ACK ' + escapeHtml(x.ackStatus || '—') + ' · Recovery ' + escapeHtml(x.recoveryStatus || '—') + ' · age ' + Number(x.ageMinutes || 0) + ' мин · ACK latency ' + (x.ackLatencyMinutes==null?'—':Number(x.ackLatencyMinutes)+' мин') + ' · recovery latency ' + (x.recoveryLatencyMinutes==null?'—':Number(x.recoveryLatencyMinutes)+' мин') + ' · occurrences ' + Number(x.occurrences || 0) + ' · ' + escapeHtml(x.startedAt || '—') + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ За текущую 4-недельную выборку подтверждённых SLO breach-эпизодов нет.</div>') +
        (impactRecoveryBreachRepeated.length ? '<div class="data-notice">🔁 Повторяющиеся breach-пары: ' + impactRecoveryBreachRepeated.map(x=>escapeHtml(x.reasonLabel || x.reason || '') + ' / ' + escapeHtml(x.actionLabel || x.action || '') + ': ' + Number(x.breachEpisodes || 0)).join(' · ') + '</div>' : '') +
        '<p class="tiny">RC89 — drilldown только по уже подтверждённым ACK/Recovery SLO breaches. Используются существующие incident episodes и пороги RC87; новые пороги, Supabase-таблицы и routing-решения не добавляются. Telegram ID, raw error и произвольный free text не возвращаются.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloBreachWatchlist.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Breach Watchlist</strong><span>active ' + Number(impactRecoveryWatchSummary.active || 0) + ' · critical ' + Number(impactRecoveryWatchSummary.criticalActive || 0) + ' · oldest ' + (impactRecoveryWatchSummary.oldestActiveMinutes==null?'—':Number(impactRecoveryWatchSummary.oldestActiveMinutes)+' мин') + '</span></div>' +
        (impactRecoveryWatchItems.length ? '<div class="launch-campaign-list">' + impactRecoveryWatchItems.map(x=>'<div><span><b>' + (x.severity==='critical'?'🚨':'⚠️') + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + escapeHtml((x.breachTypes || []).join(' + ') || 'breach') + '</strong><small>active · age ' + Number(x.ageMinutes || 0) + ' мин · occurrences ' + Number(x.occurrences || 0) + ' · started ' + escapeHtml(x.startedAt || '—') + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ Активных SLO breach-инцидентов для watchlist нет.</div>') +
        (impactRecoveryWatchRepeated.length ? '<div class="data-notice">🔁 Активные повторяющиеся пары: ' + impactRecoveryWatchRepeated.map(x=>escapeHtml(x.reasonLabel || x.reason || '') + ' / ' + escapeHtml(x.actionLabel || x.action || '') + ': ' + Number(x.activeBreaches || 0)).join(' · ') + '</div>' : '') +
        '<p class="tiny">RC90 — watchlist и aging считаются только из RC89 breach feed. Пороги остаются RC87 (30/120/360 минут), новые данные не сохраняются и recovery-routing не меняется.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloBreachTriage.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Breach Triage Queue</strong><span>recovery overdue ' + Number(impactRecoveryTriageSummary.recoveryOverdue || 0) + ' · ACK critical ' + Number(impactRecoveryTriageSummary.ackCritical || 0) + ' · ACK overdue ' + Number(impactRecoveryTriageSummary.ackOverdue || 0) + '</span></div>' +
        (impactRecoveryTriageItems.length ? '<div class="launch-campaign-list">' + impactRecoveryTriageItems.map(x=>'<div><span><b>' + (x.triageStage==='recovery_overdue'?'🚨':x.triageStage==='ack_critical'?'⚠️':'⏱️') + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + escapeHtml(x.triageLabel || x.triageStage || '') + '</strong><small>age ' + Number(x.ageMinutes || 0) + ' мин · ' + escapeHtml((x.breachTypes || []).join(' + ') || 'breach') + ' · started ' + escapeHtml(x.startedAt || '—') + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ Активных SLO breach-инцидентов для triage нет.</div>') +
        '<p class="tiny">RC91 — triage использует только существующие пороги RC87: ACK 30 мин, critical ACK 120 мин, Recovery 360 мин. Это административная группировка, без новых SLO-порогов, persistence и изменений recovery-routing.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloBreachTriageTrend.available !== false ? (
        '<div class="release-monitor-section-head"><strong>Triage Trend · 4 недели</strong><span>active ' + Number(impactRecoveryTriageTrendSummary.currentTotal || 0) + ' · Δ ' + (Number(impactRecoveryTriageTrendSummary.totalDelta || 0)>=0?'+':'') + Number(impactRecoveryTriageTrendSummary.totalDelta || 0) + ' · stuck pairs ' + Number(impactRecoveryTriageTrendSummary.stuckPairs || 0) + '</span></div>' +
        (impactRecoveryTriageTrendWeekly.length ? '<div class="launch-campaign-list">' + impactRecoveryTriageTrendWeekly.map(x=>'<div><span><b>' + escapeHtml(String(x.snapshotAt || '').slice(0,10)) + '</b></span><strong>' + Number(x.total || 0) + ' active</strong><small>Recovery overdue ' + Number(x.recoveryOverdue || 0) + ' · ACK critical ' + Number(x.ackCritical || 0) + ' · ACK overdue ' + Number(x.ackOverdue || 0) + '</small></div>').join('') + '</div>' : '<div class="data-notice">Нет недельных triage-снимков.</div>') +
        (impactRecoveryTriageTrendStuck.length ? '<div class="data-notice">🧭 Пары, остающиеся в triage минимум 2 недельных снимка: ' + impactRecoveryTriageTrendStuck.map(x=>escapeHtml(x.reasonLabel || x.reason || '') + ' / ' + escapeHtml(x.actionLabel || x.action || '') + ': ' + Number(x.weeksPresent || 0) + ' нед.').join(' · ') + '</div>' : '<div class="data-notice">✅ Пар, застрявших в triage минимум на двух недельных снимках, нет.</div>') +
        '<p class="tiny">RC92 — trend строится из фактических incident episodes на конец каждой недели. Используются только существующие пороги RC87; производные trend-данные не сохраняются и recovery-routing не меняется.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloImpactExecutiveSummary.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Impact Executive Summary</strong><span>накоплено ' + Number(impactRecoveryExecutiveSummary.cumulativeOverdueMinutes || 0) + ' мин · неделя ' + Number(impactRecoveryExecutiveSummary.currentWeekOverdueMinutes || 0) + ' мин · Δ ' + (Number(impactRecoveryExecutiveSummary.weekDeltaMinutes || 0)>=0?'+':'') + Number(impactRecoveryExecutiveSummary.weekDeltaMinutes || 0) + ' мин</span></div>' +
        '<div class="release-monitor-kpis">' +
          '<div><span>ACK сверх SLO</span><strong>' + Number(impactRecoveryExecutiveSummary.cumulativeAckOverdueMinutes || 0) + ' мин</strong><small>накоплено по breach episodes</small></div>' +
          '<div><span>Recovery сверх SLO</span><strong>' + Number(impactRecoveryExecutiveSummary.cumulativeRecoveryOverdueMinutes || 0) + ' мин</strong><small>накоплено по breach episodes</small></div>' +
          '<div><span>Активных пар</span><strong>' + Number(impactRecoveryExecutiveSummary.activePairs || 0) + '</strong><small>из ' + Number(impactRecoveryExecutiveSummary.breachPairs || 0) + ' breach-пар</small></div>' +
          '<div><span>Концентрация</span><strong>top1 ' + Number(impactRecoveryExecutiveSummary.top1ContributionPct || 0) + '%</strong><small>top3 ' + Number(impactRecoveryExecutiveSummary.top3ContributionPct || 0) + '% · top5 ' + Number(impactRecoveryExecutiveSummary.top5ContributionPct || 0) + '%</small></div>' +
        '</div>' +
        (impactRecoveryExecutiveTopPair ? '<div class="data-notice">🎯 Ведущая пара: <strong>' + escapeHtml(impactRecoveryExecutiveTopPair.reasonLabel || impactRecoveryExecutiveTopPair.reason || '') + ' / ' + escapeHtml(impactRecoveryExecutiveTopPair.actionLabel || impactRecoveryExecutiveTopPair.action || '') + '</strong> · ' + Number(impactRecoveryExecutiveTopPair.totalOverdueMinutes || 0) + ' мин · ' + Number(impactRecoveryExecutiveTopPair.contributionPct || 0) + '% общего overdue · active episodes ' + Number(impactRecoveryExecutiveTopPair.activeEpisodes || 0) + '</div>' : '<div class="data-notice">✅ Ведущей breach-пары нет: накопленная SLO-просрочка отсутствует.</div>') +
        '<div class="data-notice">Неделя: ↗ ' + Number(impactRecoveryExecutiveSummary.weeklyIncreasedPairs || 0) + ' · ↘ ' + Number(impactRecoveryExecutiveSummary.weeklyDecreasedPairs || 0) + ' · → ' + Number(impactRecoveryExecutiveSummary.weeklyUnchangedPairs || 0) + ' · концентрация top1 ' + (impactRecoveryExecutiveSummary.top1WeeklyDirection==='increased'?'↗️':impactRecoveryExecutiveSummary.top1WeeklyDirection==='decreased'?'↘️':'→') + ' ' + (Number(impactRecoveryExecutiveSummary.top1WeeklyDeltaPctPoints || 0)>=0?'+':'') + Number(impactRecoveryExecutiveSummary.top1WeeklyDeltaPctPoints || 0) + ' п.п. · top3 ' + (impactRecoveryExecutiveSummary.top3WeeklyDirection==='increased'?'↗️':impactRecoveryExecutiveSummary.top3WeeklyDirection==='decreased'?'↘️':'→') + ' ' + (Number(impactRecoveryExecutiveSummary.top3WeeklyDeltaPctPoints || 0)>=0?'+':'') + Number(impactRecoveryExecutiveSummary.top3WeeklyDeltaPctPoints || 0) + ' п.п.</div>' +
        '<p class="tiny">RC97 — единая сводка только объединяет уже рассчитанные RC93–RC96 factual SLO impact views. Новых score, SLO-порогов, persistence или изменений recovery-routing нет.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloImpactFocusQueue.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Impact Focus Queue</strong><span>' + Number(impactRecoveryFocusSummary.queuedPairs || 0) + ' в фокусе · неделя ' + Number(impactRecoveryFocusSummary.currentWeekOverdueMinutes || 0) + ' мин · Δ ' + (Number(impactRecoveryFocusSummary.weekDeltaMinutes || 0)>=0?'+':'') + Number(impactRecoveryFocusSummary.weekDeltaMinutes || 0) + ' мин</span></div>' +
        (impactRecoveryFocusRows.length ? '<div class="launch-campaign-list">' + impactRecoveryFocusRows.map(x=>'<div><span><b>#' + Number(x.queuePosition || 0) + ' ' + (x.weekDirection==='increased'?'↗️':x.weekDirection==='decreased'?'↘️':'→') + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + Number(x.currentWeekOverdueMinutes || 0) + ' мин за неделю</strong><small>Δ ' + (Number(x.weekDeltaMinutes || 0)>=0?'+':'') + Number(x.weekDeltaMinutes || 0) + ' мин · накоплено ' + Number(x.totalOverdueMinutes || 0) + ' мин · вклад ' + Number(x.contributionPct || 0) + '% · active episodes ' + Number(x.activeEpisodes || 0) + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ Focus Queue пуст: фактической SLO-просрочки нет.</div>') +
        '<div class="data-notice">В очереди: ↗ ' + Number(impactRecoveryFocusSummary.increasingQueuedPairs || 0) + ' · ↘ ' + Number(impactRecoveryFocusSummary.decreasingQueuedPairs || 0) + ' · → ' + Number(impactRecoveryFocusSummary.unchangedQueuedPairs || 0) + ' · active pairs ' + Number(impactRecoveryFocusSummary.activePairs || 0) + ' / breach pairs ' + Number(impactRecoveryFocusSummary.breachPairs || 0) + '</div>' +
        '<p class="tiny">RC98 — Focus Queue сортирует только по фактам: текущие недельные overdue minutes → недельная дельта → накопленные overdue minutes. Это не severity-score и не автоматический routing; используются существующие RC87 SLO, persistence не добавляется.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloBreachImpactRanking.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Breach Impact Ranking</strong><span>' + Number(impactRecoveryImpactSummary.totalOverdueMinutes || 0) + ' мин сверх SLO · top ' + Number(impactRecoveryImpactSummary.topContributionPct || 0) + '%</span></div>' +
        (impactRecoveryImpactRanking.length ? '<div class="launch-campaign-list">' + impactRecoveryImpactRanking.map(x=>'<div><span><b>#' + Number(x.rank || 0) + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + Number(x.totalOverdueMinutes || 0) + ' мин · ' + Number(x.contributionPct || 0) + '%</strong><small>ACK сверх SLO ' + Number(x.ackOverdueMinutes || 0) + ' мин · Recovery сверх SLO ' + Number(x.recoveryOverdueMinutes || 0) + ' мин · эпизодов ' + Number(x.episodes || 0) + ' · active ' + Number(x.activeEpisodes || 0) + (x.oldestActiveMinutes==null?'':' · oldest '+Number(x.oldestActiveMinutes)+' мин') + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ Накопленной SLO-просрочки для impact ranking нет.</div>') +
        '<p class="tiny">RC93 — ranking показывает фактическую долю минут сверх существующих ACK/Recovery SLO по каждой паре reason + action. Это не новый score и не новый порог: используются RC87 30/120/360 минут, данные не сохраняются и recovery-routing не меняется.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloBreachImpactTrend.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Impact Trend · 4 недели</strong><span>current ' + Number(impactRecoveryImpactTrendSummary.currentOverdueMinutes || 0) + ' мин · Δ ' + (Number(impactRecoveryImpactTrendSummary.deltaMinutes || 0)>=0?'+':'') + Number(impactRecoveryImpactTrendSummary.deltaMinutes || 0) + ' мин</span></div>' +
        (impactRecoveryImpactTrendWeekly.length ? '<div class="launch-campaign-list">' + impactRecoveryImpactTrendWeekly.map(x=>'<div><span><b>' + escapeHtml(String(x.windowEnd || '').slice(0,10)) + '</b></span><strong>' + Number(x.totalOverdueMinutes || 0) + ' мин</strong><small>ACK ' + Number(x.ackOverdueMinutes || 0) + ' · Recovery ' + Number(x.recoveryOverdueMinutes || 0) + ' · pairs ' + Number(x.pairs || 0) + (x.top?' · top '+escapeHtml(x.top.reasonLabel || x.top.reason || '')+' / '+escapeHtml(x.top.actionLabel || x.top.action || '')+' '+Number(x.top.contributionPct || 0)+'%':'') + '</small></div>').join('') + '</div>' : '<div class="data-notice">Нет недельных impact-снимков.</div>') +
        (impactRecoveryImpactTrendPairs.length ? '<div class="launch-campaign-list">' + impactRecoveryImpactTrendPairs.map(x=>'<div><span><b>' + (x.direction==='increased'?'↗️':x.direction==='decreased'?'↘️':'→') + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + (Number(x.deltaMinutes || 0)>=0?'+':'') + Number(x.deltaMinutes || 0) + ' мин</strong><small>текущая неделя ' + Number(x.currentOverdueMinutes || 0) + ' · предыдущая ' + Number(x.previousOverdueMinutes || 0) + ' · вклад сейчас ' + Number(x.currentContributionPct || 0) + '%</small></div>').join('') + '</div>' : '') +
        '<p class="tiny">RC94 — недельный trend считает только минуты просрочки, фактически возникшие внутри каждой недели. Направление — точный знак разницы с предыдущей неделей, без нового score или threshold; используются RC87 30/120/360 минут, persistence и recovery-routing не меняются.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloImpactConcentration.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Impact Concentration</strong><span>top1 ' + Number(impactRecoveryConcentrationSummary.top1ContributionPct || 0) + '% · top3 ' + Number(impactRecoveryConcentrationSummary.top3ContributionPct || 0) + '% · top5 ' + Number(impactRecoveryConcentrationSummary.top5ContributionPct || 0) + '%</span></div>' +
        (impactRecoveryConcentrationRows.length ? '<div class="launch-campaign-list">' + impactRecoveryConcentrationRows.map(x=>'<div><span><b>#' + Number(x.rank || 0) + ' ' + escapeHtml(x.reasonLabel || x.reason || '') + '</b> · ' + escapeHtml(x.actionLabel || x.action || '') + '</span><strong>' + Number(x.contributionPct || 0) + '%</strong><small>накопленно ' + Number(x.cumulativeContributionPct || 0) + '% · ' + Number(x.totalOverdueMinutes || 0) + ' мин сверх SLO · active episodes ' + Number(x.activeEpisodes || 0) + '</small></div>').join('') + '</div>' : '<div class="data-notice">✅ Концентрация отсутствует: накопленной SLO-просрочки нет.</div>') +
        '<div class="data-notice">Остаток вне top-5: ' + Number(impactRecoveryConcentrationSummary.residualAfterTop5Pct || 0) + '% · всего пар: ' + Number(impactRecoveryConcentrationSummary.pairs || 0) + '</div>' +
        '<p class="tiny">RC95 — концентрация является только кумулятивной долей фактических overdue minutes из RC93 ranking. Новых SLO-порогов или score нет; используются RC87 30/120/360 минут, persistence и recovery-routing не меняются.</p>'
      ) : ''}
      ${impactRecoveryIncidentSloImpactConcentrationTrend.available !== false ? (
        '<div class="release-monitor-section-head"><strong>SLO Impact Concentration Trend · 4 недели</strong><span>top1 ' + Number(impactRecoveryConcentrationTrendSummary.top1ContributionPct || 0) + '% (' + (Number(impactRecoveryConcentrationTrendSummary.top1DeltaPctPoints || 0)>=0?'+':'') + Number(impactRecoveryConcentrationTrendSummary.top1DeltaPctPoints || 0) + ' п.п.) · top3 ' + Number(impactRecoveryConcentrationTrendSummary.top3ContributionPct || 0) + '% (' + (Number(impactRecoveryConcentrationTrendSummary.top3DeltaPctPoints || 0)>=0?'+':'') + Number(impactRecoveryConcentrationTrendSummary.top3DeltaPctPoints || 0) + ' п.п.)</span></div>' +
        (impactRecoveryConcentrationTrendWeekly.length ? '<div class="launch-campaign-list">' + impactRecoveryConcentrationTrendWeekly.map(x=>'<div><span><b>' + escapeHtml(String(x.windowEnd || '').slice(0,10)) + '</b></span><strong>top1 ' + Number(x.top1ContributionPct || 0) + '% · top3 ' + Number(x.top3ContributionPct || 0) + '% · top5 ' + Number(x.top5ContributionPct || 0) + '%</strong><small>' + Number(x.totalOverdueMinutes || 0) + ' мин сверх SLO · pairs ' + Number(x.pairs || 0) + ' · остаток вне top-5 ' + Number(x.residualAfterTop5Pct || 0) + '%' + (x.topPair?' · top '+escapeHtml(x.topPair.reasonLabel || x.topPair.reason || '')+' / '+escapeHtml(x.topPair.actionLabel || x.topPair.action || ''):'') + '</small></div>').join('') + '</div>' : '<div class="data-notice">Нет недельных снимков концентрации.</div>') +
        '<div class="data-notice">Динамика: top1 ' + (impactRecoveryConcentrationTrendSummary.top1Direction==='increased'?'↗️':impactRecoveryConcentrationTrendSummary.top1Direction==='decreased'?'↘️':'→') + ' · top3 ' + (impactRecoveryConcentrationTrendSummary.top3Direction==='increased'?'↗️':impactRecoveryConcentrationTrendSummary.top3Direction==='decreased'?'↘️':'→') + ' · top5 ' + (impactRecoveryConcentrationTrendSummary.top5Direction==='increased'?'↗️':impactRecoveryConcentrationTrendSummary.top5Direction==='decreased'?'↘️':'→') + ' · пар Δ ' + (Number(impactRecoveryConcentrationTrendSummary.pairDelta || 0)>=0?'+':'') + Number(impactRecoveryConcentrationTrendSummary.pairDelta || 0) + '</div>' +
        '<p class="tiny">RC96 — trend сравнивает долю фактических overdue minutes внутри отдельных недельных окон. Направление определяется только знаком точной дельты в процентных пунктах, без нового score или threshold; используются RC87 30/120/360 минут, persistence и recovery-routing не меняются.</p>'
      ) : ''}
      ${impactRecoveryStrategyAlerts.length ? `<div class="release-monitor-section-head"><strong>Recovery: предупреждения</strong><span>${Number(impactRecoveryAlertSummary.critical || 0)} critical · ${Number(impactRecoveryAlertSummary.warnings || 0)} warning · ${Number(impactRecoveryAlertSummary.info || 0)} info</span></div>
        <div class="launch-campaign-list">${impactRecoveryStrategyAlerts.map(x=>`<div>
          <span><b>${x.severity==='critical'?'🚨':x.severity==='warning'?'⚠️':'ℹ️'} ${escapeHtml(x.reasonLabel || 'Recovery Strategy')}</b>${x.actionLabel ? ` · ${escapeHtml(x.actionLabel)}` : ''}</span>
          <strong>${escapeHtml(x.code || '')}</strong>
          <small>${escapeHtml(x.message || '')}</small>
        </div>`).join('')}</div>` : ''}
      ${impactRecoveryStrategyMatrix.length ? `<div class="release-monitor-section-head"><strong>Recovery Strategy Guard</strong><span>fixed fallback → adaptive только при доказательстве</span></div>
        <div class="data-notice">🛡 Adaptive override требует минимум <strong>${Number(impactRecoveryStrategyGuard.minAttempts || 30)}</strong> зрелых попыток у baseline и кандидата за ${Number(impactRecoveryStrategyGuard.lookbackDays || 30)} дней, прирост ≥ ${Number(impactRecoveryStrategyGuard.minLiftPctPoints || 5)} п.п. и непересекающиеся 95% Wilson-интервалы. RC82 требует минимум ${Number(impactRecoveryStrategyGuard.stabilityMinAttempts || 10)} зрелых попыток у обоих вариантов за свежие ${Number(impactRecoveryStrategyGuard.stabilityWindowDays || 7)} дней. RC83 отключает adaptive, если recent recovery просел минимум на ${Number(impactRecoveryStrategyGuard.driftDropPctPoints || 15)} п.п. против предыдущего окна и 95% Wilson-интервалы подтверждают drift.</div>
        ${Number(impactRecoveryStrategySummary.driftBlocked || 0)>0 ? `<div class="data-notice">🚨 Drift circuit breaker: <strong>${Number(impactRecoveryStrategySummary.driftBlocked || 0)}</strong> adaptive-правил автоматически возвращены на fixed fallback.</div>` : ''}
        <div class="launch-campaign-list">${impactRecoveryStrategyMatrix.map(x=>{
          const adaptive=x.strategy==='adaptive';
          const guard=x.guardReason==='baseline_sample' ? 'недостаточно данных по базовому правилу'
            : x.guardReason==='no_significant_better' ? 'нет статистически подтверждённой лучшей альтернативы'
              : x.guardReason==='stability_sample' ? 'кандидат ждёт подтверждения на свежем окне'
                : x.guardReason==='recent_regression' ? 'свежие данные не подтверждают override'
                  : x.guardReason==='performance_drift' ? 'adaptive отключён: подтверждён performance drift'
                    : x.guardReason==='stable_significant_better' ? 'adaptive подтверждён на длинном и свежем окне'
                      : x.guardReason==='significant_better' ? 'подтверждённый adaptive override'
                        : 'fixed fallback';
          return `<div>
            <span><b>${escapeHtml(x.reasonLabel || x.reason || '')}</b> · ${escapeHtml(x.actionLabel || x.action || '')}</span>
            <strong>${escapeHtml(x.fixedRecoveryLabel || x.fixedRecovery || '')} → ${escapeHtml(x.selectedRecoveryLabel || x.selectedRecovery || '')}</strong>
            <small>${adaptive?'🧠 adaptive':'🛡 fixed'} · ${escapeHtml(guard)} · 30д base ${Number(x.fixedAttempts || 0)} / ${launchFunnelPct(x.fixedSuccessPct)} · selected ${Number(x.selectedAttempts || 0)} / ${launchFunnelPct(x.selectedSuccessPct)}${Number(x.liftPctPoints || 0) ? ` · Δ ${Number(x.liftPctPoints || 0)>0?'+':''}${Number(x.liftPctPoints || 0).toFixed(1)} п.п.` : ''}${x.proposedRecovery && !adaptive ? ` · кандидат: ${escapeHtml(x.proposedRecoveryLabel || x.proposedRecovery)}` : ''}${Number(x.recentFixedAttempts || 0) || Number(x.recentSelectedAttempts || 0) ? ` · 7д ${Number(x.recentFixedAttempts || 0)}/${launchFunnelPct(x.recentFixedSuccessPct)} → ${Number(x.recentSelectedAttempts || 0)}/${launchFunnelPct(x.recentSelectedSuccessPct)}` : ''}${Number(x.priorSelectedAttempts || 0) || Number(x.recentDriftAttempts || 0) ? ` · drift ${Number(x.priorSelectedAttempts || 0)}/${launchFunnelPct(x.priorSelectedSuccessPct)} → ${Number(x.recentDriftAttempts || 0)}/${launchFunnelPct(x.recentDriftSuccessPct)}${Number(x.driftDropPctPoints || 0)>0 ? ` · −${Number(x.driftDropPctPoints || 0).toFixed(1)} п.п.` : ''}` : ''}</small>
          </div>`;
        }).join('')}</div>
        <p class="tiny">Admin и runtime используют один и тот же 30-дневный evidence loader. Свежий ${Number(impactRecoveryStrategyGuard.stabilityWindowDays || 7)}-дневный guard блокирует переключение при недостатке данных или недавнем ухудшении. RC83 сравнивает recent окно с предыдущей частью 30-дневного периода и при статистически подтверждённом падении переводит routing на fixed fallback. В growth_events сохраняется только категориальная причина strategy_guard; raw error не сохраняется.</p>` : (!impactRecoveryStrategySummary.available ? '<div class="data-notice">Recovery Strategy временно недоступна: runtime остаётся на fixed fallback.</div>' : '')}
      ${impactRecoveryTransitionHistory.length ? `<div class="release-monitor-section-head"><strong>История Recovery Strategy</strong><span>${Number(impactRecoveryTransitionSummary.total || impactRecoveryTransitionHistory.length)} переключений · fixed→adaptive ${Number(impactRecoveryTransitionSummary.fixedToAdaptive || 0)} · adaptive→fixed ${Number(impactRecoveryTransitionSummary.adaptiveToFixed || 0)}</span></div>
        <div class="launch-campaign-list">${impactRecoveryTransitionHistory.map(x=>`<div>
          <span><b>${escapeHtml(x.reasonLabel || x.reason || '')}</b> · ${escapeHtml(x.actionLabel || x.action || '')}</span>
          <strong>${escapeHtml(x.fromStrategy || '')} → ${escapeHtml(x.toStrategy || '')}</strong>
          <small>${escapeHtml(x.fromRecoveryLabel || x.fromRecovery || '')} → ${escapeHtml(x.toRecoveryLabel || x.toRecovery || '')} · ${escapeHtml(x.guardReason || '—')} · ${escapeHtml(x.at || '')}</small>
        </div>`).join('')}</div>
        <p class="tiny">История строится по фактически применённой стратегии в failure-событиях за 30 дней. Telegram ID в API истории не возвращаются.</p>` : ''}
      ${impactTrend.some(x=>Number(x.currentUsers || 0)>0 || Number(x.previousUsers || 0)>0) ? `<div class="release-monitor-section-head"><strong>Динамика News Impact</strong><span>текущие ${Number(impactTrendGuard.comparisonDays || d.days || 7)} дн. vs предыдущие</span></div>
        <div class="launch-campaign-list">${impactTrend.filter(x=>Number(x.currentUsers || 0)>0 || Number(x.previousUsers || 0)>0).map(x=>{
          const signal=x.signal==='improved' ? '↗ подтверждённый рост'
            : x.signal==='weakened' ? '↘ подтверждённое снижение'
              : x.signal==='insufficient' ? '◌ мало данных'
                : '≈ изменение не подтверждено';
          return `<div>
            <span><b>${escapeHtml(x.label || x.code || '')}</b></span>
            <strong>${launchFunnelPct(x.previousPct)} → ${launchFunnelPct(x.currentPct)}</strong>
            <small>${escapeHtml(signal)} · Δ ${Number(x.deltaPctPoints || 0)>0?'+':''}${Number(x.deltaPctPoints || 0).toFixed(1)} п.п. · выборка ${Number(x.previousUsers || 0)} → ${Number(x.currentUsers || 0)}</small>
          </div>`;
        }).join('')}</div>` : (!d.trendAvailable ? '<div class="data-notice">Динамика News Impact временно недоступна; текущий период продолжает работать.</div>' : '')}`;
  
    stages.querySelectorAll('.recovery-incident-ack-btn').forEach(button=>{
      button.addEventListener('click',()=>acknowledgeRecoveryIncident({
        reason:String(button.dataset.reason || ''),
        action:String(button.dataset.action || ''),
        code:String(button.dataset.code || ''),
        lastSeenAt:String(button.dataset.lastSeenAt || ''),
      }));
    });
  
    const sources=d.campaigns || [];
    campaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Источники и кампании</strong><span>без Telegram ID</span></div>
      ${sources.length ? `<div class="launch-campaign-list">${sources.map(x=>`<div>
        <span><b>${escapeHtml(x.source || 'telegram')}</b> · ${escapeHtml(x.campaign || 'direct')}</span>
        <strong>${Number(x.entries || 0)} → ${Number(x.fullAi || 0)}</strong>
        <small>AI conversion ${launchFunnelPct(x.conversionPct)} · ${Number(x.events || 0)} событий</small>
      </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет атрибутированных входов.</div>'}
      <p class="tiny">${escapeHtml(d.privacy || '')}</p>`;
  
    const mediaRows=d.mediaCampaigns || [];
    const mediaSummary=d.mediaSummary || {};
    mediaCampaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Материалы СМИ</strong><span>source · campaign · content</span></div>
      <div class="media-campaign-summary">
        <span>Создано ссылок <strong>${Number(mediaSummary.linksCreated || 0)}</strong></span>
        <span>Входы <strong>${Number(mediaSummary.entries || 0)}</strong></span>
        <span>Quick AI <strong>${Number(mediaSummary.quickAi || 0)}</strong></span>
        <span>Полный AI <strong>${Number(mediaSummary.fullAi || 0)}</strong></span>
        <span>Конверсия <strong>${launchFunnelPct(mediaSummary.conversionPct)}</strong></span>
      </div>
      ${mediaRows.length ? `<div class="media-campaign-list">${mediaRows.map(x=>`<div class="media-campaign-row">
        <div class="media-campaign-name"><strong>${escapeHtml(x.content || 'default')}</strong><small>${escapeHtml(x.source || 'media')} · ${escapeHtml(x.campaign || 'launch')}</small></div>
        <div class="media-campaign-flow"><span>${Number(x.entries || 0)} входов</span><b>→</b><span>${Number(x.fullAi || 0)} полный AI</span></div>
        <div class="media-campaign-metrics"><span>${Number(x.deepLinkOpens || 0)} deep-link</span><span>${Number(x.quickAi || 0)} quick AI</span><span>${launchFunnelPct(x.fullAiConversionPct)} конверсия</span><span>${Number(x.linksCreated || 0)} ссылок</span></div>
      </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет данных по отдельным материалам СМИ.</div>'}
      <p class="tiny">Статистика агрегируется по first-party attribution. Telegram ID пользователей не отображаются.</p>`;
  
  }
  
  async function acknowledgeRecoveryIncident({reason='',action='',code='',lastSeenAt=''}={}) {
    if (!isAdmin() || !reason || !action || !code || !lastSeenAt) return;
    const key=`${reason}|${action}|${code}|${lastSeenAt}`;
    if (state.recoveryIncidentAckPending.has(key)) return;
    state.recoveryIncidentAckPending.add(key);
    renderLaunchFunnel();
    try {
      await api('/api/recovery-incident-ack',{
        method:'POST',
        body:JSON.stringify({reason,action,code,lastSeenAt}),
        retry:false,
        dedupe:false,
        timeoutMs:10000,
      });
      toast('Инцидент отмечен как просмотренный.');
      await loadLaunchFunnel(true);
    } catch (e) {
      toast(e.message);
      if (Number(e?.status || 0)===409) await loadLaunchFunnel(true);
    } finally {
      state.recoveryIncidentAckPending.delete(key);
      renderLaunchFunnel();
    }
  }
  
  async function loadLaunchFunnel(force=false) {
    if (!isAdmin() || state.launchFunnelLoading) return;
    if (!force && state.launchFunnel) { renderLaunchFunnel(); return; }
    state.launchFunnelLoading=true;
    renderLaunchFunnel();
    try {
      const days=Number($('launchFunnelPeriod')?.value || state.launchFunnelDays || 7);
      state.launchFunnelDays=days;
      state.launchFunnel=await api(`/api/launch-funnel?days=${days}`,{retry:false,timeoutMs:10000});
    } catch (e) {
      state.launchFunnel={available:false,reason:e.message};
      toast(e.message);
    } finally {
      state.launchFunnelLoading=false;
      renderLaunchFunnel();
    }
  }
  

  return Object.freeze({
    renderLaunchFunnel,
    acknowledgeRecoveryIncident,
    loadLaunchFunnel,
  });
}
