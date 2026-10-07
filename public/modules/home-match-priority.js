const SOON_WINDOW_MS=3*60*60*1000;

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function positiveFixtureId(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function strictKickoffMs(value) {
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!match) return null;
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  if (month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanFieldIsValid(value) {
  return value===undefined
    || value===null
    || typeof value==='boolean';
}

function matchEvidence(value) {
  const match=plainObject(value);
  if (!match) return null;
  const fixtureId=positiveFixtureId(safeRead(match,'fixtureId'));
  const live=safeRead(match,'live');
  const finished=safeRead(match,'finished');
  const youthReserve=safeRead(match,'youthReserve');
  const date=safeRead(match,'date');
  if (!fixtureId) return null;
  if (
    !booleanFieldIsValid(live)
    || !booleanFieldIsValid(finished)
    || !booleanFieldIsValid(youthReserve)
  ) return null;
  if (live===true && finished===true) return null;
  return {
    match,
    fixtureId,
    live:live===true,
    finished:finished===true,
    youthReserve:youthReserve===true,
    date,
  };
}

function scorePart(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>=0 && value<=30
      ? String(value)
      : null;
  }
  if (typeof value!=='string') return null;
  const raw=value.trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>=0 && parsed<=30
    ? String(parsed)
    : null;
}

export function homeMatchScoreLabel(value) {
  const match=plainObject(value);
  if (!match) return 'VS';
  const live=safeRead(match,'live')===true;
  const finished=safeRead(match,'finished')===true;
  const score=plainObject(safeRead(match,'score'));
  const home=score ? scorePart(safeRead(score,'home')) : null;
  const away=score ? scorePart(safeRead(score,'away')) : null;

  if ((live || finished) && home!==null && away!==null) {
    return `${home} : ${away}`;
  }
  return live ? '— : —' : 'VS';
}

function sectionDefinitions() {
  return [
    {key:'live',label:'Сейчас идут',tone:'live',matches:[]},
    {key:'soon',label:'Скоро начнутся',tone:'soon',matches:[]},
    {key:'later',label:'Позже',tone:'later',matches:[]},
    {key:'finished',label:'Завершённые',tone:'finished',matches:[]},
  ];
}

export function homeMatchSections(list,nowMs=Date.now()) {
  const sections=sectionDefinitions();
  const now=
    typeof nowMs==='number' && Number.isFinite(nowMs)
      ? nowMs
      : null;

  for (const raw of safeArray(list).slice(0,1000)) {
    const evidence=matchEvidence(raw);
    if (!evidence) continue;

    if (evidence.live) {
      sections[0].matches.push(evidence.match);
      continue;
    }
    if (evidence.finished) {
      sections[3].matches.push(evidence.match);
      continue;
    }

    const kickoffMs=strictKickoffMs(evidence.date);
    if (kickoffMs===null || now===null || kickoffMs<now) continue;
    const startsInMs=kickoffMs-now;

    if (startsInMs<=SOON_WINDOW_MS) {
      sections[1].matches.push(evidence.match);
    } else {
      sections[2].matches.push(evidence.match);
    }
  }

  return sections.filter(section=>section.matches.length>0);
}

function normalizedInsight(value) {
  const insight=plainObject(value);
  if (!insight) return null;
  const score=safeRead(insight,'score');
  const favorite=safeRead(insight,'favorite')===true;
  const viewedTeam=safeRead(insight,'viewedTeam')===true;
  const reason=safeRead(insight,'reason');
  const viewedLeague=safeRead(insight,'viewedLeague')===true;
  const recommended=safeRead(insight,'recommended')===true;
  return {
    insight:{
      score:
        typeof score==='number' && Number.isFinite(score)
          ? score
          : 0,
      favorite,
      viewedTeam,
      viewedLeague,
      recommended,
      reason:typeof reason==='string' ? reason.slice(0,160) : '',
    },
    score:
      typeof score==='number' && Number.isFinite(score)
        ? score
        : 0,
    favorite,
    viewedTeam,
  };
}

export function selectHomePersonalMatch({
  matches,
  signals,
  insightForMatch,
  nowMs=Date.now(),
}={}) {
  const context=plainObject(signals);
  if (
    !context
    || safeRead(context,'hasPersonalData')!==true
    || typeof insightForMatch!=='function'
  ) return null;

  const now=
    typeof nowMs==='number' && Number.isFinite(nowMs)
      ? nowMs
      : null;
  const rows=[];

  for (const raw of safeArray(matches).slice(0,1000)) {
    const evidence=matchEvidence(raw);
    if (!evidence) continue;
    if (evidence.finished || evidence.youthReserve) continue;

    let insightValue;
    try {
      insightValue=insightForMatch(evidence.match);
    } catch {
      continue;
    }
    const normalized=normalizedInsight(insightValue);
    if (
      !normalized
      || (!normalized.favorite && !normalized.viewedTeam)
    ) continue;

    const live=evidence.live;
    const kickoffMs=strictKickoffMs(evidence.date);
    if (
      !live
      && (
        kickoffMs===null
        || now===null
        || kickoffMs<now
      )
    ) continue;

    rows.push({
      match:evidence.match,
      insight:normalized.insight,
      score:normalized.score,
      live,
      kickoffMs,
    });
  }

  rows.sort((a,b)=>{
    if (a.live!==b.live) return a.live ? -1 : 1;
    const scoreDelta=b.score-a.score;
    if (scoreDelta) return scoreDelta;

    return (a.kickoffMs ?? Number.POSITIVE_INFINITY)
      -(b.kickoffMs ?? Number.POSITIVE_INFINITY);
  });

  const best=rows[0];
  return best
    ? {match:best.match,insight:best.insight}
    : null;
}
