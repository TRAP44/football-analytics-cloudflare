import {assessMatchLineups} from './lineup-quality.js';
import {PROVIDER_FEATURE_CACHE_VERSION} from './provider-data-runtime.js';

export const prematchLineupCacheKey=id=>`provider-feature:lineups:${id}:${PROVIDER_FEATURE_CACHE_VERSION}`;
export const prematchLineupRefreshKey=id=>`prematch-lineup-refresh:${id}:v1`;
export const prematchLineupProbeKey=id=>`prematch-lineup-probe:${id}:v1`;
export const prematchAnalysisCacheKey=id=>`fixture:${id}:v17-starting-xi-rc146`;
export const PREMATCH_LINEUP_RETENTION_MINUTES=3*24*60;

function id(value) {
  if (typeof value!=='number' && !(typeof value==='string' && /^\d+$/.test(value))) return 0;
  const n=Number(value);
  return Number.isSafeInteger(n) && n>0 ? n : 0;
}
function rosterFingerprint(lineups,homeId,awayId) {
  for (const side of ['home','away']) {
    if (!Array.isArray(lineups?.[side]?.startXI) || lineups[side].startXI.length!==11
      || (lineups[side].substitutes!==undefined && (!Array.isArray(lineups[side].substitutes) || lineups[side].substitutes.length>40))) return null;
  }
  if (!assessMatchLineups(lineups).bothConfirmed) return null;
  const side=lineup=>{
    const players=lineup.startXI.map(player=>id(player?.id));
    if (players.some(value=>!value)) return null;
    return [typeof lineup.formation==='string'?lineup.formation:'',players.sort((a,b)=>a-b)];
  };
  const home=side(lineups.home),away=side(lineups.away);
  return home && away ? JSON.stringify([homeId,home,awayId,away]) : null;
}

// Fresh authoritative provider data, two complete non-overlapping starting XIs.
// Checking the cache is cheap; absence/partial/stale data never causes a rebuild.
export function prematchLineupEvent(snapshot,match,nowMs=Date.now()) {
  const fixtureId=id(match?.fixtureId), homeId=id(match?.homeId ?? match?.home?.id), awayId=id(match?.awayId ?? match?.away?.id);
  const kickoff=match?.kickoff ?? Date.parse(match?.date || '');
  const lead=(kickoff-nowMs)/60000;
  if (!fixtureId || !homeId || !awayId || homeId===awayId || lead<20 || lead>90 || !Number.isFinite(lead)) return null;
  if (match?.live===true || match?.finished===true || (match?.status && !['NS','TBD'].includes(match.status))) return null;
  const fetchedAt=Date.parse(snapshot?.fetchedAt || '');
  const age=nowMs-fetchedAt;
  if (snapshot?.provider!=='api-football' || snapshot?.feature!=='lineups' || id(snapshot?.fixtureId)!==fixtureId
    || snapshot?.stale===true || !Number.isFinite(age) || age<0 || age>5*60000 || !Array.isArray(snapshot.data) || snapshot.data.length!==2) return null;
  const lineups={};
  for (const row of snapshot.data) {
    const teamId=id(row?.team?.id), side=teamId===homeId?'home':teamId===awayId?'away':'';
    if (!side || lineups[side] || !Array.isArray(row.startXI) || row.startXI.length!==11
      || (row.substitutes!==undefined && (!Array.isArray(row.substitutes) || row.substitutes.length>40))) return null;
    lineups[side]={formation:row.formation,startXI:(Array.isArray(row.startXI)?row.startXI:[]).map(entry=>entry?.player || {}),
      substitutes:(Array.isArray(row.substitutes)?row.substitutes:[]).map(entry=>entry?.player || {})};
  }
  const fingerprint=rosterFingerprint(lineups,homeId,awayId);
  return fingerprint ? {fixtureId,homeId,awayId,kickoff,fingerprint,snapshot} : null;
}

export function analysisIncludesLineupEvent(analysis,event) {
  const match=analysis?.match;
  const meta=analysis?.dataProvenance?.features?.lineups;
  return id(match?.fixtureId)===event.fixtureId && id(match?.home?.id)===event.homeId && id(match?.away?.id)===event.awayId
    && meta?.confidenceBearing===true && meta?.stale!==true && meta?.source!=='stale-cache'
    && rosterFingerprint(analysis?.lineups,event.homeId,event.awayId)===event.fingerprint;
}

export function completedPrematchLineupRefresh(value,fixtureId) {
  return id(value?.fixtureId)===fixtureId && value?.phase==='lineups'
    && typeof value?.fingerprint==='string' && value.fingerprint.length>0
    && Number.isFinite(Date.parse(value?.computedAt || ''));
}
