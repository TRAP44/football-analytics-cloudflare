// Odds snapshot persistence and market-movement helpers extracted from worker.js.
// Storage and normalization primitives are injected by the composition root.
export function createOddsSnapshotRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Odds snapshot runtime dependencies are required.');
  }
  const {
    hasSupabase,
    memory,
    normalizeThree,
    sanitizeOddsSnapshotsForMovement,
    supaSelectMany,
    supaUpsert,
  } = deps;

  async function getOddsSnapshots(fixtureId, cfg, limit = 12) {
    if (hasSupabase(cfg)) {
      try {
        const rows = await supaSelectMany(cfg, 'odds_snapshots', {
          fixture_id: `eq.${Number(fixtureId)}`,
          market: 'eq.1x2',
        }, { limit, order: 'snapshot_time.desc' });
        return (rows || []).map(x => ({
          at: x.snapshot_time,
          home: Number(x.home_odd), draw: Number(x.draw_odd), away: Number(x.away_odd),
          homeProb: Number(x.home_prob), drawProb: Number(x.draw_prob), awayProb: Number(x.away_prob),
          sources: Number(x.source_count || 0),
        }));
      } catch { return []; }
    }
    return (memory.oddsSnapshots.get(Number(fixtureId)) || []).slice(-limit).reverse();
  }
  
  async function saveOddsSnapshot(fixtureId, market, cfg) {
    if (!market?.odds) return false;
    const previous = await getOddsSnapshots(fixtureId, cfg, 1);
    const prev = previous[0];
    const now = new Date();
    const changed = !prev || ['home','draw','away'].some(k => Math.abs(Number(market.odds[k]) - Number(prev[k])) >= 0.03);
    const oldEnough = !prev?.at || (now.getTime() - Date.parse(prev.at)) >= 120000;
    if (!changed && !oldEnough) return false;
    const p = market.probabilities || {};
    const row = {
      fixture_id: Number(fixtureId), market: '1x2', snapshot_time: now.toISOString(),
      home_odd: Number(market.odds.home), draw_odd: Number(market.odds.draw), away_odd: Number(market.odds.away),
      home_prob: Number(p.home || 0), draw_prob: Number(p.draw || 0), away_prob: Number(p.away || 0),
      source_count: Number(market.sources || market.bookmakers || 0),
      provider: String(market.provider || 'api-football').slice(0, 80),
      bookmaker_count: Number(market.sources || market.bookmakers || 0),
      source_updated_at: Number.isFinite(Date.parse(String(market.updatedAt || ''))) ? String(market.updatedAt) : now.toISOString(),
    };
    if (hasSupabase(cfg)) {
      try { await supaUpsert(cfg, 'odds_snapshots', row); return true; } catch { return false; }
    }
    const list = memory.oddsSnapshots.get(Number(fixtureId)) || [];
    list.push({ at: row.snapshot_time, home: row.home_odd, draw: row.draw_odd, away: row.away_odd, homeProb: row.home_prob, drawProb: row.draw_prob, awayProb: row.away_prob, sources: row.source_count });
    memory.oddsSnapshots.set(Number(fixtureId), list.slice(-50));
    return true;
  }
  
  function buildOddsMovement(snapshots, current) {
    if (!current?.odds) return null;
    const history = sanitizeOddsSnapshotsForMovement(snapshots);
    const baseline = history.length ? history[history.length - 1] : null;
    if (!baseline) return { sample: 1, baseline: null, current: current.odds, probabilityChange: null };
    const currentP = current.probabilities || normalizeThree(1/current.odds.home,1/current.odds.draw,1/current.odds.away) || {};
    const baseP = (baseline.homeProb || baseline.drawProb || baseline.awayProb)
      ? { home: baseline.homeProb, draw: baseline.drawProb, away: baseline.awayProb }
      : normalizeThree(1/baseline.home,1/baseline.draw,1/baseline.away) || {};
    const delta = key => Math.round(((Number(currentP[key] || 0) - Number(baseP[key] || 0)) * 10)) / 10;
    return {
      sample: history.length + 1,
      from: baseline.at,
      baseline: { home: baseline.home, draw: baseline.draw, away: baseline.away },
      current: current.odds,
      probabilityChange: { home: delta('home'), draw: delta('draw'), away: delta('away') },
    };
  }

  return {
    getOddsSnapshots,
    saveOddsSnapshot,
    buildOddsMovement,
  };
}
