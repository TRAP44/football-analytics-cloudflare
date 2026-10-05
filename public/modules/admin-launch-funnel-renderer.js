import { renderLaunchFunnelStages } from './admin-launch-funnel-stages.js';
export function createAdminLaunchFunnelRenderer({
  state,
  $,
  isAdmin,
  escapeHtml,
  dateTime,
  onAcknowledge,
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
  
  renderLaunchFunnelStages({
    d,
    dateTime,
    escapeHtml,
    handoff,
    impactAttributionGuard,
    impactBottleneck,
    impactConfidenceGuard,
    impactFailureDiagnostics,
    impactFailureSummary,
    impactFunnel,
    impactOutcomeBottleneck,
    impactOutcomeGuard,
    impactOutcomeQuality,
    impactRecoveryAlertSummary,
    impactRecoveryBest,
    impactRecoveryBreachItems,
    impactRecoveryBreachRepeated,
    impactRecoveryBreachSummary,
    impactRecoveryConcentrationRows,
    impactRecoveryConcentrationSummary,
    impactRecoveryConcentrationTrendSummary,
    impactRecoveryConcentrationTrendWeekly,
    impactRecoveryEffectiveness,
    impactRecoveryExecutiveSummary,
    impactRecoveryExecutiveTopPair,
    impactRecoveryFocusRows,
    impactRecoveryFocusSummary,
    impactRecoveryGuard,
    impactRecoveryImpactRanking,
    impactRecoveryImpactSummary,
    impactRecoveryImpactTrendPairs,
    impactRecoveryImpactTrendSummary,
    impactRecoveryImpactTrendWeekly,
    impactRecoveryIncidentSloBreachFeed,
    impactRecoveryIncidentSloBreachImpactRanking,
    impactRecoveryIncidentSloBreachImpactTrend,
    impactRecoveryIncidentSloBreachTriage,
    impactRecoveryIncidentSloBreachTriageTrend,
    impactRecoveryIncidentSloBreachWatchlist,
    impactRecoveryIncidentSloGuard,
    impactRecoveryIncidentSloImpactConcentration,
    impactRecoveryIncidentSloImpactConcentrationTrend,
    impactRecoveryIncidentSloImpactExecutiveSummary,
    impactRecoveryIncidentSloImpactFocusQueue,
    impactRecoveryIncidentSummary,
    impactRecoveryIncidents,
    impactRecoverySloRepeated,
    impactRecoverySloSummary,
    impactRecoverySloWeekly,
    impactRecoveryStrategyAlerts,
    impactRecoveryStrategyGuard,
    impactRecoveryStrategyMatrix,
    impactRecoveryStrategySummary,
    impactRecoveryTransitionHistory,
    impactRecoveryTransitionSummary,
    impactRecoveryTriageItems,
    impactRecoveryTriageSummary,
    impactRecoveryTriageTrendStuck,
    impactRecoveryTriageTrendSummary,
    impactRecoveryTriageTrendWeekly,
    impactRecoveryWatchItems,
    impactRecoveryWatchRepeated,
    impactRecoveryWatchSummary,
    impactTrend,
    impactTrendGuard,
    kpis,
    last,
    launchFunnelPct,
    media,
    onAcknowledge,
    rechecks,
    stages,
    state,
    status,
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

  return Object.freeze({
    renderLaunchFunnel,
  });
}
