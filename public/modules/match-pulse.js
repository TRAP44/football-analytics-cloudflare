const IMPORTANT_EVENT_RE = /(goal|card|red|subst|var|penalty)/i;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replaceAll('%', '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function statRow(statistics, aliases) {
  const keys = aliases.map(normalizeKey);
  return (statistics?.items || []).find(row => {
    const key = normalizeKey(row?.key);
    const label = normalizeKey(row?.label);
    return keys.includes(key) || keys.includes(label);
  }) || null;
}

function metricPair(row) {
  if (!row) return null;
  const home = finiteNumber(row.home);
  const away = finiteNumber(row.away);
  if (home === null && away === null) return null;
  return { home, away };
}

function formattedPair(pair, digits = 0, suffix = '') {
  const format = value => {
    if (value === null) return '—';
    const shown = digits > 0 ? Number(value).toFixed(digits) : String(Math.round(Number(value)));
    return shown + suffix;
  };
  return `${format(pair.home)} : ${format(pair.away)}`;
}

function normalizePressure(livePressure) {
  if (!livePressure) return null;
  let home = finiteNumber(livePressure.home);
  let away = finiteNumber(livePressure.away);
  if (home === null && away === null) return null;

  if (home === null && away !== null && away >= 0 && away <= 100) home = 100 - away;
  if (away === null && home !== null && home >= 0 && home <= 100) away = 100 - home;
  if (home === null || away === null) return null;

  home = clamp(home, 0, 100);
  away = clamp(away, 0, 100);
  const total = home + away;
  const homeWidth = total > 0 ? clamp((home / total) * 100, 0, 100) : 50;
  const awayWidth = 100 - homeWidth;
  const delta = home - away;
  const leader = Math.abs(delta) < 1 ? 'equal' : delta > 0 ? 'home' : 'away';

  return {
    home: Math.round(home),
    away: Math.round(away),
    homeWidth,
    awayWidth,
    leader,
  };
}

function eventMinute(event) {
  const minute = finiteNumber(event?.time?.elapsed ?? event?.elapsed ?? event?.minute);
  if (minute === null) return '';
  const extra = finiteNumber(event?.time?.extra ?? event?.extra);
  return extra && extra > 0 ? `${Math.round(minute)}+${Math.round(extra)}′` : `${Math.round(minute)}′`;
}

function eventKind(event) {
  const haystack = `${event?.type || ''} ${event?.detail || ''} ${event?.label || ''}`.toLowerCase();
  if (haystack.includes('goal')) return { icon: '⚽', label: 'Гол' };
  if (haystack.includes('red')) return { icon: '🟥', label: 'Красная карточка' };
  if (haystack.includes('card')) return { icon: '🟨', label: 'Карточка' };
  if (haystack.includes('penalty')) return { icon: '●', label: 'Пенальти' };
  if (haystack.includes('var')) return { icon: '◫', label: 'VAR' };
  if (haystack.includes('subst')) return { icon: '↔', label: 'Замена' };
  return { icon: '•', label: String(event?.label || event?.detail || event?.type || 'Событие') };
}

function importantEvents(events = [], match = {}) {
  return events
    .filter(event => IMPORTANT_EVENT_RE.test(`${event?.type || ''} ${event?.detail || ''} ${event?.label || ''}`))
    .map(event => {
      const kind = eventKind(event);
      const team = event?.teamName
        || (event?.side === 'home' ? match.home?.name : event?.side === 'away' ? match.away?.name : '');
      return {
        minute: eventMinute(event),
        icon: kind.icon,
        label: kind.label,
        team: String(team || ''),
        player: String(event?.player || ''),
      };
    });
}

function strongestOddsMovement(oddsMovement, match = {}) {
  const movement = oddsMovement?.probabilityChange;
  if (!movement || typeof movement !== 'object') return null;
  const labels = {
    home: match.home?.name || 'П1',
    draw: 'Ничья',
    away: match.away?.name || 'П2',
  };
  const strongest = Object.entries(movement)
    .map(([key, value]) => ({ key, value: finiteNumber(value) }))
    .filter(row => row.value !== null)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  if (!strongest || Math.abs(strongest.value) < 0.5) return null;
  const sign = strongest.value > 0 ? '+' : '';
  return {
    label: 'Рынок',
    text: `${labels[strongest.key] || strongest.key}: ${sign}${strongest.value.toFixed(1)} п.п.`,
  };
}

function firstSmartInsight(smartInsights) {
  if (!smartInsights?.available) return null;
  const first = Array.isArray(smartInsights.insights) ? smartInsights.insights[0] : null;
  const headline = String(first?.title || smartInsights.headline || '').trim();
  if (!headline) return null;
  return {
    label: 'Инсайт',
    text: headline,
  };
}

function modeFromPayload(payload, match) {
  const base = String(payload?.mode || '').toLowerCase();
  const status = String(match?.statusShort || match?.status || match?.statusLabel || '').toLowerCase();
  if (base === 'live' && (/\bht\b/.test(status) || status.includes('half') || status.includes('перерыв'))) return 'halftime';
  if (['upcoming', 'live', 'halftime', 'finished'].includes(base)) return base;
  return base || 'unknown';
}

function modeLabel(mode) {
  return ({
    upcoming: 'ДО МАТЧА',
    live: 'LIVE',
    halftime: 'ПЕРЕРЫВ',
    finished: 'ФИНАЛ',
  })[mode] || 'МАТЧ';
}

function qualityFlags(payload, hasXg) {
  const flags = [];
  if (payload?.stale) flags.push('Сохранённый снимок');
  if (payload?.availability?.limitedCoverage) flags.push('Ограниченное покрытие');
  const statsState = String(payload?.statisticsQuality?.state || '').toLowerCase();
  if (statsState && !['verified', 'sanitized'].includes(statsState)) flags.push('Частичная статистика');
  if (hasXg && payload?.xgQuality && payload.xgQuality.confidenceBearing === false) flags.push('xG частичный');
  return [...new Set(flags)].slice(0, 2);
}

export function deriveMatchPulse(payload = {}) {
  const match = payload.match || {};
  const homeName = String(match.home?.name || 'Хозяева');
  const awayName = String(match.away?.name || 'Гости');
  const mode = modeFromPayload(payload, match);
  const pressure = normalizePressure(payload.livePressure);

  const xg = metricPair(statRow(payload.statistics, ['expected_goals', 'expected goals', 'xg']));
  const shotsOn = metricPair(statRow(payload.statistics, ['shots on goal', 'shots on target', 'shots on']));
  const possession = metricPair(statRow(payload.statistics, ['ball possession', 'possession']));

  const metrics = [];
  if (xg) metrics.push({ key: 'xg', label: 'xG', value: formattedPair(xg, 2) });
  if (shotsOn) metrics.push({ key: 'shots-on', label: 'В створ', value: formattedPair(shotsOn) });
  if (possession) metrics.push({ key: 'possession', label: 'Владение', value: formattedPair(possession, 0, '%') });

  const events = importantEvents(Array.isArray(payload.events) ? payload.events : [], match);
  const latest = events.at(-1) || null;
  let change = latest
    ? {
        label: 'Последнее событие',
        text: [latest.minute, latest.label, latest.team, latest.player].filter(Boolean).join(' · '),
      }
    : strongestOddsMovement(payload.oddsMovement, match);
  if (!change) change = firstSmartInsight(payload.smartInsights);

  const timeline = events.slice(-3);
  const flags = qualityFlags(payload, Boolean(xg));
  const hasData = Boolean(pressure || metrics.length || change || timeline.length);
  if (!hasData) return null;

  let leaderText = '';
  if (pressure) {
    if (pressure.leader === 'equal') leaderText = 'Баланс по индексу давления';
    else {
      const leaderName = pressure.leader === 'home' ? homeName : awayName;
      leaderText = `Преимущество по индексу давления: ${leaderName}`;
    }
  } else if (mode === 'finished') {
    leaderText = 'Итоговая картина по доступным данным';
  } else if (mode === 'upcoming') {
    leaderText = 'Предматчевая картина по доступным данным';
  } else {
    leaderText = 'Картина по доступным данным';
  }

  const ariaParts = ['Match Pulse.', leaderText + '.'];
  if (pressure) ariaParts.push(`Давление: ${homeName} ${pressure.home}, ${awayName} ${pressure.away}.`);
  for (const metric of metrics) ariaParts.push(`${metric.label}: ${metric.value}.`);
  if (change) ariaParts.push(`${change.label}: ${change.text}.`);
  if (flags.length) ariaParts.push(flags.join('. ') + '.');

  return {
    mode,
    modeLabel: modeLabel(mode),
    homeName,
    awayName,
    pressure,
    metrics,
    change,
    timeline,
    flags,
    leaderText,
    ariaLabel: ariaParts.join(' '),
  };
}

export function renderMatchPulse(payload = {}) {
  const pulse = deriveMatchPulse(payload);
  if (!pulse) return '';

  const pressureHtml = pulse.pressure ? `
    <div class="match-pulse-pressure">
      <div class="match-pulse-teams">
        <strong class="match-pulse-team home" title="${escapeHtml(pulse.homeName)}">${escapeHtml(pulse.homeName)}</strong>
        <span>давление</span>
        <strong class="match-pulse-team away" title="${escapeHtml(pulse.awayName)}">${escapeHtml(pulse.awayName)}</strong>
      </div>
      <div class="match-pulse-track" aria-hidden="true">
        <i style="width:${pulse.pressure.homeWidth.toFixed(2)}%"></i>
        <b style="width:${pulse.pressure.awayWidth.toFixed(2)}%"></b>
      </div>
      <div class="match-pulse-pressure-values">
        <strong>${pulse.pressure.home}</strong>
        <span>${escapeHtml(pulse.leaderText)}</span>
        <strong>${pulse.pressure.away}</strong>
      </div>
    </div>` : `
    <p class="match-pulse-summary">${escapeHtml(pulse.leaderText)}</p>`;

  const metricsHtml = pulse.metrics.length ? `
    <div class="match-pulse-metrics">
      ${pulse.metrics.map(metric => `<div data-pulse-metric="${escapeHtml(metric.key)}"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join('')}
    </div>` : '';

  const changeHtml = pulse.change ? `
    <div class="match-pulse-change">
      <span>${escapeHtml(pulse.change.label)}</span>
      <strong>${escapeHtml(pulse.change.text)}</strong>
    </div>` : '';

  const timelineHtml = pulse.timeline.length > 1 ? `
    <div class="match-pulse-timeline" aria-label="Последние важные события">
      ${pulse.timeline.map(event => `<div><span>${escapeHtml(event.minute || '—')}</span><b>${escapeHtml(event.icon)}</b><small>${escapeHtml(event.label)}</small></div>`).join('')}
    </div>` : '';

  const flagsHtml = pulse.flags.length ? `
    <div class="match-pulse-flags">${pulse.flags.map(flag => `<span>${escapeHtml(flag)}</span>`).join('')}</div>` : '';

  return `<section class="panel match-pulse ${pulse.flags.includes('Сохранённый снимок') ? 'is-stale' : ''}" data-match-pulse-mode="${escapeHtml(pulse.mode)}" aria-label="${escapeHtml(pulse.ariaLabel)}">
    <div class="match-pulse-head">
      <span>⚡ MATCH PULSE</span>
      <b>${escapeHtml(pulse.modeLabel)}</b>
    </div>
    ${pressureHtml}
    ${metricsHtml}
    ${changeHtml}
    ${timelineHtml}
    ${flagsHtml}
  </section>`;
}
