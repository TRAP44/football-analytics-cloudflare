const ALERTABLE_CODES = new Set([
  'DAILY_DIGEST_BACKLOG_LATE',
  'DAILY_DIGEST_SEALED_CLAIMS',
]);

const HEALTHY_CODES = new Set([
  'DAILY_DIGEST_RUN_OK',
  'DAILY_DIGEST_RUN_EMPTY',
  'DAILY_DIGEST_CLAIMS_RECOVERED',
]);

function finiteNumberCandidate(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}

function trustedTimestampMs(value) {
  if (value instanceof Date) {
    const ms=value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw=value.trim();
  const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(raw);
  if (!calendar) return null;
  const year=Number(calendar[1]);
  const month=Number(calendar[2]);
  const day=Number(calendar[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const ms=Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function iso(value) {
  const ms=trustedTimestampMs(value);
  return ms === null ? '' : new Date(ms).toISOString();
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonNegativeCount(value) {
  const number=finiteNumberCandidate(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function nonNegativeNumber(value) {
  const number=finiteNumberCandidate(value);
  return number !== null && number >= 0 ? number : 0;
}

function boundedRate(value) {
  const number=finiteNumberCandidate(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function normalizedNowMs(value) {
  const number=finiteNumberCandidate(value);
  return number !== null && number >= 0 && number <= 8.64e15 ? number : Date.now();
}

function normalizedWindowDays(value) {
  const number=finiteNumberCandidate(value);
  return number !== null ? Math.max(1, Math.min(30, Math.floor(number))) : 7;
}

function normalizeEvent(row = {}) {
  const source=String(row?.source || '');
  const eventType=String(row?.event_type || row?.eventType || '');
  return {
    at: iso(row?.created_at || row?.createdAt || row?.at),
    source,
    eventType,
    code: String(row?.code || ''),
    severity: String(row?.severity || ''),
    metadata: objectRecord(row?.metadata),
  };
}

function isDailyDigestEvent(event = {}) {
  return event.source === 'telegram'
    && event.eventType === 'daily_digest'
    && event.code.startsWith('DAILY_DIGEST_');
}

function dateForEvent(event = {}) {
  const atMs=trustedTimestampMs(event?.at);
  if (atMs === null) return '';
  const timestampDate=new Date(atMs).toISOString().slice(0,10);
  const metadataDate=String(event?.metadata?.date || '').trim();
  if (!metadataDate) return timestampDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadataDate)) return '';
  const parsed=Date.parse(`${metadataDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==metadataDate) return '';
  return metadataDate===timestampDate ? timestampDate : '';
}

function incidentId(date = '') {
  return 'digest-' + String(date || 'unknown');
}

function strictNonNegativeInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function incidentEpisode(value) {
  const episode=strictNonNegativeInteger(value);
  return episode !== null && episode >= 1 ? episode : 1;
}

function incidentAlertKey(incident = {}, kind = 'incident') {
  const id=String(incident?.incidentId || '').trim();
  if (!id) return '';
  const base=`${id}:${kind}`;
  const episode=incidentEpisode(incident?.episode);
  return episode > 1 ? `${base}:${episode}` : base;
}

export function buildDailyDigestIncidentReport(rows = [], { nowMs = Date.now() } = {}) {
  const now=normalizedNowMs(nowMs);
  const events = (Array.isArray(rows) ? rows : [])
    .map(normalizeEvent)
    .filter(event => {
      const at=trustedTimestampMs(event.at);
      return at !== null
        && at <= now + 60_000
        && isDailyDigestEvent(event)
        && (ALERTABLE_CODES.has(event.code) || HEALTHY_CODES.has(event.code));
    })
    .sort((a,b) => Date.parse(a.at) - Date.parse(b.at));

  const byDate = new Map();
  for (const event of events) {
    const date = dateForEvent(event);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date,[]);
    byDate.get(date).push(event);
  }

  const history = [];
  for (const [date, list] of byDate.entries()) {
    const episodes=[];
    let current=null;
    let episodeNumber=0;

    for (const event of list) {
      if (ALERTABLE_CODES.has(event.code)) {
        if (!current) {
          episodeNumber+=1;
          current={
            episode:episodeNumber,
            firstAlert:event,
            latestAlert:event,
            recoveredAt:null,
          };
        } else {
          current.latestAlert=event;
        }
        continue;
      }

      if (
        current
        && HEALTHY_CODES.has(event.code)
        && Date.parse(event.at) > Date.parse(current.firstAlert.at)
      ) {
        current.recoveredAt=event.at;
        episodes.push(current);
        current=null;
      }
    }
    if (current) episodes.push(current);

    for (const episodeState of episodes) {
      const firstAlert=episodeState.firstAlert;
      const latestAlert=episodeState.latestAlert;
      const meta=latestAlert.metadata || {};
      const startedAt=firstAlert.at;
      const recoveredAt=episodeState.recoveredAt;
      const endMs=recoveredAt ? Date.parse(recoveredAt) : now;
      const startMs=Date.parse(startedAt);
      const episode=episodeState.episode;
      history.push({
        incidentId:incidentId(date),
        episode,
        date,
        active:!recoveredAt,
        state:recoveredAt ? 'recovered' : 'incident',
        highestState:'incident',
        severity:'warning',
        startedAt,
        latestAt:recoveredAt || latestAlert.at,
        recoveredAt,
        durationMinutes:Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, Math.round(((endMs-startMs)/60000)*10)/10)
          : null,
        fingerprint:episode > 1
          ? `daily_digest|${date}|episode:${episode}`
          : 'daily_digest|' + date,
        diagnostics:{
          code:latestAlert.code,
          remaining:nonNegativeCount(meta.remaining ?? meta.backlog),
          sealedClaims:nonNegativeCount(meta.sealedClaims),
          failed:nonNegativeCount(meta.failed),
          completionRate:boundedRate(meta.completionRate),
          oldestActiveClaimAgeMs:nonNegativeNumber(meta.oldestActiveClaimAgeMs),
        },
      });
    }
  }

  history.sort((a,b) =>
    Date.parse(b.startedAt || '') - Date.parse(a.startedAt || '')
    || Number(b.episode || 0) - Number(a.episode || 0)
  );
  const activeIncident = history.find(item => item.active) || null;
  return {
    state:activeIncident ? 'incident' : history.length ? 'healthy' : 'collecting',
    activeIncident,
    history,
  };
}

function destinationRows(destinations = []) {
  const normalized=[];
  const seenSlots=new Set();
  const seenKeys=new Set();
  for (const [index,item] of (Array.isArray(destinations) ? destinations : []).entries()) {
    const rawSlot=item?.slot;
    const slot=rawSlot === undefined || rawSlot === null || rawSlot === ''
      ? index
      : strictNonNegativeInteger(rawSlot);
    const rawKey=item?.destinationKey ?? item?.destination_key;
    const destinationKey=typeof rawKey === 'string' ? rawKey.trim() : '';
    if (
      slot === null
      || !destinationKey
      || destinationKey.length > 160
      || seenSlots.has(slot)
      || seenKeys.has(destinationKey)
    ) continue;
    seenSlots.add(slot);
    seenKeys.add(destinationKey);
    normalized.push({slot,destinationKey});
  }
  return normalized;
}

function ledgerRowsFor(rows = [], incidentId = '') {
  return (Array.isArray(rows) ? rows : []).filter(row => String(row?.incident_id || row?.incidentId || '') === incidentId);
}

function sentFor(rows = [], alertKey = '', destinationKey = '') {
  return rows.some(row =>
    String(row?.alert_key || row?.alertKey || '') === alertKey
    && String(row?.destination_key || row?.destinationKey || '') === destinationKey
    && String(row?.status || '') === 'sent'
  );
}

export function planDailyDigestIncidentAlert(report = {}, ledgerRows = [], { destinations = [] } = {}) {
  const targets = destinationRows(destinations);
  if (!targets.length) return { action:'none', reason:'no_admin_recipients' };

  const active = report?.activeIncident;
  if (active?.active) {
    const alertKey=incidentAlertKey(active,'incident');
    if (!alertKey) return {action:'none',reason:'invalid_incident'};
    const rows = ledgerRowsFor(ledgerRows,active.incidentId);
    const pending = targets.filter(target => !sentFor(rows,alertKey,target.destinationKey));
    if (!pending.length) return { action:'none', reason:'incident_alert_deduplicated' };
    return {
      action:'send',
      kind:'incident',
      incidentId:active.incidentId,
      incident:active,
      alertKey,
      deliveryKey:alertKey,
      severity:'warning',
      targetDeliveries:pending,
      targetSlots:pending.map(x=>x.slot),
    };
  }

  const recovered = Array.isArray(report?.history)
    ? report.history.find(item => !item.active && item.incidentId)
    : null;
  if (!recovered) return { action:'none', reason:'no_incident' };
  const rows = ledgerRowsFor(ledgerRows,recovered.incidentId);
  const openKey=incidentAlertKey(recovered,'incident');
  const alertKey=incidentAlertKey(recovered,'recovery');
  if (!openKey || !alertKey) return {action:'none',reason:'invalid_incident'};
  const hadOpenAttempt = rows.some(row => String(row?.alert_key || row?.alertKey || '') === openKey);
  if (!hadOpenAttempt) return { action:'none', reason:'recovery_without_prior_incident_alert' };
  const pending = targets.filter(target => !sentFor(rows,alertKey,target.destinationKey));
  if (!pending.length) return { action:'none', reason:'recovery_alert_deduplicated' };
  return {
    action:'send',
    kind:'recovery',
    incidentId:recovered.incidentId,
    incident:recovered,
    alertKey,
    deliveryKey:alertKey,
    severity:'info',
    targetDeliveries:pending,
    targetSlots:pending.map(x=>x.slot),
  };
}

export function formatDailyDigestIncidentAlert(plan = {}) {
  const incident = plan && typeof plan === 'object' && !Array.isArray(plan) ? (plan.incident || {}) : {};
  const d = incident?.diagnostics && typeof incident.diagnostics === 'object' && !Array.isArray(incident.diagnostics)
    ? incident.diagnostics
    : {};
  const duration=finiteNumberCandidate(incident.durationMinutes);
  const completion=boundedRate(d.completionRate);
  const remaining=nonNegativeCount(d.remaining);
  const sealedClaims=nonNegativeCount(d.sealedClaims);
  const failed=nonNegativeCount(d.failed);
  const oldestClaimAgeMs=nonNegativeNumber(d.oldestActiveClaimAgeMs);

  if (plan?.kind === 'recovery') {
    return [
      '✅ Daily Digest recovered',
      '',
      'Дата: ' + String(incident.date || '—'),
      'Incident ID: ' + String(incident.incidentId || '—'),
      'Восстановление: ' + (iso(incident.recoveredAt) || '—'),
      'Длительность: ' + (duration !== null && duration >= 0 ? duration.toFixed(1) + ' мин' : '—'),
      'Backlog очищен, sealed/stuck состояние больше не активно.',
    ].join('\n');
  }

  return [
    '⚠️ Daily Digest operational incident',
    '',
    'Дата: ' + String(incident.date || '—'),
    'Причина: ' + String(d.code || 'digest health threshold'),
    'Осталось получателей: ' + String(remaining),
    'Sealed claims: ' + String(sealedClaims),
    'Failed: ' + String(failed),
    'Completion rate: ' + (completion !== null ? (completion*100).toFixed(1) + '%' : '—'),
    'Oldest claim age: ' + Math.round(oldestClaimAgeMs/1000) + ' сек',
    'Incident ID: ' + String(incident.incidentId || '—'),
    '',
    'Проверь ops_events daily_digest и persistent claims. Автоматический rollback или отключение функций не выполняется.',
  ].join('\n');
}

export function dailyDigestIncidentAlertOpsEvents(plan = {}, delivery = {}) {
  const outcomes = Array.isArray(delivery?.outcomes) ? delivery.outcomes : [];
  const groups = new Map();
  for (const item of outcomes) {
    const state=String(item?.state || 'unknown');
    if (!groups.has(state)) groups.set(state,[]);
    groups.get(state).push(item);
  }
  const out=[];
  for (const [state,items] of groups.entries()) {
    const spec={
      sent:['info',plan.kind==='recovery'?'DAILY_DIGEST_RECOVERY_ALERT_SENT':'DAILY_DIGEST_INCIDENT_ALERT_SENT'],
      duplicate:['info','DAILY_DIGEST_INCIDENT_ALERT_DUPLICATE_SUPPRESSED'],
      retry_pending:['warning','DAILY_DIGEST_INCIDENT_ALERT_RETRY_PENDING'],
      terminal_failed:['warning','DAILY_DIGEST_INCIDENT_ALERT_TERMINAL_FAILED'],
      unknown:['warning','DAILY_DIGEST_INCIDENT_ALERT_UNKNOWN'],
      persistence_failure:['error','DAILY_DIGEST_INCIDENT_ALERT_PERSISTENCE_FAILED'],
    }[state] || ['warning','DAILY_DIGEST_INCIDENT_ALERT_STATE'];
    out.push({
      severity:spec[0],
      source:'digest_alert',
      eventType:'alert_delivery',
      code:spec[1],
      message:'Daily digest operational alert delivery state: ' + state + '.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:plan.incidentId || null,
        alertKind:String(plan.kind || ''),
        deliveryKey:String(plan.alertKey || ''),
        recipientSlots:items
          .map(x=>strictNonNegativeInteger(x?.slot))
          .filter(slot=>slot !== null),
        recipientCount:items.length,
      },
    });
  }
  return out;
}


function digestLedgerSummary(rows = [], incidentId = '') {
  const relevant=ledgerRowsFor(rows,incidentId);
  const states={sending:0,sent:0,retry_pending:0,terminal_failed:0,unknown:0};
  for (const row of relevant) {
    const status=String(row?.status || '').trim();
    if (Object.prototype.hasOwnProperty.call(states,status)) states[status]+=1;
    else states.unknown+=1;
  }
  return {
    rows:relevant.length,
    states,
    operationalAttention:states.retry_pending+states.terminal_failed+states.unknown,
    lastUpdatedAt:relevant.map(row=>iso(row?.updated_at || row?.created_at)).filter(Boolean).sort().at(-1) || null,
  };
}

export function summarizeDailyDigestOperationalStatus(rows = [], ledgerRows = [], { nowMs = Date.now() } = {}) {
  const now=normalizedNowMs(nowMs);
  const events=(Array.isArray(rows) ? rows : [])
    .map(normalizeEvent)
    .filter(event=>{
      const at=trustedTimestampMs(event.at);
      return at !== null && at <= now + 60_000 && isDailyDigestEvent(event);
    })
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const latest=events.at(-1) || null;
  const latestMeta=latest?.metadata || {};
  const report=buildDailyDigestIncidentReport(rows,{nowMs});
  const latestHistory=report.history?.[0] || null;
  const incident=report.activeIncident || latestHistory || null;
  const ledger=digestLedgerSummary(ledgerRows,incident?.incidentId || '');

  const completionRate=boundedRate(latestMeta.completionRate);
  const remaining=nonNegativeCount(latestMeta.remaining ?? latestMeta.backlog);
  const sealedClaims=nonNegativeCount(latestMeta.sealedClaims);
  const failed=nonNegativeCount(latestMeta.failed);
  const rateLimited=nonNegativeCount(latestMeta.rateLimited);
  const truncated=latestMeta.truncated === true;
  const oldestActiveClaimAgeMs=nonNegativeNumber(latestMeta.oldestActiveClaimAgeMs);

  let state='collecting';
  if (report.activeIncident) state='incident';
  else if (latest && ['warning','error','critical'].includes(latest.severity)) state='watch';
  else if (latest) state='healthy';

  return {
    available:Boolean(latest),
    state,
    label:state==='incident'
      ? 'Есть активный инцидент Daily Digest'
      : state==='watch'
        ? 'Daily Digest требует контроля'
        : state==='healthy'
          ? 'Daily Digest работает штатно'
          : 'Нет данных о Daily Digest',
    generatedAt:new Date(now).toISOString(),
    latestRun:latest ? {
      at:latest.at,
      code:latest.code,
      severity:latest.severity || 'info',
      date:dateForEvent(latest),
      scanned:nonNegativeCount(latestMeta.scanned),
      eligible:nonNegativeCount(latestMeta.eligible),
      claimed:nonNegativeCount(latestMeta.claimed),
      sent:nonNegativeCount(latestMeta.sent),
      duplicate:nonNegativeCount(latestMeta.duplicate),
      failed,
      rateLimited,
      deferred:nonNegativeCount(latestMeta.deferred),
      remaining,
      backlog:nonNegativeCount(latestMeta.backlog ?? remaining),
      sealedClaims,
      expiredClaims:nonNegativeCount(latestMeta.expiredClaims),
      recoveredClaims:nonNegativeCount(latestMeta.recoveredClaims),
      completionRate,
      oldestActiveClaimAgeMs,
      truncated,
      durationMs:nonNegativeNumber(latestMeta.duration ?? latestMeta.durationMs),
    } : null,
    incident:{
      state:report.state,
      active:Boolean(report.activeIncident),
      incidentId:report.activeIncident?.incidentId || null,
      startedAt:report.activeIncident?.startedAt || null,
      recoveredAt:latestHistory?.recoveredAt || null,
      lastRecoveryAt:report.history.find(item=>item.recoveredAt)?.recoveredAt || null,
      historyCount:Number(report.history?.length || 0),
      diagnostics:report.activeIncident?.diagnostics || latestHistory?.diagnostics || null,
    },
    alertDelivery:ledger,
    policy:{
      automaticRollback:false,
      automaticFeatureDisable:false,
      source:'ops_events_and_persistent_alert_ledger',
    },
  };
}


export function summarizeDailyDigestReliability(rows = [], { days = 7, nowMs = Date.now() } = {}) {
  const windowDays=normalizedWindowDays(days);
  const endMs=normalizedNowMs(nowMs);
  const endDate=new Date(endMs);
  const startMs=Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()-(windowDays-1),
  );

  const candidateEvents=(Array.isArray(rows) ? rows : [])
    .map(normalizeEvent)
    .filter(event => {
      const atMs=trustedTimestampMs(event.at);
      return atMs !== null
        && atMs>=startMs
        && atMs<=endMs
        && isDailyDigestEvent(event);
    })
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));

  let invalidEvidenceRuns=0;
  const events=[];
  for (const event of candidateEvents) {
    if (!dateForEvent(event)) {
      invalidEvidenceRuns+=1;
      continue;
    }
    events.push(event);
  }

  const grouped=new Map();
  for (const event of events) {
    const date=dateForEvent(event);
    if (!grouped.has(date)) grouped.set(date,[]);
    grouped.get(date).push(event);
  }

  const evidenceCount=value=>
    typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : null;
  const evidenceRate=value=>
    typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1 ? value : null;

  let totalSent=0;
  let totalClaimed=0;
  let totalFailed=0;
  let totalRateLimited=0;
  let backlogOccurrences=0;
  let backlogDays=0;
  let sealedClaimDays=0;
  let degradedDays=0;
  let truncatedDays=0;
  let maxBacklog=0;
  const daily=[];

  for (const [date,list] of [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
    let sent=0;
    let claimed=0;
    let failed=0;
    let rateLimited=0;
    let backlogRuns=0;
    let dayMaxBacklog=0;
    let sealed=false;
    let degraded=false;
    let truncated=false;

    for (const event of list) {
      const meta=event.metadata || {};
      const sentCandidate=evidenceCount(meta.sent);
      const claimedCandidate=evidenceCount(meta.claimed);
      const failedCandidate=evidenceCount(meta.failed);
      const rateLimitedCandidate=evidenceCount(meta.rateLimited);
      const eligibleCandidate=meta.eligible === undefined || meta.eligible === null
        ? null
        : evidenceCount(meta.eligible);
      const remainingCandidate=meta.remaining === undefined || meta.remaining === null
        ? null
        : evidenceCount(meta.remaining);
      const backlogCandidate=meta.backlog === undefined || meta.backlog === null
        ? null
        : evidenceCount(meta.backlog);
      const sealedCandidate=meta.sealedClaims === undefined || meta.sealedClaims === null
        ? null
        : evidenceCount(meta.sealedClaims);
      const completionCandidate=meta.completionRate === undefined || meta.completionRate === null
        ? null
        : evidenceRate(meta.completionRate);

      const suppliedCountInvalid=[
        [meta.sent,sentCandidate],
        [meta.claimed,claimedCandidate],
        [meta.failed,failedCandidate],
        [meta.rateLimited,rateLimitedCandidate],
        [meta.eligible,eligibleCandidate],
        [meta.remaining,remainingCandidate],
        [meta.backlog,backlogCandidate],
        [meta.sealedClaims,sealedCandidate],
      ].some(([raw,parsed])=>raw !== undefined && raw !== null && parsed === null);

      const sentValue=sentCandidate ?? 0;
      const claimedValue=claimedCandidate ?? 0;
      const failedValue=failedCandidate ?? 0;
      const rateLimitedValue=rateLimitedCandidate ?? 0;
      const backlog=remainingCandidate ?? backlogCandidate ?? 0;
      const inconsistentBacklog=remainingCandidate !== null
        && backlogCandidate !== null
        && remainingCandidate !== backlogCandidate;
      const impossibleDelivery=sentValue>claimedValue
        || (eligibleCandidate !== null && claimedValue>eligibleCandidate);
      const expectedCompletion=claimedValue>0
        ? Number((sentValue/claimedValue).toFixed(4))
        : null;
      const inconsistentCompletion=completionCandidate !== null
        && expectedCompletion !== null
        && Math.abs(completionCandidate-expectedCompletion)>0.0001;
      const malformedRate=meta.completionRate !== undefined
        && meta.completionRate !== null
        && completionCandidate === null;
      const malformedTruncated=meta.truncated !== undefined
        && typeof meta.truncated !== 'boolean';

      if (
        suppliedCountInvalid
        || malformedRate
        || malformedTruncated
        || inconsistentBacklog
        || impossibleDelivery
        || inconsistentCompletion
      ) invalidEvidenceRuns+=1;

      sent+=sentValue;
      claimed+=claimedValue;
      failed+=failedValue;
      rateLimited+=rateLimitedValue;
      if (backlog>0) backlogRuns+=1;
      dayMaxBacklog=Math.max(dayMaxBacklog,backlog);
      sealed ||= event.code==='DAILY_DIGEST_SEALED_CLAIMS' || (sealedCandidate ?? 0)>0;
      degraded ||= event.code==='DAILY_DIGEST_RUN_DEGRADED';
      truncated ||= event.code==='DAILY_DIGEST_RUN_TRUNCATED' || meta.truncated === true;
    }

    const final=list.at(-1);
    const finalMeta=final?.metadata || {};
    const finalRemainingCandidate=finalMeta.remaining === undefined || finalMeta.remaining === null
      ? null
      : evidenceCount(finalMeta.remaining);
    const finalBacklogCandidate=finalMeta.backlog === undefined || finalMeta.backlog === null
      ? null
      : evidenceCount(finalMeta.backlog);
    const finalRemaining=finalRemainingCandidate ?? finalBacklogCandidate ?? 0;
    const finalCompletion=evidenceRate(finalMeta.completionRate);
    const completionRate=claimed>0 ? Number((sent/claimed).toFixed(4))
      : finalCompletion !== null ? finalCompletion
        : finalRemaining===0 && failed===0 ? 1 : null;

    totalSent+=sent;
    totalClaimed+=claimed;
    totalFailed+=failed;
    totalRateLimited+=rateLimited;
    backlogOccurrences+=backlogRuns;
    if (backlogRuns>0) backlogDays+=1;
    if (sealed) sealedClaimDays+=1;
    if (degraded) degradedDays+=1;
    if (truncated) truncatedDays+=1;
    maxBacklog=Math.max(maxBacklog,dayMaxBacklog);

    daily.push({
      date,
      runs:list.length,
      sent,
      claimed,
      failed,
      rateLimited,
      completionRate,
      backlogOccurrences:backlogRuns,
      maxBacklog:dayMaxBacklog,
      finalRemaining,
      sealedClaims:sealed,
      degraded,
      truncated,
      finalCode:String(final?.code || ''),
      lastAt:final?.at || null,
    });
  }

  const incidentReport=buildDailyDigestIncidentReport(events,{nowMs:endMs});
  const incidentEpisodes=incidentReport.history.filter(item => {
    const t=trustedTimestampMs(item.startedAt);
    return t !== null && t>=startMs && t<=endMs;
  });
  const incidentDays=new Set(incidentEpisodes.map(item=>String(item.date || '')).filter(Boolean));
  const recovered=incidentEpisodes.filter(item=>
    item.recoveredAt
    && typeof item.durationMinutes==='number'
    && Number.isFinite(item.durationMinutes)
    && item.durationMinutes>=0
  );
  const averageRecoveryMinutes=recovered.length
    ? Number((recovered.reduce((sum,item)=>sum+item.durationMinutes,0)/recovered.length).toFixed(1))
    : null;

  return {
    available:candidateEvents.length>0,
    days:windowDays,
    windowStartedAt:new Date(startMs).toISOString(),
    windowEndedAt:new Date(endMs).toISOString(),
    sampleDays:daily.length,
    expectedDays:windowDays,
    coverageRate:Number((Math.min(windowDays,daily.length)/windowDays).toFixed(4)),
    runs:events.length,
    observedEvents:candidateEvents.length,
    totals:{
      sent:totalSent,
      claimed:totalClaimed,
      failed:totalFailed,
      rateLimited:totalRateLimited,
    },
    completionRate:totalClaimed>0 ? Number((totalSent/totalClaimed).toFixed(4)) : null,
    backlog:{
      occurrences:backlogOccurrences,
      days:backlogDays,
      maxRecipients:maxBacklog,
    },
    sealedClaimDays,
    degradedDays,
    truncatedDays,
    rateLimitDays:daily.filter(item=>item.rateLimited>0).length,
    evidenceValid:invalidEvidenceRuns===0,
    invalidEvidenceRuns,
    incidents:{
      count:incidentDays.size,
      episodes:incidentEpisodes.length,
      recovered:recovered.length,
      active:incidentEpisodes.filter(item=>item.active).length,
      averageRecoveryMinutes,
      maxRecoveryMinutes:recovered.length ? Math.max(...recovered.map(item=>item.durationMinutes)) : null,
    },
    daily,
    policy:{
      aggregateOnly:true,
      userIdentifiers:false,
      incidentCountUnit:'days',
    },
  };
}


export const DAILY_DIGEST_RELIABILITY_SLO = Object.freeze({
  missingRunHourUtc:8,
  missingRunMinuteUtc:15,
  minSampleDays:3,
  minClaimedDeliveries:100,
  completionRateWatch:0.98,
  backlogDaysWatch:2,
  rateLimitDaysWatch:2,
  incidentDaysWatch:2,
  degradedDaysWatch:2,
});

function utcDate(ms) {
  return new Date(normalizedNowMs(ms)).toISOString().slice(0,10);
}

function afterMissingRunGrace(nowMs, policy = DAILY_DIGEST_RELIABILITY_SLO) {
  const now=new Date(Number(nowMs));
  if (!Number.isFinite(now.getTime())) return false;
  const minuteOfDay=now.getUTCHours()*60+now.getUTCMinutes();
  return minuteOfDay >= Number(policy.missingRunHourUtc)*60+Number(policy.missingRunMinuteUtc);
}

export function assessDailyDigestReliabilitySlo(rows = [], {
  nowMs = Date.now(),
  days = 7,
  policy = DAILY_DIGEST_RELIABILITY_SLO,
  evidenceComplete = true,
} = {}) {
  const now=normalizedNowMs(nowMs);
  const date=utcDate(now);
  const windowDays=normalizedWindowDays(days);
  const nowDate=new Date(now);
  const startMs=Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate()-(windowDays-1),
  );
  const normalized=(Array.isArray(rows) ? rows : [])
    .map(normalizeEvent)
    .filter(event=>{
      const at=trustedTimestampMs(event?.at);
      return at !== null
        && at>=startMs
        && at<=now+60_000
        && isDailyDigestEvent(event)
        && Boolean(dateForEvent(event));
    });
  const todayEvents=normalized.filter(event=>dateForEvent(event)===date);
  const latestSuccessfulDigestRun=[...normalized]
    .filter(event=>event.code==='DAILY_DIGEST_RUN_OK' || event.code==='DAILY_DIGEST_RUN_EMPTY')
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
    .at(-1)?.at || null;
  const diagnostics={
    window:{startUtc:'07:00',endUtc:'07:55',cutoffUtc:'08:15',timezone:'UTC'},
    expectedState:'daily_digest_run_observed_by_cutoff',
    lastSuccessfulDigestRun:latestSuccessfulDigestRun,
    evaluatedAt:new Date(now).toISOString(),
    todayRunObserved:todayEvents.length>0,
    evidenceComplete:evidenceComplete === true,
  };

  if (evidenceComplete !== true && afterMissingRunGrace(now,policy)) {
    return {
      state:'watch',
      severity:'warning',
      code:'DAILY_DIGEST_SLO_EVIDENCE_INCOMPLETE',
      reason:'evidence_incomplete',
      date,
      message:'Daily Digest reliability SLO cannot be confirmed because persistent history is incomplete.',
      reliability:summarizeDailyDigestReliability(rows,{days:windowDays,nowMs:now}),
      policy,
      diagnostics,
    };
  }

  if (afterMissingRunGrace(now,policy) && todayEvents.length===0) {
    return {
      state:'watch',
      severity:'warning',
      code:'DAILY_DIGEST_SLO_MISSING_RUN',
      reason:'missing_run',
      date,
      message:`Daily Digest has no operational run event for ${date} after the 08:15 UTC grace point.`,
      reliability:summarizeDailyDigestReliability(rows,{days:windowDays,nowMs:now}),
      policy,
      diagnostics,
    };
  }

  const reliability=summarizeDailyDigestReliability(rows,{days:windowDays,nowMs:now});
  if (!afterMissingRunGrace(now,policy) && todayEvents.length===0) {
    return {
      state:'collecting',
      severity:'info',
      code:'DAILY_DIGEST_SLO_COLLECTING',
      reason:'before_delivery_window_completion',
      date,
      message:'Daily Digest reliability SLO is collecting data before the missing-run grace point.',
      reliability,
      policy,
      diagnostics,
    };
  }

  if (reliability.evidenceValid !== true) {
    return {
      state:'watch',
      severity:'warning',
      code:'DAILY_DIGEST_SLO_EVIDENCE_INVALID',
      reason:'invalid_evidence',
      date,
      message:'Daily Digest reliability SLO found malformed or internally inconsistent delivery evidence.',
      reliability,
      policy,
      diagnostics,
    };
  }

  const enoughSample=Number(reliability.sampleDays || 0)>=Number(policy.minSampleDays || 0)
    && Number(reliability.totals?.claimed || 0)>=Number(policy.minClaimedDeliveries || 0);
  if (!enoughSample) {
    return {
      state:'collecting',
      severity:'info',
      code:'DAILY_DIGEST_SLO_COLLECTING',
      reason:'insufficient_sample',
      date,
      message:'Daily Digest reliability SLO needs more historical delivery volume before trend thresholds are enforced.',
      reliability,
      policy,
      diagnostics,
    };
  }

  const checks=[
    {
      hit:Number(reliability.completionRate ?? 1)<Number(policy.completionRateWatch),
      code:'DAILY_DIGEST_SLO_COMPLETION',
      reason:'completion_rate',
      message:`Daily Digest 7-day completion rate is ${(Number(reliability.completionRate || 0)*100).toFixed(2)}%, below the ${(Number(policy.completionRateWatch)*100).toFixed(2)}% watch threshold.`,
    },
    {
      hit:Number(reliability.backlog?.days || 0)>=Number(policy.backlogDaysWatch),
      code:'DAILY_DIGEST_SLO_BACKLOG_REPEATED',
      reason:'backlog_days',
      message:`Daily Digest backlog occurred on ${Number(reliability.backlog?.days || 0)} day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.rateLimitDays || 0)>=Number(policy.rateLimitDaysWatch),
      code:'DAILY_DIGEST_SLO_RATE_LIMIT_REPEATED',
      reason:'rate_limit_days',
      message:`Daily Digest hit Telegram rate limits on ${Number(reliability.rateLimitDays || 0)} day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.incidents?.count || 0)>=Number(policy.incidentDaysWatch),
      code:'DAILY_DIGEST_SLO_INCIDENT_REPEATED',
      reason:'incident_days',
      message:`Daily Digest had ${Number(reliability.incidents?.count || 0)} operational incident day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.degradedDays || 0)>=Number(policy.degradedDaysWatch),
      code:'DAILY_DIGEST_SLO_DEGRADED_REPEATED',
      reason:'degraded_days',
      message:`Daily Digest was degraded on ${Number(reliability.degradedDays || 0)} day(s) in the reliability window.`,
    },
  ];
  const failed=checks.filter(check=>check.hit);
  if (failed.length) {
    return {
      state:'watch',
      severity:'warning',
      code:failed[0].code,
      reason:failed[0].reason,
      reasons:failed.map(check=>check.reason),
      date,
      message:failed.map(check=>check.message).join(' '),
      reliability,
      policy,
      diagnostics,
    };
  }

  return {
    state:'healthy',
    severity:'info',
    code:'DAILY_DIGEST_SLO_OK',
    reason:'within_thresholds',
    date,
    message:'Daily Digest reliability SLO is within configured watch thresholds.',
    reliability,
    policy,
    diagnostics,
  };
}

export function planDailyDigestReliabilitySloEvent(assessment = {}, priorRows = []) {
  const date=String(assessment?.date || '');
  const evaluatedAt=trustedTimestampMs(assessment?.diagnostics?.evaluatedAt);
  const rows=(Array.isArray(priorRows) ? priorRows : [])
    .map(row=>({
      at:iso(row?.created_at || row?.createdAt || row?.at),
      source:String(row?.source || ''),
      eventType:String(row?.event_type || row?.eventType || ''),
      severity:String(row?.severity || ''),
      code:String(row?.code || ''),
      metadata:objectRecord(row?.metadata),
    }))
    .filter(row=>{
      const at=trustedTimestampMs(row.at);
      return at !== null
        && row.source==='digest_slo'
        && row.eventType==='reliability_slo'
        && (evaluatedAt === null || at<=evaluatedAt+60_000);
    })
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const latest=rows.at(-1) || null;
  const latestState=String(latest?.metadata?.state || (latest?.severity==='warning' ? 'watch' : ''));
  const latestDate=String(latest?.metadata?.date || latest?.at || '').slice(0,10);
  const latestReason=String(latest?.metadata?.reason || '');
  const dailyMissingRunReset=assessment.state==='watch'
    && assessment.reason==='missing_run'
    && latestState==='watch'
    && latestDate
    && latestDate!==date;

  if (assessment.state==='watch') {
    if (latestState==='watch' && !dailyMissingRunReset) {
      return {action:'none',reason:'watch_episode_already_recorded'};
    }
    return {
      action:'record',
      severity:'warning',
      source:'digest_slo',
      eventType:'reliability_slo',
      code:String(assessment.code || 'DAILY_DIGEST_SLO_WATCH'),
      message:String(assessment.message || 'Daily Digest reliability SLO requires attention.'),
      endpoint:'cron:production-monitor',
      meta:{
        date,
        state:'watch',
        reason:String(assessment.reason || ''),
        reasons:(Array.isArray(assessment.reasons) ? assessment.reasons : [])
          .filter(reason=>typeof reason==='string')
          .map(reason=>reason.trim().slice(0,80))
          .filter(Boolean)
          .slice(0,8),
        sampleDays:nonNegativeCount(assessment.reliability?.sampleDays),
        claimed:nonNegativeCount(assessment.reliability?.totals?.claimed),
        completionRate:boundedRate(assessment.reliability?.completionRate),
        backlogDays:nonNegativeCount(assessment.reliability?.backlog?.days),
        rateLimitDays:nonNegativeCount(assessment.reliability?.rateLimitDays),
        incidentDays:nonNegativeCount(assessment.reliability?.incidents?.count),
        degradedDays:nonNegativeCount(assessment.reliability?.degradedDays),
        window:assessment.diagnostics?.window || null,
        expectedState:String(assessment.diagnostics?.expectedState || ''),
        lastSuccessfulDigestRun:assessment.diagnostics?.lastSuccessfulDigestRun || null,
        evaluatedAt:assessment.diagnostics?.evaluatedAt || null,
      },
    };
  }

  const missingRunRecovered=latestState==='watch'
    && latestReason==='missing_run'
    && assessment.reason!=='missing_run'
    && assessment.diagnostics?.todayRunObserved===true;

  if ((assessment.state==='healthy' && latestState==='watch') || missingRunRecovered) {
    return {
      action:'record',
      severity:'info',
      source:'digest_slo',
      eventType:'reliability_slo',
      code:'DAILY_DIGEST_SLO_RECOVERED',
      message:missingRunRecovered
        ? 'Daily Digest missing-run condition recovered after an operational run was observed.'
        : 'Daily Digest reliability SLO recovered to within configured watch thresholds.',
      endpoint:'cron:production-monitor',
      meta:{
        date,
        state:'healthy',
        reason:missingRunRecovered ? 'missing_run_recovered' : 'within_thresholds',
        recoveredFrom:latest.code,
        watchStartedAt:latest.at,
        sampleDays:nonNegativeCount(assessment.reliability?.sampleDays),
        claimed:nonNegativeCount(assessment.reliability?.totals?.claimed),
        completionRate:boundedRate(assessment.reliability?.completionRate),
        window:assessment.diagnostics?.window || null,
        expectedState:String(assessment.diagnostics?.expectedState || ''),
        lastSuccessfulDigestRun:assessment.diagnostics?.lastSuccessfulDigestRun || null,
        evaluatedAt:assessment.diagnostics?.evaluatedAt || null,
      },
    };
  }

  return {action:'none',reason:assessment.state==='collecting'?'collecting':'healthy_without_transition'};
}
