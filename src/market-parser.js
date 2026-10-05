export function createMarketParserRuntime({ round1, normalizeThree } = {}) {
  function parsePercent(value) {
    const num = Number(String(value ?? '').replaceAll('%', '').replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }

  function extractMarket(oddsRows) {
    const samples = [];
    for (const row of oddsRows || []) {
      for (const bookmaker of row.bookmakers || []) {
        const bet = (bookmaker.bets || []).find(b => String(b.name || '').toLowerCase().includes('match winner'));
        if (!bet) continue;
        const vals = bet.values || [];
        const home = Number(vals.find(v => String(v.value).toLowerCase() === 'home')?.odd);
        const draw = Number(vals.find(v => String(v.value).toLowerCase() === 'draw')?.odd);
        const away = Number(vals.find(v => String(v.value).toLowerCase() === 'away')?.odd);
        if (home > 1 && draw > 1 && away > 1) samples.push({ home, draw, away });
      }
    }
    if (!samples.length) return null;
    const avg = key => samples.reduce((s, x) => s + x[key], 0) / samples.length;
    const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
    return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), bookmakers: samples.length, sources: samples.length, provider: 'api-football' };
  }

  return Object.freeze({ parsePercent, extractMarket });
}
