export function createImportantChangeNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  getOddsSnapshots,
  deliverClaimedReminder,
  filterNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun = 12,
  thresholdPp = 5,
} = {}) {
  const WINDOW_BEFORE_KICKOFF_MINUTES = 180;
  const WINDOW_AFTER_KICKOFF_MINUTES = 2;

  function candidateWindow(now = Date.now()) {
    return {
      from: new Date(now - WINDOW_AFTER_KICKOFF_MINUTES * 60_000).toISOString(),
      to: new Date(now + WINDOW_BEFORE_KICKOFF_MINUTES * 60_000).toISOString(),
    };
  }

  function groupByFixture(rows = []) {
    const groups = new Map();
    for (const row of rows) {
      const fixtureId = Number(row?.fixture_id || 0);
      if (!fixtureId || row?.important_change_notified_at) continue;
      const list = groups.get(fixtureId) || [];
      list.push(row);
      groups.set(fixtureId, list);
    }
    return groups;
  }

  function validProbability(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }

  function movementFromSnapshots(snapshots = []) {
    const valid = (Array.isArray(snapshots) ? snapshots : [])
      .filter(row => Number.isFinite(Date.parse(String(row?.at || ''))))
      .map(row => ({
        ...row,
        homeProb: validProbability(row?.homeProb),
        drawProb: validProbability(row?.drawProb),
        awayProb: validProbability(row?.awayProb),
      }))
      .filter(row => row.homeProb !== null && row.drawProb !== null && row.awayProb !== null)
      .filter(row => Math.abs((row.homeProb + row.drawProb + row.awayProb) - 100) <= 2.5)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    if (valid.length < 2) return { significant:false, reason:'insufficient_history', sample:valid.length };

    const latest = valid[0];
    const baseline = valid[valid.length - 1];
    const deltas = {
      home: Math.round((latest.homeProb - baseline.homeProb) * 10) / 10,
      draw: Math.round((latest.drawProb - baseline.drawProb) * 10) / 10,
      away: Math.round((latest.awayProb - baseline.awayProb) * 10) / 10,
    };
    const strongest = Object.entries(deltas)
      .map(([side, delta]) => ({ side, delta }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

    return {
      significant:Boolean(strongest && Math.abs(strongest.delta) >= Number(thresholdPp || 5)),
      reason: strongest ? 'evaluated' : 'invalid',
      sample:valid.length,
      baselineAt:baseline.at,
      latestAt:latest.at,
      strongest,
      deltas,
    };
  }

  function sideLabel(side, row = {}) {
    if (side === 'home') return String(row?.home_name || 'П1');
    if (side === 'away') return String(row?.away_name || 'П2');
    return 'Ничья';
  }

  function changeMessage(row, movement = {}) {
    const strongest = movement?.strongest || {};
    const delta = Number(strongest.delta || 0);
    const direction = delta > 0 ? 'выросла' : 'снизилась';
    const signed = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} п.п.`;
    return [
      '📡 Важное изменение перед матчем',
      '',
      `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
      row?.league_name || '',
      '',
      `Расчётная рыночная вероятность «${sideLabel(strongest.side, row)}» заметно ${direction}: ${signed}`,
      `Сигнал подтверждён по ${Number(movement.sample || 0)} сохранённым снимкам рынка.`,
      '',
      'Это изменение рыночной оценки, а не гарантия результата. Откройте MatchRadar, чтобы посмотреть контекст матча.',
    ].filter(Boolean).join('\n');
  }

  async function processImportantChangeNotifications(cfg) {
    if (!hasSupabase?.(cfg) || !cfg?.botToken) {
      return { ok:true, checked:0, fixturesChecked:0, significant:0, sent:0, failed:0, unknown:0, claimed:0, truncated:false };
    }

    const runtime = await loadRuntimeControls(cfg);
    if (runtime?.value?.remindersEnabled === false) {
      return { ok:true, checked:0, fixturesChecked:0, significant:0, sent:0, failed:0, unknown:0, claimed:0, truncated:false, disabled:true };
    }

    const now = Date.now();
    const window = candidateWindow(now);
    let page;
    try {
      page = await supaSelectPaged(cfg, 'match_reminders', {
        enabled:'eq.true',
        important_change_notified_at:'is.null',
        and:`(fixture_date.gte.${window.from},fixture_date.lte.${window.to})`,
      }, {
        pageSize:250,
        maxRows:1000,
        order:'fixture_date.asc,fixture_id.asc,telegram_id.asc',
      });
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:'IMPORTANT_CHANGE_NOTIFICATION_READ_FAILED',
        message:error?.message || error,
        endpoint:'cron:important-change-notifications',
      }).catch(()=>{});
      return { ok:false, checked:0, fixturesChecked:0, significant:0, sent:0, failed:1, unknown:0, claimed:0, truncated:false };
    }

    const rows = Array.isArray(page?.rows) ? page.rows : [];
    const audience = typeof filterNotificationRecipients === 'function'
      ? await filterNotificationRecipients(rows, 'market.movement', cfg)
      : { rows, blockedByPreference:0, blockedByEntitlement:0 };
    const eligibleRows = Array.isArray(audience?.rows) ? audience.rows : [];
    const groups = groupByFixture(eligibleRows);
    const fixtures = [...groups.entries()].slice(0, Math.max(1, Number(maxFixturesPerRun || 12)));
    const truncated = Boolean(page?.truncated || groups.size > fixtures.length);

    let significant = 0;
    let sent = 0;
    let failed = 0;
    let unknown = 0;
    let claimed = 0;

    for (const [fixtureId, recipients] of fixtures) {
      let snapshots = [];
      try {
        snapshots = await getOddsSnapshots(fixtureId, cfg, 12);
      } catch {
        failed += 1;
        continue;
      }

      const movement = movementFromSnapshots(snapshots);
      if (!movement.significant) continue;
      significant += 1;

      for (const row of recipients) {
        try {
          const delivery = await deliverClaimedReminder(row, 'important_change', changeMessage(row, movement), cfg);
          if (delivery.state === 'sent') sent += 1;
          else if (delivery.state === 'already_claimed') claimed += 1;
          else if (delivery.state === 'unknown') unknown += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    }

    const summary = {
      ok:!(failed || unknown || truncated),
      checked:rows.length,
      eligible:eligibleRows.length,
      blockedByPreference:Number(audience?.blockedByPreference || 0),
      blockedByEntitlement:Number(audience?.blockedByEntitlement || 0),
      fixturesChecked:fixtures.length,
      significant,
      sent,
      failed,
      unknown,
      claimed,
      truncated,
    };

    if (sent || failed || unknown || truncated) {
      await recordOpsEvent(cfg, {
        severity:failed || unknown || truncated ? 'warning' : 'info',
        source:'important_change_notifications',
        eventType:'important_change_notification_scheduler',
        code:failed ? 'IMPORTANT_CHANGE_RUN_WITH_FAILURES'
          : unknown ? 'IMPORTANT_CHANGE_RUN_WITH_UNKNOWN'
            : truncated ? 'IMPORTANT_CHANGE_RUN_TRUNCATED'
              : 'IMPORTANT_CHANGE_RUN_OK',
        message:`Важные изменения: проверено матчей ${fixtures.length}, сигналов ${significant}, отправлено ${sent}, ошибок ${failed}.`,
        endpoint:'cron:important-change-notifications',
        meta:summary,
      }).catch(()=>{});
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
