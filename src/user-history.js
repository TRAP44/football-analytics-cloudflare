export function createUserHistoryService({
  memory,
  hasSupabase,
  supaUpsert,
  supaSelectMany,
}) {
  async function recordHistory(userId, payload, cfg) {
    const match = payload?.match;
    const instructor = payload?.aiInstructor || {};
    const verdict = instructor?.verdict || {};
    const signal = instructor?.betSignal || {};
    if (!match?.fixtureId) return;
    const row = {
      telegram_id: Number(userId),
      fixture_id: Number(match.fixtureId),
      home_name: match.home?.name || '',
      away_name: match.away?.name || '',
      league_name: match.league || '',
      fixture_date: match.date || null,
      home_logo: match.home?.logo || null,
      away_logo: match.away?.logo || null,
      ai_signal_code: String(signal.code || '').slice(0,40),
      ai_signal_label: String(signal.label || '').slice(0,160),
      ai_confidence: Number.isFinite(Number(instructor.confidenceScore))
        ? Math.max(0, Math.min(100, Math.round(Number(instructor.confidenceScore))))
        : null,
      ai_risk: String(instructor.riskLabel || '').slice(0,60),
      ai_outcome: String(verdict.outcome || '').slice(0,80),
      ai_total: String(verdict.total || '').slice(0,80),
      ai_btts: String(verdict.btts || '').slice(0,80),
      analysis_version: String(payload?.analysisVersion || '').slice(0,80),
      viewed_at: new Date().toISOString(),
    };
    if (hasSupabase(cfg)) {
      try {
        await supaUpsert(cfg, 'analysis_history', row, 'telegram_id,fixture_id');
      } catch (e) {
        console.warn('history write skipped', e?.message || e);
      }
      return;
    }
    const key = Number(userId);
    const list = memory.history.get(key) || [];
    const next = [row, ...list.filter(x => Number(x.fixture_id) !== Number(row.fixture_id))].slice(0,20);
    memory.history.set(key, next);
  }

  async function getHistory(userId, cfg) {
    if (hasSupabase(cfg)) {
      try {
        return await supaSelectMany(
          cfg,
          'analysis_history',
          { telegram_id: `eq.${Number(userId)}` },
          { limit:20, order:'viewed_at.desc' },
        );
      } catch (e) {
        console.warn('history read skipped', e?.message || e);
        return [];
      }
    }
    return memory.history.get(Number(userId)) || [];
  }

  return {
    recordHistory,
    getHistory,
  };
}
