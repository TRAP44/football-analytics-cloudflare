const IMPORTANT_EVENT_RE = /(goal|card|red|subst|var|penalty)/i;
const TRUSTED_PROVENANCE = 'verified';

function objectValue(value) {
  return value && typeof value==='object' && !Array.isArray(value)
    ? value
    : null;
}

function finiteNumber(value,{
  allowPercent=false,
  min=-Infinity,
  max=Infinity,
}={}) {
  let number=null;
  if (typeof value==='number') {
    number=Number.isFinite(value) ? value : null;
  } else if (typeof value==='string') {
    let raw=value.trim();
    if (!raw) return null;
    if (allowPercent && raw.endsWith('%')) raw=raw.slice(0,-1).trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) return null;
    number=Number(raw.replace(',','.'));
  }
  return number!==null
    && Number.isFinite(number)
    && number>=min
    && number<=max
      ? number
      : null;
}

function integer(value,min,max) {
  const number=finiteNumber(value,{min,max});
  return number!==null && Number.isSafeInteger(number)
    ? number
    : null;
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

function safeText(value,max=160) {
  return typeof value==='string'
    ? value
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/gu,' ')
      .trim()
      .slice(0,max)
    : '';
}

function normalizeKey(value) {
  return safeText(value,120)
    .toLowerCase()
    .replace(/[_-]+/g,' ')
    .replace(/\s+/g,' ');
}

function statRow(statistics, aliases) {
  const items=Array.isArray(statistics?.items)
    ? statistics.items.slice(0,200)
    : [];
  const keys=aliases.map(normalizeKey).filter(Boolean);
  return items.find(row => {
    const value=objectValue(row);
    if (!value) return false;
    const key=normalizeKey(value.key);
    const label=normalizeKey(value.label);
    return keys.includes(key) || keys.includes(label);
  }) || null;
}

function metricPair(row,{
  allowPercent=false,
  min=0,
  max=1000,
  requireBoth=false,
}={}) {
  const value=objectValue(row);
  if (!value) return null;
  const home=finiteNumber(value.home,{allowPercent,min,max});
  const away=finiteNumber(value.away,{allowPercent,min,max});
  if (requireBoth && (home===null || away===null)) return null;
  if (home===null && away===null) return null;
  return {home,away};
}

function formattedPair(pair, digits = 0, suffix = '') {
  const format = value => {
    if (value === null) return '—';
    const shown = digits > 0
      ? Number(value).toFixed(digits)
      : String(Math.round(Number(value)));
    return shown + suffix;
  };
  return `${format(pair.home)} : ${format(pair.away)}`;
}

function trustedFeature(payload,key,availabilityKey=key) {
  const availability=objectValue(payload?.availability);
  const freshness=objectValue(payload?.dataFreshness);
  const meta=objectValue(freshness?.[key]);
  return Boolean(
    availability?.[availabilityKey]===true
    && meta?.confidenceBearing===true
    && meta?.stale!==true
    && safeText(meta?.provenanceState,40).toLowerCase()===TRUSTED_PROVENANCE
  );
}

function normalizePressure(livePressure) {
  const value=objectValue(livePressure);
  if (!value) return null;
  const home=finiteNumber(value.home,{min:0,max:100});
  const away=finiteNumber(value.away,{min:0,max:100});
  if (home===null || away===null) return null;
  if (Math.abs(home+away-100)>2) return null;

  const total=home+away;
  if (total<=0) return null;
  const homeWidth=(home/total)*100;
  const awayWidth=100-homeWidth;
  const delta=home-away;
  const leader=Math.abs(delta)<1 ? 'equal' : delta>0 ? 'home' : 'away';

  return {
    home:Math.round(home),
    away:Math.round(away),
    homeWidth,
    awayWidth,
    leader,
  };
}

function eventTime(event) {
  const value=objectValue(event);
  if (!value) return null;
  const nested=objectValue(value.time);
  const minute=integer(
    nested?.elapsed ?? value.elapsed ?? value.minute,
    0,
    180,
  );
  const extra=integer(
    nested?.extra ?? value.extra ?? 0,
    0,
    30,
  );
  if (minute===null || extra===null) return null;
  return {
    minute,
    extra,
    effective:minute+extra,
  };
}

function eventMinute(event) {
  const time=eventTime(event);
  if (!time) return '';
  return time.extra>0
    ? `${time.minute}+${time.extra}′`
    : `${time.minute}′`;
}

function eventKind(event) {
  const value=objectValue(event) || {};
  const haystack=`${safeText(value.type,80)} ${safeText(value.detail,160)} ${safeText(value.label,160)}`.toLowerCase();
  if (haystack.includes('goal')) return { icon:'⚽', label:'Гол' };
  if (haystack.includes('red')) return { icon:'🟥', label:'Красная карточка' };
  if (haystack.includes('card')) return { icon:'🟨', label:'Карточка' };
  if (haystack.includes('penalty')) return { icon:'●', label:'Пенальти' };
  if (haystack.includes('var')) return { icon:'◫', label:'VAR' };
  if (haystack.includes('subst')) return { icon:'↔', label:'Замена' };
  return {
    icon:'•',
    label:safeText(value.label || value.detail || value.type,160) || 'Событие',
  };
}

function importantEvents(events = [], match = {}) {
  const source=Array.isArray(events) ? events.slice(0,1000) : [];
  return source
    .map((event,index)=>{
      const value=objectValue(event);
      const time=eventTime(value);
      if (!value || !time) return null;
      const haystack=`${safeText(value.type,80)} ${safeText(value.detail,160)} ${safeText(value.label,160)}`;
      if (!IMPORTANT_EVENT_RE.test(haystack)) return null;
      const kind=eventKind(value);
      const team=safeText(value.teamName,120)
        || (value.side==='home'
          ? safeText(match?.home?.name,120)
          : value.side==='away'
            ? safeText(match?.away?.name,120)
            : '');
      return {
        effective:time.effective,
        index,
        minute:eventMinute(value),
        icon:kind.icon,
        label:kind.label,
        team,
        player:safeText(value.player,120),
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.effective-b.effective || a.index-b.index);
}

function strongestOddsMovement(oddsMovement, match = {}) {
  const source=objectValue(oddsMovement);
  const movement=objectValue(source?.probabilityChange);
  const sample=integer(source?.sample,2,100000);
  if (!movement || sample===null) return null;

  const rows=['home','draw','away'].map(key=>({
    key,
    value:finiteNumber(movement[key],{min:-100,max:100}),
  }));
  if (rows.some(row=>row.value===null)) return null;
  if (Math.abs(rows.reduce((sum,row)=>sum+row.value,0))>1) return null;

  const strongest=rows.sort(
    (a,b)=>Math.abs(b.value)-Math.abs(a.value),
  )[0];
  if (!strongest || Math.abs(strongest.value)<0.5) return null;
  const labels={
    home:safeText(match?.home?.name,120) || 'П1',
    draw:'Ничья',
    away:safeText(match?.away?.name,120) || 'П2',
  };
  return {
    label:'Рынок',
    text:`${labels[strongest.key]}: ${strongest.value>0?'+':''}${strongest.value.toFixed(1)} п.п.`,
  };
}

function firstSmartInsight(smartInsights) {
  const source=objectValue(smartInsights);
  if (source?.available!==true) return null;
  const first=Array.isArray(source.insights)
    ? objectValue(source.insights[0])
    : null;
  const headline=safeText(first?.title || source.headline,220);
  if (!headline) return null;
  return {label:'Инсайт',text:headline};
}

function modeFromPayload(payload, match) {
  const base=safeText(payload?.mode,24).toLowerCase();
  const status=safeText(
    match?.statusShort || match?.status || match?.statusLabel,
    80,
  ).toLowerCase();
  if (
    base==='live'
    && (/\bht\b/.test(status) || status.includes('half') || status.includes('перерыв'))
  ) return 'halftime';
  if (['upcoming','live','halftime','finished'].includes(base)) return base;
  return base || 'unknown';
}

function modeLabel(mode) {
  return ({
    upcoming:'ДО МАТЧА',
    live:'LIVE',
    halftime:'ПЕРЕРЫВ',
    finished:'ФИНАЛ',
  })[mode] || 'МАТЧ';
}

function qualityFlags(payload,{rawXg=false}={}) {
  const flags=[];
  if (payload?.stale===true) flags.push('Сохранённый снимок');
  if (payload?.availability?.limitedCoverage===true) {
    flags.push('Ограниченное покрытие');
  }
  const statsState=safeText(payload?.statisticsQuality?.state,40).toLowerCase();
  if (statsState && !['verified','sanitized'].includes(statsState)) {
    flags.push('Частичная статистика');
  }
  if (
    rawXg
    && objectValue(payload?.xgQuality)
    && payload.xgQuality.confidenceBearing!==true
  ) {
    flags.push('xG частичный');
  }
  return [...new Set(flags)].slice(0,2);
}

export function deriveMatchPulse(payload = {}) {
  const source=objectValue(payload) || {};
  const match=objectValue(source.match) || {};
  const homeName=safeText(match?.home?.name,120) || 'Хозяева';
  const awayName=safeText(match?.away?.name,120) || 'Гости';
  const mode=modeFromPayload(source,match);

  const statisticsTrusted=trustedFeature(source,'statistics');
  const eventsTrusted=trustedFeature(source,'events');
  const oddsTrusted=trustedFeature(source,'liveOdds');

  const pressure=statisticsTrusted
    ? normalizePressure(source.livePressure)
    : null;

  const rawXgRow=statRow(source.statistics,[
    'expected_goals',
    'expected goals',
    'xg',
  ]);
  const xgTrusted=statisticsTrusted
    && source?.availability?.xg===true
    && source?.xgQuality?.confidenceBearing===true;
  const xg=xgTrusted
    ? metricPair(rawXgRow,{min:0,max:30,requireBoth:true})
    : null;
  const shotsOn=statisticsTrusted
    ? metricPair(
        statRow(source.statistics,[
          'shots on goal',
          'shots on target',
          'shots on',
        ]),
        {min:0,max:200},
      )
    : null;
  const possession=statisticsTrusted
    ? metricPair(
        statRow(source.statistics,[
          'ball possession',
          'possession',
        ]),
        {allowPercent:true,min:0,max:100},
      )
    : null;

  const metrics=[];
  if (xg) metrics.push({
    key:'xg',
    label:'xG',
    value:formattedPair(xg,2),
  });
  if (shotsOn) metrics.push({
    key:'shots-on',
    label:'В створ',
    value:formattedPair(shotsOn),
  });
  if (possession) metrics.push({
    key:'possession',
    label:'Владение',
    value:formattedPair(possession,0,'%'),
  });

  const events=eventsTrusted
    ? importantEvents(source.events,match)
    : [];
  const latest=events.at(-1) || null;
  let change=latest
    ? {
        label:'Последнее событие',
        text:[
          latest.minute,
          latest.label,
          latest.team,
          latest.player,
        ].filter(Boolean).join(' · '),
      }
    : oddsTrusted
      ? strongestOddsMovement(source.oddsMovement,match)
      : null;

  const insightsTrusted=source.stale!==true
    && (statisticsTrusted || eventsTrusted);
  if (!change && insightsTrusted) {
    change=firstSmartInsight(source.smartInsights);
  }

  const timeline=events.slice(-3);
  const flags=qualityFlags(source,{rawXg:Boolean(rawXgRow)});
  const hasData=Boolean(
    pressure
    || metrics.length
    || change
    || timeline.length
  );
  if (!hasData) return null;

  let leaderText='';
  if (pressure) {
    if (pressure.leader==='equal') {
      leaderText='Баланс по индексу давления';
    } else {
      const leaderName=pressure.leader==='home'
        ? homeName
        : awayName;
      leaderText=`Преимущество по индексу давления: ${leaderName}`;
    }
  } else if (mode==='finished') {
    leaderText='Итоговая картина по подтверждённым данным';
  } else if (mode==='upcoming') {
    leaderText='Предматчевая картина по подтверждённым данным';
  } else {
    leaderText='Картина по подтверждённым данным';
  }

  const ariaParts=['Match Pulse.',leaderText+'.'];
  if (pressure) {
    ariaParts.push(
      `Давление: ${homeName} ${pressure.home}, ${awayName} ${pressure.away}.`,
    );
  }
  for (const metric of metrics) {
    ariaParts.push(`${metric.label}: ${metric.value}.`);
  }
  if (change) ariaParts.push(`${change.label}: ${change.text}.`);
  if (flags.length) ariaParts.push(flags.join('. ')+'.');

  return {
    mode,
    modeLabel:modeLabel(mode),
    homeName,
    awayName,
    pressure,
    metrics,
    change,
    timeline,
    flags,
    leaderText,
    ariaLabel:ariaParts.join(' '),
  };
}

export function renderMatchPulse(payload = {}) {
  const pulse = deriveMatchPulse(payload);
  if (!pulse) return '';

  const gap = pulse.pressure ? Math.abs(pulse.pressure.home - pulse.pressure.away) : null;
  const pressureStrength = gap === null ? '' : gap < 8 ? 'balanced' : gap < 20 ? 'moderate' : 'strong';
  // This is a single verified statistics snapshot, not pressure history.
  const pressureDeltaHtml = pulse.pressure && pulse.mode === 'live'
    ? '<div class="match-pulse-pressure-context">'
      + '<strong>Разница индекса: ' + gap + '</strong>'
      + '<span>' + (pressureStrength === 'balanced'
        ? 'Баланс по текущим данным'
        : pressureStrength === 'moderate'
          ? 'Умеренное преимущество по текущим данным'
          : 'Заметное преимущество по текущим данным')
      + '</span><small>Один текущий срез подтверждённой статистики — не история давления по минутам.</small>'
      + '</div>'
    : '';
  const pressureHtml = pulse.pressure ? `
    <div class="match-pulse-pressure" data-pressure-strength="${pressureStrength}">
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
      ${pressureDeltaHtml}
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
