// Match formatting and live-data normalization extracted from worker.js.
// Semantic lineup/availability quality logic is injected by the composition root.
export function createMatchFormattingRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Match formatting runtime dependencies are required.');
  }
  const {
    assessLineupQuality,
    normalizeFixtureAbsences,
  } = deps;

  if (typeof assessLineupQuality !== 'function') throw new TypeError('assessLineupQuality is required');
  if (typeof normalizeFixtureAbsences !== 'function') throw new TypeError('normalizeFixtureAbsences is required');

  function rows(value) {
    return Array.isArray(value) ? value : [];
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

  function positiveSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const number=integerCandidate(value);
    return number!==null && number>0 && number<=max ? number : null;
  }

  function nonNegativeSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const number=integerCandidate(value);
    return number!==null && number>=0 && number<=max ? number : null;
  }

  function safeText(value, max = 160) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value).trim().slice(0,max);
  }

  function scoreValue(value) {
    return nonNegativeSafeInteger(value,30);
  }

  function scorePair(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const home=scoreValue(value.home);
    const away=scoreValue(value.away);
    return home === null && away === null ? null : {home,away};
  }

  function teamContext(homeId, awayId) {
    const home=positiveSafeInteger(homeId);
    const away=positiveSafeInteger(awayId);
    return {
      home,
      away,
      valid:Boolean(home && away && home !== away),
    };
  }

  function formatAbsences(rowsInput, homeId, awayId, lineups = null) {
    const teams=teamContext(homeId,awayId);
    return normalizeFixtureAbsences(rows(rowsInput),{
      homeId:teams.home || 0,
      awayId:teams.away || 0,
      lineups:lineups && typeof lineups === 'object' && !Array.isArray(lineups) ? lineups : null,
    });
  }
  function normalizeLineupPlayer(entry) {
    const player=entry?.player;
    if (!player || typeof player !== 'object' || Array.isArray(player)) return null;
    const name=safeText(player.name,120);
    if (!name) return null;
    return {
      id:positiveSafeInteger(player.id),
      name,
      number:positiveSafeInteger(player.number,999),
      pos:safeText(player.pos,24),
      grid:safeText(player.grid,32),
      photo:safeText(player.photo,1000),
    };
  }
  
  function formatLineups(rowsInput, homeId, awayId) {
    const out={home:null,away:null};
    const teams=teamContext(homeId,awayId);
    if (!teams.valid) return out;
    for (const entry of rows(rowsInput)) {
      const teamId=positiveSafeInteger(entry?.team?.id);
      const side=teamId===teams.home ? 'home' : teamId===teams.away ? 'away' : '';
      if (!side) continue;
      const lineup={
        formation:safeText(entry?.formation,32),
        coach:safeText(entry?.coach?.name,120),
        coachPhoto:safeText(entry?.coach?.photo,1000),
        startXI:rows(entry?.startXI).map(normalizeLineupPlayer).filter(Boolean).slice(0,30),
        substitutes:rows(entry?.substitutes).map(normalizeLineupPlayer).filter(Boolean).slice(0,40),
      };
      const quality=assessLineupQuality(lineup);
      lineup.quality=quality && typeof quality === 'object' && !Array.isArray(quality)
        ? quality
        : {state:'unavailable',published:false,confirmed:false,partial:false,score:0,warnings:['Некорректная оценка состава.']};
      const current=out[side];
      const currentScore=Number(current?.quality?.score);
      const nextScore=Number(lineup?.quality?.score);
      if (!current || (Number.isFinite(nextScore) && (!Number.isFinite(currentScore) || nextScore>currentScore))) {
        out[side]=lineup;
      }
    }
    return out;
  }
  function formatH2H(rowsInput, homeId, awayId) {
    let homeWins=0,draws=0,awayWins=0;
    const matches=[];
    const seenFixtureIds=new Set();
    const teams=teamContext(homeId,awayId);
    if (!teams.valid) return {homeWins,draws,awayWins,matches};
    for (const entry of rows(rowsInput)) {
      const finishedStatus=safeText(
        entry?.fixture?.status?.short,
        16,
      ).toUpperCase();
      if (!isFinishedStatus(finishedStatus)) continue;
      const fixtureId=positiveSafeInteger(entry?.fixture?.id);
      if (fixtureId && seenFixtureIds.has(fixtureId)) continue;
      if (fixtureId) seenFixtureIds.add(fixtureId);
      const rowHomeId=positiveSafeInteger(entry?.teams?.home?.id);
      const rowAwayId=positiveSafeInteger(entry?.teams?.away?.id);
      if (!rowHomeId || !rowAwayId || rowHomeId===rowAwayId) continue;
      const containsBoth=(rowHomeId===teams.home && rowAwayId===teams.away)
        || (rowHomeId===teams.away && rowAwayId===teams.home);
      if (!containsBoth) continue;

      const homeGoals=scoreValue(entry?.goals?.home);
      const awayGoals=scoreValue(entry?.goals?.away);
      if (homeGoals === null || awayGoals === null) continue;

      let winnerId=null;
      const homeWinner=entry?.teams?.home?.winner;
      const awayWinner=entry?.teams?.away?.winner;
      if (
        finishedStatus==='PEN'
        && homeWinner === true
        && awayWinner !== true
      ) winnerId=rowHomeId;
      else if (
        finishedStatus==='PEN'
        && awayWinner === true
        && homeWinner !== true
      ) winnerId=rowAwayId;
      else if (homeGoals>awayGoals) winnerId=rowHomeId;
      else if (awayGoals>homeGoals) winnerId=rowAwayId;

      if (winnerId===teams.home) homeWins+=1;
      else if (winnerId===teams.away) awayWins+=1;
      else draws+=1;

      const date=safeText(entry?.fixture?.date,80);
      matches.push({
        date,
        dateMs:Number.isFinite(Date.parse(date)) ? Date.parse(date) : null,
        home:safeText(entry?.teams?.home?.name,120),
        away:safeText(entry?.teams?.away?.name,120),
        score:`${homeGoals}:${awayGoals}`,
      });
    }
    matches.sort((a,b)=>(b.dateMs ?? -Infinity)-(a.dateMs ?? -Infinity));
    return {
      homeWins,
      draws,
      awayWins,
      matches:matches.slice(0,5).map(({dateMs,...match})=>match),
    };
  }
  
  const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
  const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
  
  function isLiveStatus(status) { return LIVE_STATUSES.has(safeText(status,16).toUpperCase()); }
  function isFinishedStatus(status) { return FINISHED_STATUSES.has(safeText(status,16).toUpperCase()); }
  
  function statusLabel(status, elapsed) {
    const s=safeText(status,16).toUpperCase();
    const labels={
      NS:'Не начался',TBD:'Время уточняется','1H':'1-й тайм',HT:'Перерыв','2H':'2-й тайм',
      ET:'Доп. время',BT:'Перерыв',P:'Пенальти',INT:'Прерван',LIVE:'Матч идёт',
      FT:'Завершён',AET:'Завершён после доп. времени',PEN:'Завершён по пенальти',
      SUSP:'Приостановлен',PST:'Перенесён',CANC:'Отменён',ABD:'Прерван',AWD:'Тех. результат',WO:'Без игры',
    };
    const base=labels[s] || s || 'Статус неизвестен';
    const minute=nonNegativeSafeInteger(elapsed,180);
    return isLiveStatus(s) && minute !== null ? `${base} · ${minute}′` : base;
  }
  
  function normalizeStatValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' || typeof value === 'bigint') {
      const text=String(value).trim().slice(0,80);
      return text || null;
    }
    return null;
  }
  
  const STAT_KEYS = [
    ['Ball Possession', 'Владение'],
    ['Total Shots', 'Удары'],
    ['Shots on Goal', 'В створ'],
    ['Shots off Goal', 'Мимо'],
    ['Blocked Shots', 'Блокированные'],
    ['Corner Kicks', 'Угловые'],
    ['Offsides', 'Офсайды'],
    ['Fouls', 'Фолы'],
    ['Yellow Cards', 'Жёлтые'],
    ['Red Cards', 'Красные'],
    ['Goalkeeper Saves', 'Сейвы'],
    ['Total passes', 'Передачи'],
    ['Passes accurate', 'Точные передачи'],
    ['Passes %', 'Точность передач'],
    ['expected_goals', 'xG'],
  ];
  
  function formatLiveStatistics(rowsInput, homeId, awayId) {
    const teams=teamContext(homeId,awayId);
    const empty=id=>({teamId:id,teamName:'',values:{}});
    if (!teams.valid) return {home:empty(teams.home),away:empty(teams.away),items:[]};

    const byTeam=new Map();
    for (const row of rows(rowsInput)) {
      const id=positiveSafeInteger(row?.team?.id);
      if (id !== teams.home && id !== teams.away) continue;
      const values={};
      for (const stat of rows(row?.statistics)) {
        const key=safeText(stat?.type,80);
        if (!key) continue;
        const value=normalizeStatValue(stat?.value);
        if (value !== null) values[key]=value;
      }
      byTeam.set(id,{
        teamId:id,
        teamName:safeText(row?.team?.name,120),
        values,
      });
    }
    const home=byTeam.get(teams.home) || empty(teams.home);
    const away=byTeam.get(teams.away) || empty(teams.away);
    const items=STAT_KEYS.map(([key,label])=>({
      key,
      label,
      home:home.values[key] ?? null,
      away:away.values[key] ?? null,
    })).filter(item=>item.home !== null || item.away !== null);
    return {home,away,items};
  }
  
  function translateEvent(type, detail) {
    const rawType=safeText(type,80);
    const rawDetail=safeText(detail,160);
    const t=rawType.toLowerCase();
    const d=rawDetail.toLowerCase();
    if (t === 'goal') {
      if (d.includes('own')) return '⚽ Автогол';
      if (d.includes('missed')) return '❌ Незабитый пенальти';
      if (d.includes('penalty')) return '⚽ Гол с пенальти';
      return '⚽ Гол';
    }
    if (t === 'card') {
      if (d.includes('red')) return '🟥 Красная карточка';
      if (d.includes('second yellow')) return '🟥 Вторая жёлтая';
      return '🟨 Жёлтая карточка';
    }
    if (t === 'subst') return '🔄 Замена';
    if (t === 'var') return '📺 Видеопросмотр';
    return rawDetail || rawType || 'Событие';
  }
  
  function formatLiveEvents(rowsInput, homeId, awayId) {
    const teams=teamContext(homeId,awayId);
    return rows(rowsInput).map((event,index)=>{
      const minute=nonNegativeSafeInteger(event?.time?.elapsed,180);
      const extra=nonNegativeSafeInteger(event?.time?.extra,30) ?? 0;
      const teamId=positiveSafeInteger(event?.team?.id);
      const side=teams.valid
        ? teamId===teams.home ? 'home' : teamId===teams.away ? 'away' : ''
        : '';
      const type=safeText(event?.type,80);
      const detail=safeText(event?.detail,160);
      return {
        id:`${minute !== null ? minute : '?'}-${extra}-${index}`,
        minute,
        extra,
        teamId,
        side,
        teamName:safeText(event?.team?.name,120),
        player:safeText(event?.player?.name,120),
        assist:safeText(event?.assist?.name,120),
        type,
        detail,
        label:translateEvent(type,detail),
        comments:safeText(event?.comments,500),
      };
    }).sort((a,b)=>{
      const am=a.minute === null ? Number.MAX_SAFE_INTEGER : a.minute;
      const bm=b.minute === null ? Number.MAX_SAFE_INTEGER : b.minute;
      return am-bm || a.extra-b.extra;
    });
  }
  
  function scoreSnapshot(fixture) {
    return {
      home:scoreValue(fixture?.goals?.home),
      away:scoreValue(fixture?.goals?.away),
      halftime:scorePair(fixture?.score?.halftime),
      fulltime:scorePair(fixture?.score?.fulltime),
      extratime:scorePair(fixture?.score?.extratime),
      penalty:scorePair(fixture?.score?.penalty),
    };
  }
  
  function embeddedLiveData(fixture) {
    return {
      events:rows(fixture?.events),
      lineups:rows(fixture?.lineups),
      statistics:rows(fixture?.statistics),
      players:rows(fixture?.players),
    };
  }
  
  
  
  const PUBLIC_LIVE_STATUSES=new Set(LIVE_STATUSES);
  const PUBLIC_FINISHED_STATUSES=new Set(FINISHED_STATUSES);
  const PUBLIC_STAT_KEYS=Object.freeze(STAT_KEYS.map(entry=>Object.freeze([...entry])));

  return Object.freeze({
    formatAbsences,
    normalizeLineupPlayer,
    formatLineups,
    formatH2H,
    LIVE_STATUSES:PUBLIC_LIVE_STATUSES,
    FINISHED_STATUSES:PUBLIC_FINISHED_STATUSES,
    isLiveStatus,
    isFinishedStatus,
    statusLabel,
    normalizeStatValue,
    STAT_KEYS:PUBLIC_STAT_KEYS,
    formatLiveStatistics,
    translateEvent,
    formatLiveEvents,
    scoreSnapshot,
    embeddedLiveData,
  });
}
