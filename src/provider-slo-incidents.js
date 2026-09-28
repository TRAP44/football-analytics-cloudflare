const ACTIONABLE_STATES = new Set(['healthy','watch','incident']);

function asIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function severityRank(state = '') {
  return ({ healthy:0, watch:1, incident:2 })[String(state)] ?? -1;
}

function normalizeWindow(row = {}) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : row;
  const endedAt = asIso(meta?.windowEndedAt || row?.created_at);
  const startedAt = asIso(meta?.windowStartedAt || row?.created_at);
  const state = String(meta?.sloState || '').trim();
  const totals = meta?.totals && typeof meta.totals === 'object' ? meta.totals : {};
  return {
    startedAt,
    endedAt,
    state,
    totals: {
      requests: finite(totals.requests),
      successes: finite(totals.successes),
      failures: finite(totals.failures),
      retries: finite(totals.retries),
      successRatePct: Number.isFinite(Number(totals.successRatePct)) ? Number(totals.successRatePct) : null,
      timeoutRatePct: Number.isFinite(Number(totals.timeoutRatePct)) ? Number(totals.timeoutRatePct) : null,
      rateLimitRatePct: Number.isFinite(Number(totals.rateLimitRatePct)) ? Number(totals.rateLimitRatePct) : null,
      retryRatePct: Number.isFinite(Number(totals.retryRatePct)) ? Number(totals.retryRatePct) : null,
      avgAttemptLatencyMs: Number.isFinite(Number(totals.avgAttemptLatencyMs)) ? Number(totals.avgAttemptLatencyMs) : null,
    },
  };
}

function transitionKind(previousState, state) {
  if ((!previousState || previousState === 'healthy') && ['watch','incident'].includes(state)) return 'opened';
  if (['watch','incident'].includes(previousState) && state === 'healthy') return 'recovered';
  if (previousState === 'watch' && state === 'incident') return 'escalated';
  if (previousState === 'incident' && state === 'watch') return 'deescalated';
  return 'changed';
}

function buildRunbook(metrics = {}) {
  const steps = [];
  if (Number(metrics.rateLimitRatePct || 0) > 2) {
    steps.push('Проверить Retry-After, shared quota/cooldown и остаток лимита источника; не увеличивать частоту запросов до нормализации.');
  }
  if (Number(metrics.timeoutRatePct || 0) > 2) {
    steps.push('Проверить доступность upstream и сетевую задержку; убедиться, что bounded retry остаётся ограниченным одной повторной попыткой.');
  }
  if (Number(metrics.retryRatePct || 0) > 10) {
    steps.push('Сопоставить рост retry с конкретными provider/operation и проверить, нет ли повторяющейся transient-деградации.');
  }
  if (Number(metrics.avgAttemptLatencyMs || 0) > 2500) {
    steps.push('Проверить latency по provider/operation и не расширять нагрузку, пока задержка не вернётся в целевой диапазон.');
  }
  if (metrics.successRatePct !== null && Number(metrics.successRatePct) < 98) {
    steps.push('Открыть provider/operation breakdown и определить источник финальных ошибок до изменения traffic policy.');
  }
  if (!steps.length) {
    steps.push('Проверить последние provider SLO окна и breakdown по provider/operation; автоматические rollback и отключение функций не выполняются.');
  }
  return steps.slice(0, 5);
}

export function buildProviderSloIncidentTimeline(rows = [], { nowMs = Date.now() } = {}) {
  const windows = (rows || [])
    .map(normalizeWindow)
    .filter(x => x.endedAt)
    .sort((a,b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));

  const transitions = [];
  let confirmedState = '';

  for (let i = 1; i < windows.length; i += 1) {
    const previous = windows[i - 1];
    const current = windows[i];
    if (!ACTIONABLE_STATES.has(previous.state) || current.state !== previous.state) continue;
    const nextState = current.state;
    if (nextState === confirmedState) continue;

    const transition = {
      state: nextState,
      previousState: confirmedState || null,
      kind: transitionKind(confirmedState, nextState),
      at: current.endedAt,
      confirmedBy: [previous.endedAt, current.endedAt],
      metrics: current.totals,
    };
    transitions.push(transition);
    confirmedState = nextState;
  }

  const episodes = [];
  let active = null;

  for (const transition of transitions) {
    if (['watch','incident'].includes(transition.state)) {
      if (!active) {
        active = {
          startedAt: transition.at,
          initialState: transition.state,
          state: transition.state,
          highestState: transition.state,
          latestAt: transition.at,
          recoveredAt: null,
          active: true,
          transitions: [transition],
          metrics: transition.metrics,
        };
        episodes.push(active);
      } else {
        active.state = transition.state;
        active.latestAt = transition.at;
        active.metrics = transition.metrics;
        active.transitions.push(transition);
        if (severityRank(transition.state) > severityRank(active.highestState)) active.highestState = transition.state;
      }
      continue;
    }

    if (transition.state === 'healthy' && active) {
      active.state = 'recovered';
      active.latestAt = transition.at;
      active.recoveredAt = transition.at;
      active.active = false;
      active.metrics = transition.metrics;
      active.transitions.push(transition);
      active = null;
    }
  }

  const now = Number(nowMs || Date.now());
  for (const episode of episodes) {
    const start = Date.parse(episode.startedAt || '');
    const end = Date.parse(episode.recoveredAt || '');
    const effectiveEnd = Number.isFinite(end) ? end : now;
    episode.durationMinutes = Number.isFinite(start)
      ? Math.max(0, Math.round(((effectiveEnd - start) / 60_000) * 10) / 10)
      : null;
    episode.runbook = buildRunbook(episode.metrics);
  }

  const latestWindow = windows.at(-1) || null;
  const latestTransition = transitions.at(-1) || null;
  const transitionIsFresh = Boolean(
    latestWindow
    && latestTransition
    && latestTransition.at === latestWindow.endedAt
    && (
      ['watch','incident'].includes(latestTransition.state)
      || (latestTransition.state === 'healthy' && ['watch','incident'].includes(String(latestTransition.previousState || '')))
    )
  );

  const currentEpisode = [...episodes].reverse().find(x => x.active) || null;
  const currentState = currentEpisode?.state || (confirmedState === 'healthy' ? 'healthy' : confirmedState || 'collecting');

  return {
    visibility:'admin',
    state: currentState,
    label: currentState === 'incident'
      ? 'Активный provider SLO инцидент'
      : currentState === 'watch'
        ? 'Provider SLO требует контроля'
        : currentState === 'healthy'
          ? 'Provider SLO восстановлен'
          : 'Собираем подтверждение SLO',
    confirmationWindows: 2,
    windowsObserved: windows.length,
    activeIncident: currentEpisode,
    transition: transitionIsFresh ? latestTransition : null,
    history: episodes.slice(-10).reverse(),
    summary: {
      episodes: episodes.length,
      active: episodes.filter(x => x.active).length,
      recovered: episodes.filter(x => !x.active).length,
      incidentEpisodes: episodes.filter(x => x.highestState === 'incident').length,
    },
    policy: {
      automaticRollback: false,
      automaticFeatureDisable: false,
      notificationChannel: 'ops_events_and_admin',
      note: 'Переход фиксируется только после двух последовательных одинаковых SLO-окон. collecting не создаёт инцидент.',
    },
  };
}

export function providerSloIncidentOpsEvent(transition = {}) {
  const state = String(transition?.state || '');
  const previousState = String(transition?.previousState || '');
  const recovered = state === 'healthy' && ['watch','incident'].includes(previousState);
  if (!['watch','incident'].includes(state) && !recovered) return null;

  const code = recovered
    ? 'PROVIDER_SLO_RECOVERED'
    : state === 'incident'
      ? 'PROVIDER_SLO_INCIDENT'
      : 'PROVIDER_SLO_WATCH';
  const severity = recovered ? 'info' : state === 'incident' ? 'error' : 'warning';

  return {
    severity,
    source:'provider',
    eventType:'slo_incident',
    code,
    message: recovered
      ? 'Provider SLO returned to healthy state after confirmed recovery.'
      : state === 'incident'
        ? 'Provider SLO entered confirmed incident state.'
        : 'Provider SLO entered confirmed watch state.',
    endpoint:'cron:production-monitor',
    meta:{
      state: recovered ? 'recovered' : state,
      previousState: previousState || null,
      transitionKind: String(transition.kind || ''),
      confirmedBy: Array.isArray(transition.confirmedBy) ? transition.confirmedBy.slice(0,2) : [],
      metrics: transition.metrics || {},
      automaticRollback:false,
      automaticFeatureDisable:false,
    },
  };
}
