export function renderLaunchFunnelStages(ctx = {}) {
  const {
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
  } = ctx;

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
  button.addEventListener('click',()=>onAcknowledge({
  reason:String(button.dataset.reason || ''),
  action:String(button.dataset.action || ''),
  code:String(button.dataset.code || ''),
  lastSeenAt:String(button.dataset.lastSeenAt || ''),
  }));
  });
}
