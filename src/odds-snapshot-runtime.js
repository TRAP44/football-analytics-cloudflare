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

  function finiteNumber(value) {
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value,max=Number.MAX_SAFE_INTEGER) {
    const number=finiteNumber(value);
    return number !== null
      && Number.isSafeInteger(number)
      && number>0
      && number<=max
      ? number
      : null;
  }

  function decimalOdd(value) {
    const number=finiteNumber(value);
    return number !== null && number>1 && number<=1000 ? number : null;
  }

  function probabilityValue(value) {
    const number=finiteNumber(value);
    return number !== null && number>=0 && number<=100 ? number : null;
  }

  function safeText(value,max=80) {
    return typeof value==='string' ? value.trim().slice(0,max) : '';
  }

  function strictTimestamp(value) {
    if (value instanceof Date) {
      const ms=value.getTime();
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    if (typeof value!=='string' || !value.trim()) return null;
    const raw=value.trim();
    const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
    if (!calendar) return null;
    const year=Number(calendar[1]);
    const month=Number(calendar[2]);
    const day=Number(calendar[3]);
    if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day>maxDay) return null;
    if (
      raw.length>10
      && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    ) return null;
    const ms=Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  function canonicalProbabilities(odds) {
    try {
      const value=normalizeThree(1/odds.home,1/odds.draw,1/odds.away);
      if (!value || typeof value!=='object' || Array.isArray(value)) return null;
      const home=probabilityValue(value.home);
      const draw=probabilityValue(value.draw);
      const away=probabilityValue(value.away);
      if ([home,draw,away].some(number=>number===null)) return null;
      const sum=home+draw+away;
      if (!Number.isFinite(sum) || Math.abs(sum-100)>1.5) return null;
      return {home,draw,away};
    } catch {
      return null;
    }
  }

  function marketSourceCount(market) {
    const candidates=[market?.sources,market?.bookmakers];
    for (const candidate of candidates) {
      if (candidate===undefined || candidate===null || candidate==='') continue;
      return positiveSafeInteger(candidate,10000);
    }
    return null;
  }

  function marketProvider(value) {
    if (value===undefined || value===null || value==='') return 'api-football';
    return safeText(value,80) || null;
  }

  function normalizedSnapshotRow(row) {
    if (!row || typeof row!=='object' || Array.isArray(row)) return null;
    const at=strictTimestamp(row.snapshot_time);
    const home=decimalOdd(row.home_odd);
    const draw=decimalOdd(row.draw_odd);
    const away=decimalOdd(row.away_odd);
    const sources=positiveSafeInteger(row.source_count,10000);
    if (!at || home===null || draw===null || away===null || sources===null) return null;
    const probabilities=canonicalProbabilities({home,draw,away});
    if (!probabilities) return null;
    return {
      at,
      home,
      draw,
      away,
      homeProb:probabilities.home,
      drawProb:probabilities.draw,
      awayProb:probabilities.away,
      sources,
    };
  }

  async function getOddsSnapshots(fixtureId, cfg, limit = 12) {
    const normalizedFixtureId=positiveSafeInteger(fixtureId);
    if (normalizedFixtureId===null) return [];
    const normalizedLimit=positiveSafeInteger(limit,100) || 12;
    if (hasSupabase(cfg)) {
      try {
        const rows = await supaSelectMany(cfg, 'odds_snapshots', {
          fixture_id: `eq.${normalizedFixtureId}`,
          market: 'eq.1x2',
        }, { limit:normalizedLimit, order: 'snapshot_time.desc' });
        return (Array.isArray(rows) ? rows : [])
          .map(normalizedSnapshotRow)
          .filter(Boolean);
      } catch { return []; }
    }
    return (memory.oddsSnapshots.get(normalizedFixtureId) || []).slice(-normalizedLimit).reverse();
  }
  
  async function saveOddsSnapshot(fixtureId, market, cfg) {
    const normalizedFixtureId=positiveSafeInteger(fixtureId);
    if (
      normalizedFixtureId===null
      || !market
      || typeof market!=='object'
      || Array.isArray(market)
      || !market.odds
      || typeof market.odds!=='object'
      || Array.isArray(market.odds)
    ) return false;

    const odds={
      home:decimalOdd(market.odds.home),
      draw:decimalOdd(market.odds.draw),
      away:decimalOdd(market.odds.away),
    };
    if (Object.values(odds).some(value=>value===null)) return false;

    const sources=marketSourceCount(market);
    const provider=marketProvider(market.provider);
    const probabilities=canonicalProbabilities(odds);
    if (sources===null || !provider || !probabilities) return false;

    const previous = await getOddsSnapshots(normalizedFixtureId, cfg, 1);
    const prev = previous[0];
    const now = new Date();
    const changed = !prev || ['home','draw','away'].some(k => {
      const previousOdd=decimalOdd(prev?.[k]);
      return previousOdd===null || Math.abs(odds[k]-previousOdd)>=0.03;
    });
    const previousAt=strictTimestamp(prev?.at);
    const oldEnough = !previousAt || (now.getTime() - Date.parse(previousAt)) >= 120000;
    if (!changed && !oldEnough) return false;

    const sourceUpdatedAt=market.updatedAt===undefined
      || market.updatedAt===null
      || market.updatedAt===''
      ? null
      : strictTimestamp(market.updatedAt);

    const row = {
      fixture_id: normalizedFixtureId,
      market: '1x2',
      snapshot_time: now.toISOString(),
      home_odd: odds.home,
      draw_odd: odds.draw,
      away_odd: odds.away,
      home_prob: probabilities.home,
      draw_prob: probabilities.draw,
      away_prob: probabilities.away,
      source_count: sources,
      provider,
      bookmaker_count: sources,
      source_updated_at: sourceUpdatedAt,
    };
    if (hasSupabase(cfg)) {
      try { await supaUpsert(cfg, 'odds_snapshots', row); return true; } catch { return false; }
    }
    const list = memory.oddsSnapshots.get(normalizedFixtureId) || [];
    list.push({
      at: row.snapshot_time,
      home: row.home_odd,
      draw: row.draw_odd,
      away: row.away_odd,
      homeProb: row.home_prob,
      drawProb: row.draw_prob,
      awayProb: row.away_prob,
      sources: row.source_count,
    });
    memory.oddsSnapshots.set(normalizedFixtureId, list.slice(-50));
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
