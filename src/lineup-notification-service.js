const WINDOW_BEFORE_KICKOFF_MINUTES=95;
const WINDOW_AFTER_KICKOFF_MINUTES=8;
const MAX_TIMESTAMP_MS=8.64e15;

function required(name,value) {
  if (typeof value!=='function') {
    throw new TypeError(`Lineup notifications require ${name}.`);
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

function integerCandidate(value) {
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
  const number=integerCandidate(value);
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
  const timestamp=Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function clockMs(now) {
  try {
    const value=now();
    return typeof value==='number'
      && Number.isFinite(value)
      && value>=0
      && value<=MAX_TIMESTAMP_MS
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
  const notifiedAt=safeRead(row,'lineup_notified_at');
  if (notifiedAt!==null && notifiedAt!==undefined && notifiedAt!=='') {
    return null;
  }
  return {row,identity};
}

export function createLineupNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  loadLineupSnapshot,
  deliverClaimedReminder,
  filterNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun = 4,
  now = Date.now,
} = {}) {
  required('hasSupabase',hasSupabase);
  required('loadRuntimeControls',loadRuntimeControls);
  required('supaSelectPaged',supaSelectPaged);
  required('loadLineupSnapshot',loadLineupSnapshot);
  required('deliverClaimedReminder',deliverClaimedReminder);
  required('now',now);

  const fixtureLimit=positiveSafeInteger(maxFixturesPerRun,4,100);

  async function emitOpsEvent(cfg,event) {
    if (typeof recordOpsEvent!=='function') return;
    try {
      await Promise.resolve(recordOpsEvent(cfg,event));
    } catch {
      // Scheduler observability is best-effort and must not break delivery.
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
      confirmed:0,
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
      || nowValue>MAX_TIMESTAMP_MS
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

  function groupByFixture(rows = []) {
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
        'match.lineup',
        cfg,
      ),
    );
    if (!audience) {
      throw new TypeError(
        'Lineup notification audience response is malformed.',
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

    const allowedKeys=new Set();
    const audienceRows=safeRead(audience,'rows');
    if (!Array.isArray(audienceRows)) {
      throw new TypeError(
        'Lineup notification audience rows are malformed.',
      );
    }
    for (const row of audienceRows.slice(0,2000)) {
      const identity=reminderIdentity(row);
      if (!identity) continue;
      const key=`${identity.telegramId}:${identity.fixtureId}`;
      if (sourceKeys.has(key)) allowedKeys.add(key);
    }

    return {
      rows:rows.filter(row=>{
        const identity=reminderIdentity(row);
        return Boolean(
          identity
          && allowedKeys.has(
            `${identity.telegramId}:${identity.fixtureId}`,
          )
        );
      }),
      blockedByPreference:nonNegativeSafeInteger(
        safeRead(audience,'blockedByPreference'),
      ),
      blockedByEntitlement:nonNegativeSafeInteger(
        safeRead(audience,'blockedByEntitlement'),
      ),
    };
  }

  function lineupMessage(row,snapshot={},nowValue=clockMs(now)) {
    const home=safeText(
      safeRead(row,'home_name'),
      160,
      safeText(safeRead(snapshot,'homeName'),160,'Хозяева'),
    );
    const away=safeText(
      safeRead(row,'away_name'),
      160,
      safeText(safeRead(snapshot,'awayName'),160,'Гости'),
    );
    const league=safeText(
      safeRead(row,'league_name'),
      160,
      safeText(safeRead(snapshot,'leagueName'),160),
    );
    const kickoff=strictTimestampMs(
      safeRead(row,'fixture_date')
      ?? safeRead(snapshot,'fixtureDate'),
    );
    const minutes=kickoff!==null
      && typeof nowValue==='number'
      && Number.isFinite(nowValue)
        ? Math.max(0,Math.round((kickoff-nowValue)/60000))
        : null;

    return [
      '👥 Составы опубликованы',
      '',
      `${home} — ${away}`,
      league,
      minutes===null
        ? ''
        : minutes>0
          ? `До матча около ${minutes} мин.`
          : 'Матч уже начинается.',
      '',
      'Оба стартовых состава подтверждены: по 11 уникальных игроков.',
      'Откройте MatchRadar — составы и обновлённый анализ уже доступны.',
    ].filter(Boolean).join('\n');
  }

  async function processLineupNotifications(cfg) {
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Runtime controls unavailable.',
        ),
        endpoint:'cron:lineup-notifications',
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_INVALID',
        message:'Lineup scheduler stayed fail-closed because reminder controls were malformed.',
        endpoint:'cron:lineup-notifications',
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_CLOCK_INVALID',
        message:'Lineup scheduler clock was invalid.',
        endpoint:'cron:lineup-notifications',
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
            lineup_notified_at:'is.null',
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
          'Lineup reminder page is malformed.',
        );
      }
    } catch (error) {
      await emitOpsEvent(cfg,{
        severity:'error',
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_READ_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Reminder read failed.',
        ),
        endpoint:'cron:lineup-notifications',
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_READ_INVALID',
        message:'Reminder page returned malformed rows or truncation evidence.',
        endpoint:'cron:lineup-notifications',
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_AUDIENCE_FAILED',
        message:safeText(
          safeRead(error,'message'),
          240,
          'Audience filtering failed.',
        ),
        endpoint:'cron:lineup-notifications',
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
    const truncated=rawTruncated || groups.size>fixtures.length;

    let confirmed=0;
    let sent=0;
    let failed=0;
    let unknown=0;
    let claimed=0;

    for (const [fixtureId,recipients] of fixtures) {
      let snapshot;
      try {
        snapshot=plainObject(
          await loadLineupSnapshot(fixtureId,cfg),
        );
      } catch (error) {
        failed+=1;
        await emitOpsEvent(cfg,{
          severity:'warning',
          source:'lineup_notifications',
          eventType:'lineup_notification_probe',
          code:'LINEUP_NOTIFICATION_PROBE_FAILED',
          message:safeText(
            safeRead(error,'message'),
            240,
            'Lineup probe failed.',
          ),
          endpoint:'cron:lineup-notifications',
          meta:{fixtureId},
        });
        continue;
      }

      if (safeRead(snapshot,'confirmed')!==true) continue;
      confirmed+=1;

      for (const row of recipients) {
        try {
          const delivery=plainObject(
            await deliverClaimedReminder(
              row,
              'lineup',
              lineupMessage(row,snapshot,nowValue),
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
      confirmed,
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
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:failed
          ? 'LINEUP_NOTIFICATION_RUN_WITH_FAILURES'
          : unknown
            ? 'LINEUP_NOTIFICATION_RUN_WITH_UNKNOWN'
            : truncated
              ? 'LINEUP_NOTIFICATION_RUN_TRUNCATED'
              : 'LINEUP_NOTIFICATION_RUN_OK',
        message:`Составы: проверено матчей ${fixtures.length}, подтверждено ${confirmed}, отправлено ${sent}, ошибок ${failed}.`,
        endpoint:'cron:lineup-notifications',
        meta:summary,
      });
    }

    return summary;
  }

  return Object.freeze({
    candidateWindow,
    groupByFixture,
    lineupMessage,
    processLineupNotifications,
  });
}
