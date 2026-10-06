// Referee profile and verified match-history intelligence extracted from worker.js.
// Persistence and numeric normalization are injected by the composition root.
export function createRefereeIntelligenceRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Referee intelligence runtime dependencies are required.');
  }
  const {
    hasSupabase,
    memory,
    numericValue,
    supaSelectMany,
    supaUpsert,
  } = deps;

  function refereeProfile(value = '') {
    const raw=String(value || '').trim();
    if(!raw) return {name:'',country:'',available:false};
    const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
    return {name:parts[0] || raw,country:parts.slice(1).join(', '),available:true};
  }

  function refereeHistoryKey(value = '') {
    const profile = refereeProfile(value);
    return String(profile.name || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ');
  }

  function refereeCardSummary(events = [], statistics = null) {
    let yellow = 0, red = 0;
    for (const event of events || []) {
      if (String(event?.type || '').toLowerCase() !== 'card') continue;
      const detail = String(event?.detail || '').toLowerCase();
      if (detail.includes('red') || detail.includes('second yellow')) red += 1;
      else if (detail.includes('yellow')) yellow += 1;
    }
    const foulRow = (statistics?.items || []).find(x => x.key === 'Fouls');
    const homeFouls = numericValue(foulRow?.home) || 0;
    const awayFouls = numericValue(foulRow?.away) || 0;
    return { yellow, red, fouls: Math.max(0, Math.round(homeFouls + awayFouls)) };
  }

  async function saveRefereeMatchHistory({ fixtureId, referee, kickoffAt, leagueId, events, statistics } = {}, cfg) {
    const profile = refereeProfile(referee);
    const key = refereeHistoryKey(referee);
    if (!fixtureId || !profile.available || !key) return false;
    const cards = refereeCardSummary(events, statistics);
    if (!cards.yellow && !cards.red && !cards.fouls) return false;
    const row = { fixture_id:Number(fixtureId), referee_key:key, referee_name:profile.name, referee_country:profile.country || '', kickoff_at:kickoffAt || null, league_id:Number(leagueId || 0) || null, yellow_cards:cards.yellow, red_cards:cards.red, fouls:cards.fouls, updated_at:new Date().toISOString() };
    if (hasSupabase(cfg)) await supaUpsert(cfg,'referee_match_history',row,'fixture_id');
    else memory.refereeMatchHistory.set(Number(fixtureId), { ...row, created_at:new Date().toISOString() });
    return true;
  }

  async function loadRefereeHistoryProfile(referee, cfg, limit = 30) {
    const profile = refereeProfile(referee);
    const key = refereeHistoryKey(referee);
    if (!profile.available || !key) return { available:false, sample:0, name:profile.name || '', country:profile.country || '' };
    let rows=[];
    try { rows = hasSupabase(cfg) ? await supaSelectMany(cfg,'referee_match_history',{ referee_key:`eq.${key}` },{ limit:Math.max(3,Math.min(50,Number(limit || 30))), order:'kickoff_at.desc' }) : [...memory.refereeMatchHistory.values()].filter(x=>x.referee_key===key).sort((a,b)=>Date.parse(b.kickoff_at || 0)-Date.parse(a.kickoff_at || 0)).slice(0,limit); } catch { rows=[]; }
    const sample=rows.length;
    if (!sample) return { available:false, sample:0, name:profile.name, country:profile.country || '' };
    const avg=field=>Math.round((rows.reduce((sum,row)=>sum+Number(row?.[field] || 0),0)/sample)*10)/10;
    const avgYellow=avg('yellow_cards'), avgRed=avg('red_cards'), avgFouls=avg('fouls');
    const avgCards=Math.round((avgYellow+avgRed)*10)/10;
    const styleLabel=avgCards>=5.5?'Строгий стиль':avgCards<=3.5?'Сдержанный стиль':'Средняя строгость';
    return { available:sample>=3, sample, name:profile.name, country:profile.country || '', avgYellow, avgRed, avgFouls, avgCards, styleLabel, source:'verified-match-history' };
  }

  return {
    refereeProfile,
    refereeHistoryKey,
    refereeCardSummary,
    saveRefereeMatchHistory,
    loadRefereeHistoryProfile,
  };
}
