export function createLineupNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  loadLineupSnapshot,
  deliverClaimedReminder,
  filterNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun = 4,
} = {}) {
  const WINDOW_BEFORE_KICKOFF_MINUTES = 95;
  const WINDOW_AFTER_KICKOFF_MINUTES = 8;

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
      if (!fixtureId || row?.lineup_notified_at) continue;
      const list = groups.get(fixtureId) || [];
      list.push(row);
      groups.set(fixtureId, list);
    }
    return groups;
  }

  function lineupMessage(row, snapshot = {}) {
    const home = String(row?.home_name || snapshot?.homeName || 'Хозяева');
    const away = String(row?.away_name || snapshot?.awayName || 'Гости');
    const league = String(row?.league_name || snapshot?.leagueName || '');
    const kickoff = Date.parse(row?.fixture_date || snapshot?.fixtureDate || '');
    const minutes = Number.isFinite(kickoff)
      ? Math.max(0, Math.round((kickoff - Date.now()) / 60000))
      : null;
    return [
      '👥 Составы опубликованы',
      '',
      `${home} — ${away}`,
      league,
      minutes === null ? '' : minutes > 0 ? `До матча около ${minutes} мин.` : 'Матч уже начинается.',
      '',
      'Оба стартовых состава подтверждены: по 11 уникальных игроков.',
      'Откройте MatchRadar — составы и обновлённый анализ уже доступны.',
    ].filter(Boolean).join('\n');
  }

  async function processLineupNotifications(cfg) {
    if (!hasSupabase?.(cfg) || !cfg?.botToken) {
      return { ok:true, checked:0, fixturesChecked:0, confirmed:0, sent:0, failed:0, unknown:0, claimed:0, truncated:false };
    }

    const runtime = await loadRuntimeControls(cfg);
    if (runtime?.value?.remindersEnabled === false) {
      return { ok:true, checked:0, fixturesChecked:0, confirmed:0, sent:0, failed:0, unknown:0, claimed:0, truncated:false, disabled:true };
    }

    const now = Date.now();
    const window = candidateWindow(now);
    let page;
    try {
      page = await supaSelectPaged(cfg, 'match_reminders', {
        enabled:'eq.true',
        lineup_notified_at:'is.null',
        and:`(fixture_date.gte.${window.from},fixture_date.lte.${window.to})`,
      }, {
        pageSize:250,
        maxRows:1000,
        order:'fixture_date.asc,fixture_id.asc,telegram_id.asc',
      });
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code:'LINEUP_NOTIFICATION_READ_FAILED',
        message:error?.message || error,
        endpoint:'cron:lineup-notifications',
      }).catch(()=>{});
      return { ok:false, checked:0, fixturesChecked:0, confirmed:0, sent:0, failed:1, unknown:0, claimed:0, truncated:false };
    }

    const rows = Array.isArray(page?.rows) ? page.rows : [];
    const audience = typeof filterNotificationRecipients === 'function'
      ? await filterNotificationRecipients(rows, 'match.lineup', cfg)
      : { rows, blockedByPreference:0, blockedByEntitlement:0 };
    const eligibleRows = Array.isArray(audience?.rows) ? audience.rows : [];
    const groups = groupByFixture(eligibleRows);
    const fixtures = [...groups.entries()].slice(0, Math.max(1, Number(maxFixturesPerRun || 4)));
    const truncated = Boolean(page?.truncated || groups.size > fixtures.length);
    let confirmed = 0;
    let sent = 0;
    let failed = 0;
    let unknown = 0;
    let claimed = 0;

    for (const [fixtureId, recipients] of fixtures) {
      let snapshot;
      try {
        snapshot = await loadLineupSnapshot(fixtureId, cfg);
      } catch (error) {
        failed += 1;
        await recordOpsEvent(cfg, {
          severity:'warning',
          source:'lineup_notifications',
          eventType:'lineup_notification_probe',
          code:'LINEUP_NOTIFICATION_PROBE_FAILED',
          message:error?.message || error,
          endpoint:'cron:lineup-notifications',
          meta:{ fixtureId },
        }).catch(()=>{});
        continue;
      }

      if (!snapshot?.confirmed) continue;
      confirmed += 1;

      for (const row of recipients) {
        try {
          const delivery = await deliverClaimedReminder(row, 'lineup', lineupMessage(row, snapshot), cfg);
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
      ok: !(failed || unknown || truncated),
      checked: rows.length,
      eligible: eligibleRows.length,
      blockedByPreference:Number(audience?.blockedByPreference || 0),
      blockedByEntitlement:Number(audience?.blockedByEntitlement || 0),
      fixturesChecked: fixtures.length,
      confirmed,
      sent,
      failed,
      unknown,
      claimed,
      truncated,
    };

    if (sent || failed || unknown || truncated) {
      await recordOpsEvent(cfg, {
        severity: failed || unknown || truncated ? 'warning' : 'info',
        source:'lineup_notifications',
        eventType:'lineup_notification_scheduler',
        code: failed ? 'LINEUP_NOTIFICATION_RUN_WITH_FAILURES'
          : unknown ? 'LINEUP_NOTIFICATION_RUN_WITH_UNKNOWN'
            : truncated ? 'LINEUP_NOTIFICATION_RUN_TRUNCATED'
              : 'LINEUP_NOTIFICATION_RUN_OK',
        message:`Составы: проверено матчей ${fixtures.length}, подтверждено ${confirmed}, отправлено ${sent}, ошибок ${failed}.`,
        endpoint:'cron:lineup-notifications',
        meta:summary,
      }).catch(()=>{});
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
