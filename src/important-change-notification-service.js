const WINDOW_BEFORE_KICKOFF_MINUTES=180;
const WINDOW_AFTER_KICKOFF_MINUTES=2;
const MAX_SIGNAL_AGE_MINUTES=180;
const MAX_FUTURE_SKEW_MS=5*60_000;

function required(name,value) {
  if (typeof value!=='function') {
    throw new TypeError(`Important change notifications require ${name}.`);
  }
  return value;
}

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  if (!value || typeof value!=='object') return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=180,fallback='') {
  if (typeof value!=='string') return fallback;
  const text=value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu,' ')
    .replace(/\s+/gu,' ')
    .trim();
  return text ? text.slice(0,max) : fallback;
}

function numericIdentifier(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value!=='string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value,fallback=0,max=Number.MAX_SAFE_INTEGER) {
  const number=numericIdentifier(value);
  return number!==null && number>0 && number<=max
    ? number
    : fallback;
}

function nonNegativeSafeInteger(value) {
  return typeof value==='number'
    && Number.isSafeInteger(value)
    && value>=0
      ? value
      : 0;
}

function strictPositiveInteger(value,fallback,max) {
  return typeof value==='number'
    && Number.isSafeInteger(value)
    && value>0
    && value<=max
      ? value
      : fallback;
}

function strictProbability(value) {
  return typeof value==='number'
    && Number.isFinite(value)
    && value>=0
    && value<=100
      ? value
      : null;
}

function strictThreshold(value) {
  return typeof value==='number'
    && Number.isFinite(value)
    && value>0
    && value<=100
      ? value
      : 5;
}

function strictTimestampMs(value) {
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!match) return null;
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  const hour=Number(match[4]);
  const minute=Number(match[5]);
  const second=Number(match[6] || 0);
  if (
    month<1
    || month>12
    || day<1
    || day>new Date(Date.UTC(year,month,0)).getUTCDate()
    || hour>23
    || minute>59
    || second>59
  ) return null;
  const offset=match[7];
  if (offset!=='Z' && offset!=='z') {
    const [offsetHour,offsetMinute]=offset.slice(1).split(':').map(Number);
    if (
      offsetHour>14
      || offsetMinute>59
      || (offsetHour===14 && offsetMinute!==0)
    ) return null;
  }
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function clockMs(now) {
  try {
    const value=now();
    return typeof value==='number' && Number.isFinite(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function reminderIdentity(row) {
  const source=plainObject(row);
  if (!source) return null;
  const telegramId=positiveSafeInteger(safeRead(source,'telegram_id'));
  const fixtureId=positiveSafeInteger(safeRead(source,'fixture_id'));
  return telegramId && fixtureId
    ? {telegramId,fixtureId}
    : null;
}

function unnotifiedReminder(row) {
  const identity=reminderIdentity(row);
  if (!identity) return null;
  const notifiedAt=safeRead(row,'important_change_notified_at');
  if (notifiedAt!==null && notifiedAt!==undefined && notifiedAt!=='') {
    return null;
  }
  return {row,identity};
}

export function createImportantChangeNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  getOddsSnapshots,
  deliverClaimedReminder,
  filterNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun=12,
  thresholdPp=5,
  now=Date.now,
}={}) {
  required('hasSupabase',hasSupabase);
  required('loadRuntimeControls',loadRuntimeControls);
  required('supaSelectPaged',supaSelectPaged);
  required('getOddsSnapshots',getOddsSnapshots);
  required('deliverClaimedReminder',deliverClaimedReminder);
  required('now',now);

  const fixtureLimit=strictPositiveInteger(maxFixturesPerRun,12,100);
  const movementThreshold=strictThreshold(thresholdPp);

  async function emitOpsEvent(cfg,event) {
    if (typeof recordOpsEvent!=='function') return;
    try {
      await Promise.resolve(recordOpsEvent(cfg,event));
    } catch {
      // Observability is best-effort and must not break notification delivery.
    }
  }

  function emptySummary(extra={}) {
    return {
      ok:true,
      checked:0,
      eligible:0,
      blockedByPreference:0,
      blockedByEntitlement:0,
      fixturesChecked:0,
      significant:0,
      sent:0,
      failed:0,
      unknown:0,
      claimed:0,
      truncated:false,
      ...extra,
    };
  }

  function candidateWindow(nowValue=clockMs(now)) {
    if (
      typeof nowValue!=='number'
      || !Number.isFinite(nowValue)
      || nowValue<0
      || nowValue>8.64e15
    ) return null;
    try {
      return {
        from:new Date(
          nowValue-WINDOW_AFTER_KICKOFF_MINUTES*60_000,
        ).toISOString(),
        to:new Date(
          nowValue+WINDOW_BEFORE_KICKOFF_MINUTES*60_000,
        ).toISOString(),
      };
    } catch {
      return null;
    }
  }

  function groupByFixture(rows=[]) {
    const groups=new Map();
    const seen=new Set();
    for (const row of Array.isArray(rows) ? rows.slice(0,2000) : []) {
      const candidate=unnotifiedReminder(row);
      if (!candidate) continue;
      const {telegramId,fixtureId}=candidate.identity;
      const key=`${telegramId}:${fixtureId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list=groups.get(fixtureId) || [];
      list.push(row);
      groups.set(fixtureId,list);
    }
    return groups;
  }

  function normalizedSnapshot(value) {
    const row=plainObject(value);
    if (!row) return null;
    const timestampMs=strictTimestampMs(safeRead(row,'at'));
    const homeProb=strictProbability(safeRead(row,'homeProb'));
    const drawProb=strictProbability(safeRead(row,'drawProb'));
    const awayProb=strictProbability(safeRead(row,'awayProb'));
    if (
      timestampMs===null
      || homeProb===null
      || drawProb===null
      || awayProb===null
      || Math.abs(homeProb+drawProb+awayProb-100)>2.5
    ) return null;
    return {
      at:new Date(timestampMs).toISOString(),
      timestampMs,
      homeProb,
      drawProb,
      awayProb,
    };
  }

  function movementFromSnapshots(snapshots=[],nowValue=clockMs(now)) {
    if (
      typeof nowValue!=='number'
      || !Number.isFinite(nowValue)
      || nowValue<0
      || nowValue>8.64e15
    ) {
      return {
        significant:false,
        reason:'invalid_clock',
        sample:0,
      };
    }

    const ordered=(Array.isArray(snapshots) ? snapshots.slice(0,100) : [])
      .map(normalizedSnapshot)
      .filter(Boolean)
      .sort((a,b)=>b.timestampMs-a.timestampMs);

    const seenTimes=new Set();
    const valid=[];
    for (const row of ordered) {
      if (seenTimes.has(row.timestampMs)) continue;
      seenTimes.add(row.timestampMs);
      valid.push(row);
    }

    if (valid.length<2) {
      return {
        significant:false,
        reason:'insufficient_history',
        sample:valid.length,
      };
    }

    const latest=valid[0];
    if (
      latest.timestampMs>nowValue+MAX_FUTURE_SKEW_MS
      || nowValue-latest.timestampMs>MAX_SIGNAL_AGE_MINUTES*60_000
    ) {
      return {
        significant:false,
        reason:'stale_signal',
        sample:valid.length,
        latestAt:latest.at,
      };
    }

    const recentHistory=valid.filter(row=>
      row.timestampMs<latest.timestampMs
      && latest.timestampMs-row.timestampMs
        <=MAX_SIGNAL_AGE_MINUTES*60_000
    );
    const baseline=recentHistory.at(-1);
    if (!baseline) {
      return {
        significant:false,
        reason:'insufficient_recent_history',
        sample:valid.length,
        latestAt:latest.at,
      };
    }

    const deltas={
      home:Math.round((latest.homeProb-baseline.homeProb)*10)/10,
      draw:Math.round((latest.drawProb-baseline.drawProb)*10)/10,
      away:Math.round((latest.awayProb-baseline.awayProb)*10)/10,
    };
    const strongest=Object.entries(deltas)
      .map(([side,delta])=>({side,delta}))
      .sort((a,b)=>
        Math.abs(b.delta)-Math.abs(a.delta)
        || a.side.localeCompare(b.side)
      )[0];

    return {
      significant:Boolean(
        strongest
        && Math.abs(strongest.delta)>=movementThreshold
      ),
      reason:strongest ? 'evaluated' : 'invalid',
      sample:valid.length,
      baselineAt:baseline.at,
      latestAt:latest.at,
      strongest,
      deltas,
    };
  }

  function sideLabel(side,row={}) {
    if (side==='home') {
      return safeText(safeRead(row,'home_name'),160,'П1');
    }
    if (side==='away') {
      return safeText(safeRead(row,'away_name'),160,'П2');
    }
    return 'Ничья';
  }

  function changeMessage(row,movement={}) {
    const strongest=plainObject(safeRead(movement,'strongest')) || {};
    const delta=safeRead(strongest,'delta');
    const safeDelta=
      typeof delta==='number' && Number.isFinite(delta)
        ? delta
        : 0;
    const direction=safeDelta>0 ? 'выросла' : 'снизилась';
    const signed=`${safeDelta>0 ? '+' : ''}${safeDelta.toFixed(1)} п.п.`;
    const rawSample=safeRead(movement,'sample');
    const sample=
      typeof rawSample==='number'
      && Number.isSafeInteger(rawSample)
      && rawSample>=0
        ? rawSample
        : 0;
    const home=safeText(safeRead(row,'home_name'),160,'Хозяева');
    const away=safeText(safeRead(row,'away_name'),160,'Гости');
    const league=safeText(safeRead(row,'league_name'),160);

    return [
      '📡 Важное изменение перед матчем',
      '',
      `${home} — ${away}`,
      league,
      '',
      `Расчётная рыночная вероятность «${sideLabel(
        safeRead(strongest,'side'),
        row,
      )}» заметно ${direction}: ${signed}`,
      `Сигнал подтверждён по ${sample} сохранённым снимкам рынка.`,
      '',
      'Это изменение рыночной оценки, а не гарантия результата. Откройте MatchRadar, чтобы посмотреть контекст матча.',
    ].filter(Boolean).join('\n');
  }

  function sourceRows(value,window) {
    if (!Array.isArray(value) || !window) return [];
    const fromMs=strictTimestampMs(window.from);
    const toMs=strictTimestampMs(window.to);
    if (fromMs===null || toMs===null) return [];

    return value
      .slice(0,2000)
      .filter(row=>{
        const candidate=unnotifiedReminder(row);
        if (!candidate) return false;
        if (safeRead(row,'enabled')!==true) return false;
        const fixtureMs=strictTimestampMs(
          safeRead(row,'fixture_date'),
        );
        return fixtureMs!==null
          && fixtureMs>=fromMs
          && fixtureMs<=toMs;
      });
  }

  async function eligibleReminderRows(rows,cfg) {
    if (typeof filterNotificationRecipients!=='function') {
      return {
        rows,
        blockedByPreference:0,
        blockedByEntitlement:0,
      };
    }

    const audience=plainObject(
      await filterNotificationRecipients(
        rows,
        'market.movement',
        cfg,
      ),
    );
    if (!audience) {
      throw new TypeError(
        'Important change audience response is malformed.',
      );
    }

    const sourceKeys=new Set();
    for (const row of rows) {
      const identity=reminderIdentity(row);
      if (!identity) continue;
      sourceKeys.add(
        `${identity.telegramId}:${identity.fixtureId}`,
      );
    }

    const allowedUserIds=new Set();
    const audienceRows=safeRead(audience,'rows');
    if (!Array.isArray(audienceRows)) {
      throw new TypeError(
        'Important change audience rows are malformed.',
      );
    }
    for (const row of audienceRows.slice(0,2000)) {
      const identity=reminderIdentity(row);
      if (!identity) continue;
      const key=`${identity.telegramId}:${identity.fixtureId}`;
      if (sourceKeys.has(key)) {
        allowedUserIds.add(identity.telegramId);
      }
    }

    return {
      rows:rows.filter(row=>
        allowedUserIds.has(reminderIdentity(row)?.telegramId || 0)
      ),
      blockedByPreference:nonNegativeSafeInteger(
        safeRead(audience,'blockedByPreference'),
      ),
      blockedByEntitlement:nonNegativeSafeInteger(
        safeRead(audience,'blockedByEntitlement'),
      ),
    };
  }

  async function processImportantChangeNotifications(cfg) {
    let storageAvailable=false;
    try {
      storageAvailable=hasSupabase(cfg)===true;
    } catch {
      return emptySummary({
        ok:false,
        failed:1,
        reason:'storage_availability_unknown',
      });
    }

    const botToken=safeText(safeRead(cfg,'botToken'),512);
    if (!storageAvailable || !botToken) return emptySummary();

    let runtime;
    try {
      runtime=plainObject(await loadRuntimeControls(cfg));
    } catch (error) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_RUNTIME_CONTROLS_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Runtime controls unavailable.',
        ),
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        failed:1,
        reason:'runtime_controls_unavailable',
      });
    }

    const runtimeValue=plainObject(safeRead(runtime,'value'));
    const remindersEnabled=safeRead(
      runtimeValue,
      'remindersEnabled',
    );
    if (remindersEnabled===false) {
      return emptySummary({disabled:true});
    }
    if (remindersEnabled!==true) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_RUNTIME_CONTROLS_INVALID',
        message:'Important-change scheduler stayed fail-closed because reminder controls were malformed.',
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        failed:1,
        reason:'runtime_controls_invalid',
      });
    }

    const nowValue=clockMs(now);
    const window=candidateWindow(nowValue);
    if (!window) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_CLOCK_INVALID',
        message:'Important-change scheduler clock was invalid.',
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        failed:1,
        reason:'invalid_clock',
      });
    }

    let page;
    try {
      page=plainObject(
        await supaSelectPaged(
          cfg,
          'match_reminders',
          {
            enabled:'eq.true',
            important_change_notified_at:'is.null',
            and:`(fixture_date.gte.${window.from},fixture_date.lte.${window.to})`,
          },
          {
            pageSize:250,
            maxRows:1000,
            order:'fixture_date.asc,fixture_id.asc,telegram_id.asc',
          },
        ),
      );
      if (!page) {
        throw new TypeError(
          'Important-change reminder page is malformed.',
        );
      }
    } catch (error) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_READ_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Reminder read failed.',
        ),
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        failed:1,
        reason:'reminder_read_failed',
      });
    }

    const rawRows=safeRead(page,'rows');
    const rawTruncated=safeRead(page,'truncated');
    if (
      !Array.isArray(rawRows)
      || typeof rawTruncated!=='boolean'
    ) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_READ_INVALID',
        message:'Reminder page returned malformed rows or truncation evidence.',
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        failed:1,
        reason:'reminder_read_invalid',
      });
    }

    const rows=sourceRows(rawRows,window);
    let audience;
    try {
      audience=await eligibleReminderRows(rows,cfg);
    } catch (error) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_AUDIENCE_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Audience filtering failed.',
        ),
        endpoint:'cron:important-change-notifications',
      });
      return emptySummary({
        ok:false,
        checked:rawRows.length,
        failed:1,
        truncated:rawTruncated,
        reason:'audience_unavailable',
      });
    }

    const eligibleRows=Array.isArray(audience.rows)
      ? audience.rows
      : [];
    const groups=groupByFixture(eligibleRows);
    const fixtures=[...groups.entries()].slice(0,fixtureLimit);
    const truncated=
      rawTruncated
      || groups.size>fixtures.length;

    let significant=0;
    let sent=0;
    let failed=0;
    let unknown=0;
    let claimed=0;

    for (const [fixtureId,recipients] of fixtures) {
      let snapshots;
      try {
        snapshots=await getOddsSnapshots(fixtureId,cfg,12);
      } catch (error) {
        failed+=1;
        await emitOpsEvent(cfg,{
          severity:'warning',
          source:'important_change_notifications',
          eventType:'important_change_notification_probe',
          code:'IMPORTANT_CHANGE_NOTIFICATION_ODDS_READ_FAILED',
          message:safeText(
            safeRead(error,'message'),
            240,
            'Odds snapshot read failed.',
          ),
          endpoint:'cron:important-change-notifications',
          meta:{fixtureId},
        });
        continue;
      }

      const movement=movementFromSnapshots(
        snapshots,
        nowValue,
      );
      if (!movement.significant) continue;
      significant+=1;

      for (const row of recipients) {
        try {
          const delivery=plainObject(
            await deliverClaimedReminder(
              row,
              'important_change',
              changeMessage(row,movement),
              cfg,
            ),
          );
          const state=safeRead(delivery,'state');
          if (state==='sent') sent+=1;
          else if (state==='already_claimed') claimed+=1;
          else if (state==='unknown' || state==='sent_unconfirmed') {
            unknown+=1;
          } else {
            failed+=1;
          }
        } catch {
          failed+=1;
        }
      }
    }

    const summary={
      ok:!(failed || unknown || truncated),
      checked:rawRows.length,
      eligible:eligibleRows.length,
      blockedByPreference:audience.blockedByPreference,
      blockedByEntitlement:audience.blockedByEntitlement,
      fixturesChecked:fixtures.length,
      significant,
      sent,
      failed,
      unknown,
      claimed,
      truncated,
    };

    if (sent || failed || unknown || truncated) {
      await emitOpsEvent(cfg,{
        severity:failed || unknown || truncated
          ? 'warning'
          : 'info',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:failed
          ? 'IMPORTANT_CHANGE_RUN_WITH_FAILURES'
          : unknown
            ? 'IMPORTANT_CHANGE_RUN_WITH_UNKNOWN'
            : truncated
              ? 'IMPORTANT_CHANGE_RUN_TRUNCATED'
              : 'IMPORTANT_CHANGE_RUN_OK',
        message:`Важные изменения: проверено матчей ${fixtures.length}, сигналов ${significant}, отправлено ${sent}, ошибок ${failed}.`,
        endpoint:'cron:important-change-notifications',
        meta:summary,
      });
    }

    return summary;
  }

  return Object.freeze({
    candidateWindow,
    groupByFixture,
    movementFromSnapshots,
    changeMessage,
    processImportantChangeNotifications,
  });
}
