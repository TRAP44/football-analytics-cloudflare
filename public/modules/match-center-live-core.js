export function createMatchCenterLiveCore(deps = {}) {
  const {
    categoryLabel,
    dateTime,
    ensureMatchCenterController,
    escapeHtml,
    matchCenterController,
    publicText,
    safeUrl,
    sendActionError,
    state,
  } = deps;

  function minuteLabel(event) {
    const base = Number(event.minute || 0);
    const extra = Number(event.extra || 0);
    return `${base}${extra > 0 ? `+${extra}` : ''}′`;
  }
  
  function liveEventsHtml(events = []) {
    if (!events.length) return '<div class="empty compact-empty">События пока не доступны для этого матча.</div>';
    return `<div class="live-events">${events.map(e => `
      <div class="live-event ${escapeHtml(e.side || '')}">
        <span class="event-minute">${minuteLabel(e)}</span>
        <div class="event-main">
          <strong>${escapeHtml(e.label || 'Событие')}</strong>
          <span>${escapeHtml(e.player || e.teamName || '')}${e.assist ? ` · ${escapeHtml(e.assist)}` : ''}</span>
        </div>
        <span class="event-team">${escapeHtml(e.teamName || '')}</span>
      </div>`).join('')}</div>`;
  }
  
  function lineupPlayerName(p) {
    return typeof p === 'string' ? p : (p?.name || 'Игрок');
  }
  
  function lineupPlayerNumber(p) {
    if (typeof p === 'string') return '';
    return p?.number ?? '';
  }
  
  function lineupPlayerGrid(p) {
    if (typeof p === 'string') return '';
    return String(p?.grid || '');
  }
  
  function shortPlayerName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return escapeHtml(parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Игрок'));
  }
  
  function lineupPitchHtml(lineup, title) {
    if (!lineup?.startXI?.length) return '<div class="empty compact-empty">Стартовый состав ещё не опубликован.</div>';
    const players = lineup.startXI || [];
    const parsed = players.map((p, i) => {
      const bits = lineupPlayerGrid(p).split(':').map(Number);
      return { p, row: Number.isFinite(bits[0]) ? bits[0] : null, col: Number.isFinite(bits[1]) ? bits[1] : null, i };
    });
    const hasGrid = parsed.filter(x => x.row && x.col).length >= 8;
    if (!hasGrid) {
      return `<div class="lineup-fallback">${players.map((p, i) => `<div class="lineup-fallback-row"><b>${lineupPlayerNumber(p) || i + 1}</b><span>${escapeHtml(lineupPlayerName(p))}</span></div>`).join('')}</div>`;
    }
    const maxRow = Math.max(...parsed.filter(x => x.row).map(x => x.row), 4);
    const rowCounts = {};
    parsed.forEach(x => { if (x.row) rowCounts[x.row] = Math.max(rowCounts[x.row] || 0, x.col || 1); });
    return `<div class="formation-pitch" aria-label="${escapeHtml(title)}">
      <div class="pitch-half-line"></div><div class="pitch-circle"></div>
      ${parsed.map(({p,row,col,i}) => {
        const safeRow = row || Math.min(maxRow, i < 1 ? 1 : 2 + Math.floor((i-1)/4));
        const count = Math.max(1, rowCounts[safeRow] || 1);
        const safeCol = col || ((i % count) + 1);
        const x = count === 1 ? 50 : 12 + ((safeCol - 1) / Math.max(1, count - 1)) * 76;
        const y = maxRow <= 1 ? 50 : 91 - ((safeRow - 1) / (maxRow - 1)) * 82;
        return `<div class="pitch-player" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">
          <span>${lineupPlayerNumber(p) || '•'}</span><small>${shortPlayerName(lineupPlayerName(p))}</small>
        </div>`;
      }).join('')}
    </div>`;
  }
  
  function lineupQualityLabel(lineup) {
    const quality = lineup?.quality || {};
    if (lineup?.quality?.confirmed === true) return `Подтверждён · ${Number(quality.startCount || 11)}/11`;
    if (quality.partial) return `Неполный состав · ${Number(quality.uniqueStartCount || quality.startCount || 0)}/11`;
    return 'Состав не подтверждён';
  }
  
  function lineupTeamHtml(lineup, title) {
    if (!lineup) return `<div class="center-lineup-team"><h3>${escapeHtml(title)}</h3><div class="empty compact-empty">Состав не опубликован.</div></div>`;
    const subs = lineup.substitutes || [];
    const quality = lineup.quality || {};
    const qualityNotice = quality.partial
      ? `<div class="data-notice">⚠️ Неполный состав источника: ${Number(quality.uniqueStartCount || quality.startCount || 0)}/11 уникальных игроков старта. До полного XI он не считается подтверждённым.</div>`
      : '';
    return `<div class="center-lineup-team">
      <div class="center-lineup-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(lineup.formation || 'Схема —')} · ${escapeHtml(lineupQualityLabel(lineup))}</span></div><div class="coach-chip">👔 ${escapeHtml(lineup.coach || 'Тренер —')}</div></div>
      ${qualityNotice}
      ${lineupPitchHtml(lineup, title)}
      <details class="bench-details"><summary>Запасные · ${subs.length}</summary>
        <div class="bench-grid">${subs.length ? subs.map(p => `<span><b>${lineupPlayerNumber(p) || '•'}</b>${escapeHtml(lineupPlayerName(p))}</span>`).join('') : '<i>Нет данных</i>'}</div>
      </details>
    </div>`;
  }
  
  function lineupLiveHtml(lineups, match) {
    const home = lineups?.home;
    const away = lineups?.away;
    if (!home && !away) return '<div class="empty compact-empty">Составы не опубликованы или не входят в покрытие турнира.</div>';
    return `<div class="center-lineups-grid">${lineupTeamHtml(home, match.home?.name || 'Хозяева')}${lineupTeamHtml(away, match.away?.name || 'Гости')}</div>`;
  }
  
  async function requestMatchCenter(fixtureId, extraParams = {}, options = {}) {
    const controller = await ensureMatchCenterController();
    return controller.requestMatchCenter(fixtureId, extraParams, options);
  }
  
  function startLiveRefresh(fixtureId) {
    if (matchCenterController) {
      matchCenterController.startLiveRefresh(fixtureId);
      return;
    }
    void ensureMatchCenterController()
      .then(controller => controller.startLiveRefresh(fixtureId))
      .catch(error => sendActionError('live_refresh', error, 'analysisView'));
  }
  
  function signedPp(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(1)} п.п.`;
  }
  
  function oddsMovementHtml(move) {
    if (!move?.baseline || !move?.probabilityChange) return '<p class="muted">История движения появится после нескольких снимков во время матча.</p>';
    const row = (label, key) => {
      const d = Number(move.probabilityChange?.[key] || 0);
      const cls = d > .4 ? 'up' : d < -.4 ? 'down' : 'flat';
      const arrow = d > .4 ? '↑' : d < -.4 ? '↓' : '→';
      return `<div class="odds-move-row ${cls}"><span>${label}</span><strong>${move.baseline?.[key] ?? '—'} → ${move.current?.[key] ?? '—'}</strong><b>${arrow} ${signedPp(d)}</b></div>`;
    };
    return `<div class="odds-movement-grid">${row('П1','home')}${row('Н','draw')}${row('П2','away')}</div><p class="tiny">Сравнение с самым ранним сохранённым снимком во время матча${move.from ? ` · ${dateTime(move.from)}` : ''}. Изменение указано в расчётной вероятности.</p>`;
  }
  
  function playerMetricText(p) {
    const bits = [];
    if (Number(p.goals)) bits.push(`${p.goals} гол`);
    if (Number(p.assists)) bits.push(`${p.assists} ассист`);
    if (Number(p.saves)) bits.push(`${p.saves} сейв`);
    if (Number(p.shotsOn)) bits.push(`${p.shotsOn} в створ`);
    if (Number(p.keyPasses)) bits.push(`${p.keyPasses} ключ. пас`);
    if (!bits.length && Number(p.minutes)) bits.push(`${p.minutes} мин`);
    return bits.join(' · ') || '—';
  }
  
  function absenceKindLabel(row = {}) {
    if (row.categoryLabel) return String(row.categoryLabel);
    return ({ suspension:'Дисквалификация', injury:'Травма', illness:'Болезнь', other:'Другая причина' })[String(row.category || '')] || 'Потеря состава';
  }
  
  function absenceStatusLabel(row = {}) {
    if (row.statusLabel) return String(row.statusLabel);
    return row.status === 'doubtful' ? 'Под вопросом' : '';
  }
  
  function liveAbsencesHtml(absences, match) {
    const side = (title, rows = []) => `<div class="absence-live-side"><h3>${escapeHtml(title)}</h3>${rows.length
      ? rows.map(x => {
        const status=absenceStatusLabel(x);
        return `<div class="absence-live-row">
          <div class="absence-live-title"><strong>${escapeHtml(x.name || 'Игрок')}</strong><span class="absence-kind ${escapeHtml(String(x.category || 'other'))}">${escapeHtml(absenceKindLabel(x))}</span></div>
          <span>${escapeHtml(publicText(x.reason || x.type || status || 'Есть отметка о доступности'))}</span>
          ${status ? `<small>${escapeHtml(status)}</small>` : ''}
        </div>`;
      }).join('')
      : '<p class="muted">Активных отметок о потерях нет или данные недоступны.</p>'}</div>`;
    const reconciled=Number(absences?.summary?.resolvedByLineup || 0);
    return `<div class="absence-live-grid">${side(match.home?.name || 'Хозяева', absences?.home || [])}${side(match.away?.name || 'Гости', absences?.away || [])}</div>${reconciled ? `<p class="tiny">Сверка с опубликованными составами сняла устаревших отметок: ${reconciled}.</p>` : ''}`;
  }
  
  
  function centerStatNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replaceAll('%','').replace(',','.'));
    return Number.isFinite(n) ? n : null;
  }
  
  function centerStatRow(stats, key) {
    return (stats?.items || []).find(x => x.key === key) || null;
  }
  
  function centerCompareRow(label, homeValue, awayValue, suffix = '') {
    const hn = centerStatNumber(homeValue);
    const an = centerStatNumber(awayValue);
    const total = Math.max(0.001, (hn || 0) + (an || 0));
    const hp = hn === null ? 50 : Math.max(6, Math.min(94, (hn / total) * 100));
    const ap = 100 - hp;
    const fmt = v => v === null || v === undefined || v === '' ? '—' : `${escapeHtml(String(v))}${suffix && !String(v).includes(suffix) ? suffix : ''}`;
    return `<div class="center-stat-visual">
      <div class="center-stat-values"><strong>${fmt(homeValue)}</strong><span>${escapeHtml(label)}</span><strong>${fmt(awayValue)}</strong></div>
      <div class="center-stat-bar"><i style="width:${hp}%"></i><b style="width:${ap}%"></b></div>
    </div>`;
  }
  
  function centerKeyStatsHtml(stats) {
    const rows = [
      ['expected_goals','xG'],
      ['Shots on Goal','В створ'],
      ['Total Shots','Удары'],
      ['Ball Possession','Владение'],
      ['Corner Kicks','Угловые'],
    ].map(([key,label]) => [centerStatRow(stats,key), label]).filter(([row]) => row);
    if (!rows.length) return '<div class="empty compact-empty">Ключевая статистика пока недоступна.</div>';
    return `<div class="center-key-stats">${rows.slice(0,5).map(([r,l]) => centerCompareRow(l,r.home,r.away)).join('')}</div>`;
  }
  
  function availabilityQualityHintHtml(quality = {}) {
    if (!quality?.state || quality.state === 'unavailable') return '';
    const label = publicText(quality.label || 'Качество данных о потерях');
    const detail = quality.state === 'verified'
      ? `проверено записей: ${Number(quality.acceptedCount || 0)}`
      : quality.state === 'sanitized'
        ? `очищено перед аналитикой · исключено: ${Number(quality.rejectedCount || 0)}`
        : quality.state === 'source_untrusted'
          ? 'данные источника недостаточно свежие или подтверждённые'
          : 'некорректные записи исключены из модели';
    const limited = ['verified','sanitized'].includes(quality.state) ? '' : 'limited';
    return `<div class="coverage-badge ${limited}">Потери · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  }
  
  function xgQualityHintHtml(quality = {}) {
    if (!quality?.state) return '';
    const trusted = Boolean(quality.confidenceBearing);
    const label = publicText(quality.label || (trusted ? 'xG подтверждён' : 'xG не используется'));
    const validSides = Number(quality.validSides || 0);
    const detail = trusted
      ? 'используется в live-инсайтах'
      : quality.state === 'partial'
        ? `доступно сторон: ${validSides}/2 · не используется для сравнения`
        : quality.state === 'source_untrusted'
          ? 'статистика источника недостаточно свежая или подтверждённая'
          : quality.state === 'invalid'
            ? 'некорректное значение исключено из аналитики'
            : 'полная пара xG сейчас недоступна';
    return `<div class="coverage-badge ${trusted ? '' : 'limited'}">xG · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  }
  
  function eventQualityHintHtml(quality = {}) {
    if (!quality?.state || quality.state === 'unavailable') return '';
    const label = publicText(quality.label || 'Качество событий');
    const issues = Number(quality.rejectedCount || 0) + Number(quality.duplicateCount || 0) + Number(quality.unknownSideCount || 0);
    const detail = quality.state === 'verified'
      ? `проверено событий: ${Number(quality.displayCount || 0)}`
      : quality.state === 'sanitized'
        ? `очищено перед аналитикой · проблем: ${issues}`
        : quality.state === 'source_untrusted'
          ? 'данные источника недостаточно свежие или подтверждённые'
          : 'некорректные записи исключены';
    const limited = quality.state === 'verified' ? '' : 'limited';
    return `<div class="coverage-badge ${limited}">События · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  }
  
  function statisticsQualityHintHtml(quality = {}) {
    if (!quality?.state || quality.state === 'unavailable') return '';
    const label = publicText(quality.label || 'Качество статистики');
    const issues = Number(quality.invalidCellCount || 0);
    const partial = Number(quality.partialPairCount || 0);
    const detail = quality.state === 'verified'
      ? `сравнимых метрик: ${Number(quality.analyticalRowCount || 0)}`
      : quality.state === 'sanitized'
        ? `очищено перед аналитикой · ошибок: ${issues} · неполных пар: ${partial}`
        : quality.state === 'source_untrusted'
          ? 'данные источника недостаточно свежие или подтверждённые'
          : 'некорректные значения исключены';
    const limited = quality.state === 'verified' ? '' : 'limited';
    return `<div class="coverage-badge ${limited}">Статистика · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  }
  
  function oddsQualityHintHtml(quality = {}) {
    if (!quality?.state || quality.state === 'unavailable') return '';
    const label = publicText(quality.label || 'Качество рынка');
    const detail = quality.state === 'verified'
      ? `источников: ${Number(quality.sourceCount || 0)}`
      : quality.state === 'sanitized'
        ? 'вероятности пересчитаны из валидных коэффициентов'
        : quality.state === 'source_untrusted'
          ? 'данные источника недостаточно свежие или подтверждённые'
          : 'некорректный рынок исключён из аналитики';
    const limited = ['verified','sanitized'].includes(quality.state) ? '' : 'limited';
    return `<div class="coverage-badge ${limited}">Рынок · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
  }
  
  function centerAllStatsHtml(stats) {
    const items = stats?.items || [];
    if (!items.length) return '<div class="empty compact-empty">Детальная статистика пока недоступна.</div>';
    return `<div class="center-all-stats">${items.map(x => centerCompareRow(publicText(x.label), x.home, x.away)).join('')}</div>`;
  }
  
  function timelineEventsHtml(events = [], match = {}) {
    if (!events.length) return '<div class="empty compact-empty">События матча пока не доступны.</div>';
    let hs = 0, as = 0;
    const enriched = events.map(e => {
      const isGoal = String(e.type || '').toLowerCase() === 'goal' && !String(e.detail || '').toLowerCase().includes('missed');
      if (isGoal) {
        if (e.side === 'home') hs += 1;
        if (e.side === 'away') as += 1;
      }
      return { ...e, goalScore: isGoal ? `${hs}:${as}` : '' };
    });
    return `<div class="center-timeline">
      <div class="timeline-club-head"><span>${escapeHtml(match.home?.name || 'Хозяева')}</span><b>Хронология</b><span>${escapeHtml(match.away?.name || 'Гости')}</span></div>
      ${enriched.map(e => `<div class="timeline-row ${escapeHtml(e.side || 'neutral')} ${String(e.type).toLowerCase()==='goal'?'goal':''}">
        <div class="timeline-home">${e.side==='home' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(publicText(e.label || ''))}</span>` : ''}</div>
        <div class="timeline-minute"><b>${minuteLabel(e)}</b>${e.goalScore ? `<em>${e.goalScore}</em>` : ''}</div>
        <div class="timeline-away">${e.side==='away' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(publicText(e.label || ''))}</span>` : ''}</div>
      </div>`).join('')}
    </div>`;
  }
  
  function centerPlayersHtml(leaders, match) {
    const side = (title, teamSide, list = []) => `<div class="center-player-team"><h3>${escapeHtml(title)}</h3>${list.length ? list.map((p,i)=>`
      <button class="center-player-row center-player-open" type="button" data-center-player="${Number(p.id || 0)}" data-center-player-side="${escapeHtml(teamSide)}" aria-label="Открыть профиль игрока ${escapeHtml(p.name || 'Игрок')}">
        <div class="center-player-rank">${i+1}</div>
        ${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span class="center-player-avatar">👤</span>'}
        <div class="center-player-info"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(playerMetricText(p))}</small></div>
        <div class="center-player-rating">${p.rating ? p.rating.toFixed(1) : '—'}</div>
        <span class="center-player-chevron" aria-hidden="true">›</span>
      </button>`).join('') : '<div class="empty compact-empty">Статистика игроков недоступна.</div>'}</div>`;
    return `<div class="center-players-grid">${side(match.home?.name || 'Хозяева', 'home', leaders?.home || [])}${side(match.away?.name || 'Гости', 'away', leaders?.away || [])}</div>`;
  }

  return {
    minuteLabel,
    liveEventsHtml,
    lineupPlayerName,
    lineupPlayerNumber,
    lineupPlayerGrid,
    shortPlayerName,
    lineupPitchHtml,
    lineupQualityLabel,
    lineupTeamHtml,
    lineupLiveHtml,
    requestMatchCenter,
    startLiveRefresh,
    signedPp,
    oddsMovementHtml,
    playerMetricText,
    absenceKindLabel,
    absenceStatusLabel,
    liveAbsencesHtml,
    centerStatNumber,
    centerStatRow,
    centerCompareRow,
    centerKeyStatsHtml,
    availabilityQualityHintHtml,
    xgQualityHintHtml,
    eventQualityHintHtml,
    statisticsQualityHintHtml,
    oddsQualityHintHtml,
    centerAllStatsHtml,
    timelineEventsHtml,
    centerPlayersHtml,
  };
}
