// Odds parsing, probability normalization and numeric market helpers extracted from worker.js.
export function createMarketParsingRuntime() {
  function parsePercent(value) {
    const num = Number(String(value ?? '').replaceAll('%', '').replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function normalizeThree(a, b, c) {
    const sum = a + b + c;
    if (!sum) return null;
    return { home: round1(a / sum * 100), draw: round1(b / sum * 100), away: round1(c / sum * 100) };
  }

  function decimalOdd(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const raw=typeof value === 'number' ? String(value) : value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) && number>1 && number<=1000 ? number : null;
  }
  function extractMarket(oddsRows) {
    const samples = [];
    for (const row of oddsRows || []) {
      for (const bookmaker of row.bookmakers || []) {
        const bet = (bookmaker.bets || []).find(b => String(b.name || '').toLowerCase().includes('match winner'));
        if (!bet) continue;
        const vals = bet.values || [];
        const home = decimalOdd(vals.find(v => String(v.value).toLowerCase() === 'home')?.odd);
        const draw = decimalOdd(vals.find(v => String(v.value).toLowerCase() === 'draw')?.odd);
        const away = decimalOdd(vals.find(v => String(v.value).toLowerCase() === 'away')?.odd);
        if (home !== null && draw !== null && away !== null) samples.push({ home, draw, away });
      }
    }
    if (!samples.length) return null;
    const avg = key => samples.reduce((s, x) => s + x[key], 0) / samples.length;
    const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
    return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), bookmakers: samples.length, sources: samples.length, provider: 'api-football' };
  }
  function extractLiveMarket(rows) {
    const candidates = [];
    const pushValues = (name, values, update = '') => {
      const key = String(name || '').toLowerCase();
      if (!/(match winner|winner|1x2|fulltime result|full time result)/i.test(key)) return;
      let home = null, draw = null, away = null;
      for (const v of values || []) {
        const label = String(v.value ?? v.name ?? v.label ?? '').trim().toLowerCase();
        const odd = decimalOdd(v.odd ?? v.odds ?? v.price);
        if (odd === null) continue;
        if (['home','1'].includes(label) || label.includes('home')) home = odd;
        else if (['draw','x'].includes(label) || label.includes('draw')) draw = odd;
        else if (['away','2'].includes(label) || label.includes('away')) away = odd;
      }
      if (home && draw && away) candidates.push({ home, draw, away, update });
    };
    for (const row of rows || []) {
      const update = row.update || row.updated_at || row.updatedAt || '';
      for (const bet of row.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
      for (const bookmaker of row.bookmakers || []) {
        for (const bet of bookmaker.bets || bookmaker.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
      }
    }
    if (!candidates.length) return null;
    const avg = key => candidates.reduce((sum, x) => sum + x[key], 0) / candidates.length;
    const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
    return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), sources: candidates.length, provider: 'api-football', updatedAt: candidates.find(x => x.update)?.update || '' };
  }
  
  
  function numericValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replaceAll('%', '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  return {
    parsePercent,
    round1,
    normalizeThree,
    extractMarket,
    extractLiveMarket,
    numericValue,
  };
}
