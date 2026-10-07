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

  const requiredFunctions={
    hasSupabase,
    numericValue,
    supaSelectMany,
    supaUpsert,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  if (!(memory.refereeMatchHistory instanceof Map)) {
    throw new TypeError('memory.refereeMatchHistory must be a Map');
  }

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function safeText(value, max = 180) {
    if (typeof value !== 'string') return '';
    return value
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  }

  function canonicalDate(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const raw=value.trim();
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(raw);
    if (!match) return null;

    const year=Number(match[1]);
    const month=Number(match[2]);
    const day=Number(match[3]);
    const hour=Number(match[4]);
    const minute=Number(match[5]);
    const second=Number(match[6] || 0);
    const offsetHour=match[8].toUpperCase()==='Z' ? 0 : Number(match[10]);
    const offsetMinute=match[8].toUpperCase()==='Z' ? 0 : Number(match[11]);
    if (
      month < 1 || month > 12
      || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate()
      || hour > 23
      || minute > 59
      || second > 59
      || offsetHour > 14
      || offsetMinute > 59
      || (offsetHour === 14 && offsetMinute !== 0)
    ) return null;

    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  function numericCandidate(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function boundedMetric(value, max) {
    const number=numericCandidate(value);
    return number !== null && number >= 0 && number <= max ? number : null;
  }

  function providerMetric(value, max = 100) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    try {
      return boundedMetric(numericValue(value),max);
    } catch {
      return null;
    }
  }

  function useSupabase(cfg) {
    try {
      return hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function refereeProfile(value = '') {
    const raw=safeText(value,320);
    if (!raw) return {name:'',country:'',available:false};

    const separator=raw.indexOf(',');
    const name=safeText(separator >= 0 ? raw.slice(0,separator) : raw,180);
    const country=safeText(separator >= 0 ? raw.slice(separator+1) : '',120);
    return {
      name,
      country,
      available:Boolean(name),
    };
  }

  function refereeHistoryKey(value = '') {
    const profile=refereeProfile(value);
    if (!profile.available) return '';
    return profile.name
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/\s+/g,' ')
      .trim();
  }

  function refereeCardSummary(events = [], statistics = null) {
    const eventRows=rows(events).slice(0,500);
    let yellow=0;
    let red=0;

    for (const event of eventRows) {
      if (safeText(event?.type,40).toLowerCase() !== 'card') continue;
      const detail=safeText(event?.detail,120).toLowerCase();
      if (detail.includes('red') || detail.includes('second yellow')) red+=1;
      else if (detail.includes('yellow')) yellow+=1;
    }

    const statisticItems=rows(statistics?.items);
    const foulRow=statisticItems.find(
      item=>safeText(item?.key,80).toLowerCase() === 'fouls',
    );
    const homeFouls=foulRow ? providerMetric(foulRow?.home,100) : null;
    const awayFouls=foulRow ? providerMetric(foulRow?.away,100) : null;
    const observedCards=eventRows.length > 0;
    const observedFouls=homeFouls !== null && awayFouls !== null;
    const fouls=observedFouls
      ? Math.max(0,Math.round(homeFouls+awayFouls))
      : 0;

    return {
      yellow,
      red,
      fouls,
      observedCards,
      observedFouls,
      verified:Boolean(observedCards && observedFouls),
    };
  }

  async function saveRefereeMatchHistory({
    fixtureId,
    referee,
    kickoffAt,
    leagueId,
    events,
    statistics,
  } = {}, cfg) {
    const fixtureKey=positiveSafeInteger(fixtureId);
    const profile=refereeProfile(referee);
    const key=refereeHistoryKey(referee);
    const kickoff=canonicalDate(kickoffAt);
    if (!fixtureKey || !profile.available || !key || !kickoff) return false;

    const cards=refereeCardSummary(events,statistics);
    // Do not persist partial evidence. A verified zero-card match is valid and
    // must remain in the sample so referee averages are not biased upward.
    if (!cards.verified) return false;

    const now=new Date().toISOString();
    const row={
      fixture_id:fixtureKey,
      referee_key:key,
      referee_name:profile.name,
      referee_country:profile.country,
      kickoff_at:kickoff,
      league_id:positiveSafeInteger(leagueId),
      yellow_cards:cards.yellow,
      red_cards:cards.red,
      fouls:cards.fouls,
      updated_at:now,
    };

    if (useSupabase(cfg)) {
      await supaUpsert(cfg,'referee_match_history',row,'fixture_id');
      return true;
    }

    const existing=memory.refereeMatchHistory.get(fixtureKey);
    memory.refereeMatchHistory.set(fixtureKey,{
      ...row,
      created_at:canonicalDate(existing?.created_at) || now,
    });
    return true;
  }

  function normalizedHistoryRow(row, expectedKey, expectedCountry = '', now = Date.now()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;

    const fixtureId=positiveSafeInteger(row?.fixture_id);
    const rowKey=refereeHistoryKey(row?.referee_name || '');
    const storedKey=safeText(row?.referee_key,180)
      .toLocaleLowerCase('en-US')
      .replace(/\s+/g,' ')
      .trim();
    const key=storedKey || rowKey;
    if (!fixtureId || !key || key !== expectedKey || (rowKey && rowKey !== expectedKey)) {
      return null;
    }

    const requestedCountry=safeText(expectedCountry,120).toLocaleLowerCase('en-US');
    const rowCountry=safeText(row?.referee_country,120).toLocaleLowerCase('en-US');
    if (requestedCountry && rowCountry !== requestedCountry) return null;

    const kickoffAt=canonicalDate(row?.kickoff_at);
    const kickoffMs=Date.parse(kickoffAt || '');
    if (!kickoffAt || !Number.isFinite(kickoffMs) || kickoffMs > now + 5*60_000) {
      return null;
    }

    const yellow=boundedMetric(row?.yellow_cards,30);
    const red=boundedMetric(row?.red_cards,15);
    const fouls=boundedMetric(row?.fouls,100);
    if (yellow === null || red === null || fouls === null) return null;

    return {
      fixtureId,
      kickoffAt,
      kickoffMs,
      yellow,
      red,
      fouls,
    };
  }

  function boundedHistoryLimit(value) {
    const parsed=positiveSafeInteger(value);
    return Math.max(3,Math.min(50,parsed || 30));
  }

  async function loadRefereeHistoryProfile(referee, cfg, limit = 30) {
    const profile=refereeProfile(referee);
    const key=refereeHistoryKey(referee);
    if (!profile.available || !key) {
      return {
        available:false,
        sample:0,
        name:profile.name,
        country:profile.country,
      };
    }

    const requestedLimit=boundedHistoryLimit(limit);
    let sourceRows=[];
    try {
      if (useSupabase(cfg)) {
        sourceRows=rows(await supaSelectMany(
          cfg,
          'referee_match_history',
          {referee_key:`eq.${key}`},
          {limit:requestedLimit,order:'kickoff_at.desc'},
        ));
      } else {
        sourceRows=[...memory.refereeMatchHistory.values()];
      }
    } catch {
      sourceRows=[];
    }

    const now=Date.now();
    const seenFixtures=new Set();
    const normalized=[];
    for (const row of sourceRows) {
      const item=normalizedHistoryRow(row,key,profile.country,now);
      if (!item || seenFixtures.has(item.fixtureId)) continue;
      seenFixtures.add(item.fixtureId);
      normalized.push(item);
    }
    normalized.sort((a,b)=>b.kickoffMs-a.kickoffMs);
    const history=normalized.slice(0,requestedLimit);
    const sample=history.length;

    if (!sample) {
      return {
        available:false,
        sample:0,
        name:profile.name,
        country:profile.country,
      };
    }

    const average=field=>
      Math.round(
        (history.reduce((sum,row)=>sum+row[field],0)/sample)*10,
      )/10;

    const avgYellow=average('yellow');
    const avgRed=average('red');
    const avgFouls=average('fouls');
    const avgCards=Math.round((avgYellow+avgRed)*10)/10;
    const styleLabel=avgCards>=5.5
      ? 'Строгий стиль'
      : avgCards<=3.5
        ? 'Сдержанный стиль'
        : 'Средняя строгость';

    return {
      available:sample>=3,
      sample,
      name:profile.name,
      country:profile.country,
      avgYellow,
      avgRed,
      avgFouls,
      avgCards,
      styleLabel,
      source:'verified-match-history',
    };
  }

  return Object.freeze({
    refereeProfile,
    refereeHistoryKey,
    refereeCardSummary,
    saveRefereeMatchHistory,
    loadRefereeHistoryProfile,
  });
}
